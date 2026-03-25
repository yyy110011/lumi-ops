//! Embedded PTY manager — spawns an agent on a real pseudo-terminal.
//!
//! Uses `portable-pty` for PTY allocation and `vt100` for terminal emulation.
//! Keystrokes are written directly to the PTY master fd (instant, ~0μs).
//! A dedicated reader thread continuously feeds PTY output into the vt100 parser.
//! Optionally tees output to a log file for persistent agent output capture.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

/// Manages an embedded PTY with a running child process.
///
/// The reader thread runs in the background, continuously feeding output
/// from the PTY into the `vt100::Parser`. The TUI render loop can lock
/// the parser at any time to get the current screen state.
pub struct PtyManager {
    writer: Box<dyn Write + Send>,
    parser: Arc<Mutex<vt100::Parser>>,
    /// Keep the master alive so the PTY doesn't close.
    #[allow(unused)]
    master: Box<dyn MasterPty + Send>,
    /// Keep the child alive for proper lifecycle management.
    _child: Box<dyn Child + Send + Sync>,
}

/// Open (or create) a log file at `path`, creating parent directories as needed.
///
/// Returns `None` if the file cannot be opened, logging a warning.
fn open_log_file(path: &std::path::Path) -> Option<std::fs::File> {
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!(path = %parent.display(), error = %e, "Failed to create log directory");
            return None;
        }
    }
    match std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
    {
        Ok(f) => Some(f),
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "Failed to open log file");
            None
        }
    }
}

impl PtyManager {
    /// Spawn a command on a new PTY.
    ///
    /// Returns `(PtyManager, JoinHandle)` — the join handle is for the
    /// reader thread that feeds PTY output into the vt100 parser.
    ///
    /// When `log_path` is `Some`, the reader thread tees all PTY output
    /// to the specified file in addition to the vt100 parser.
    pub fn spawn(
        cmd: &str,
        args: &[&str],
        cwd: &str,
        rows: u16,
        cols: u16,
        log_path: Option<&std::path::Path>,
    ) -> anyhow::Result<(Self, std::thread::JoinHandle<()>)> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        // Build command
        let mut cmd_builder = CommandBuilder::new(cmd);
        for arg in args {
            cmd_builder.arg(*arg);
        }
        cmd_builder.cwd(cwd);

        // Spawn child process on the PTY slave
        let child = pair.slave.spawn_command(cmd_builder)?;
        // Drop slave — the child now owns it
        drop(pair.slave);

        let writer = pair.master.take_writer()?;
        let mut reader = pair.master.try_clone_reader()?;

        // vt100 parser with scrollback buffer (1000 lines)
        let parser = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 1000)));
        let parser_clone = Arc::clone(&parser);

        // Open log file if requested (before moving into the thread)
        let mut log_file = log_path.and_then(open_log_file);
        if log_path.is_some() && log_file.is_some() {
            tracing::info!(path = %log_path.unwrap().display(), "Log teeing enabled");
        }

        // Spawn a reader thread (std thread, not tokio — PTY read is blocking I/O)
        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF — child exited
                    Ok(n) => {
                        let data = &buf[..n];

                        // Feed into vt100 parser
                        if let Ok(mut p) = parser_clone.lock() {
                            p.process(data);
                        }

                        // Tee to log file
                        if let Some(ref mut file) = log_file {
                            if let Err(e) = file.write_all(data) {
                                tracing::warn!(error = %e, "Log file write failed, disabling log");
                                log_file = None;
                            } else if let Err(e) = file.flush() {
                                tracing::warn!(error = %e, "Log file flush failed, disabling log");
                                log_file = None;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        Ok((
            Self {
                writer,
                parser,
                master: pair.master,
                _child: child,
            },
            handle,
        ))
    }

    /// Send raw bytes to the PTY (instant — just a write syscall).
    pub fn write_bytes(&mut self, data: &[u8]) -> anyhow::Result<()> {
        self.writer.write_all(data)?;
        self.writer.flush()?;
        Ok(())
    }

    /// Send a string to the PTY.
    #[allow(unused)]
    pub fn write_str(&mut self, s: &str) -> anyhow::Result<()> {
        self.write_bytes(s.as_bytes())
    }

    /// Get a reference to the vt100 parser (for rendering).
    pub fn parser(&self) -> &Arc<Mutex<vt100::Parser>> {
        &self.parser
    }

    /// Resize the PTY and vt100 parser to new dimensions.
    ///
    /// Uses `portable-pty`'s `MasterPty::resize()` to update the kernel PTY
    /// size, then recreates the vt100 parser with the new dimensions.
    #[allow(unused)]
    pub fn resize(&self, rows: u16, cols: u16) -> anyhow::Result<()> {
        // Resize the kernel PTY
        self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        // Recreate the vt100 parser with new dimensions.
        // This loses scrollback but correctly updates the terminal grid.
        if let Ok(mut p) = self.parser.lock() {
            let new_parser = vt100::Parser::new(rows, cols, 1000);
            *p = new_parser;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn open_log_file_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let log_path = dir.path().join(".lumi").join("agent.log");

        // Parent .lumi/ doesn't exist yet
        assert!(!dir.path().join(".lumi").exists());

        let file = open_log_file(&log_path);
        assert!(file.is_some(), "should open log file successfully");
        assert!(dir.path().join(".lumi").is_dir(), ".lumi dir should be created");
        assert!(log_path.exists(), "agent.log should exist");
    }

    #[test]
    fn open_log_file_truncates_existing() {
        let dir = tempfile::tempdir().unwrap();
        let log_path = dir.path().join("agent.log");

        // Write some initial content
        std::fs::write(&log_path, b"old content").unwrap();

        let mut file = open_log_file(&log_path).unwrap();
        file.write_all(b"new").unwrap();
        drop(file);

        let content = std::fs::read_to_string(&log_path).unwrap();
        assert_eq!(content, "new", "file should be truncated, not appended");
    }

    #[test]
    fn open_log_file_returns_none_on_invalid_path() {
        // Path with a file as "parent" — can't create dirs
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("blocker");
        std::fs::write(&blocker, b"i am a file").unwrap();

        let log_path = blocker.join("sub").join("agent.log");
        let file = open_log_file(&log_path);
        assert!(file.is_none(), "should return None when dir creation fails");
    }

    #[test]
    fn open_log_file_at_root_path_still_works() {
        // A path with no parent — edge case
        let dir = tempfile::tempdir().unwrap();
        let log_path = dir.path().join("agent.log");

        let file = open_log_file(&log_path);
        assert!(file.is_some());
    }
}
