//! Embedded PTY manager — spawns an agent on a real pseudo-terminal.
//!
//! Uses `portable-pty` for PTY allocation and `vt100` for terminal emulation.
//! Keystrokes are written directly to the PTY master fd (instant, ~0μs).
//! A dedicated reader thread continuously feeds PTY output into the vt100 parser.

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
    master: Box<dyn MasterPty + Send>,
    /// Keep the child alive for proper lifecycle management.
    _child: Box<dyn Child + Send + Sync>,
}

impl PtyManager {
    /// Spawn a command on a new PTY.
    ///
    /// Returns `(PtyManager, JoinHandle)` — the join handle is for the
    /// reader thread that feeds PTY output into the vt100 parser.
    pub fn spawn(
        cmd: &str,
        args: &[&str],
        cwd: &str,
        rows: u16,
        cols: u16,
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

        // Spawn a reader thread (std thread, not tokio — PTY read is blocking I/O)
        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF — child exited
                    Ok(n) => {
                        if let Ok(mut p) = parser_clone.lock() {
                            p.process(&buf[..n]);
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
