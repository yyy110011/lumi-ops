//! CLI output parsing helpers.
//!
//! Parse stdout from `lumi-ops` CLI commands into structured results.

use anyhow::{Context, Result};

/// Result of a `lumi-ops spawn` command.
#[allow(unused)]
#[derive(Debug, Clone)]
pub struct SpawnResult {
    /// The branch name that was created.
    pub branch: String,
    /// The absolute path to the new worktree.
    pub path: String,
}

/// Result of a `lumi-ops merge` command.
#[allow(unused)]
#[derive(Debug, Clone)]
pub struct MergeResult {
    /// Whether the merge completed successfully.
    pub success: bool,
    /// Human-readable summary message.
    pub message: String,
    /// List of conflicted file paths (empty if no conflicts).
    pub conflicts: Vec<String>,
}

/// Parse the output of `lumi-ops spawn <branch>`.
///
/// Expected output patterns (the CLI uses chalk, so we strip ANSI):
/// - Lines containing "Created shadow clone" or path-like output
/// - The worktree path is typically the last meaningful line
///
/// Falls back to returning the raw stdout if structured parsing fails.
#[allow(unused)]
pub fn parse_spawn_output(stdout: &str, branch: &str) -> Result<SpawnResult> {
    let clean = strip_ansi(stdout);
    let lines: Vec<&str> = clean.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();

    // Look for a line that looks like an absolute path (starts with /)
    let path = lines
        .iter()
        .rev()
        .find(|line| line.starts_with('/'))
        .map(|s| s.to_string());

    // If we found a path, great. Otherwise try to extract from "-> /path" patterns
    let path = path.or_else(|| {
        lines.iter().find_map(|line| {
            line.split("-> ").nth(1).map(|p| p.trim().to_string())
        })
    });

    let path = path.or_else(|| {
        // Last resort: look for `.worktrees/` in any line
        lines.iter().find_map(|line| {
            if line.contains(".worktrees/") {
                // Extract the path portion
                let parts: Vec<&str> = line.split_whitespace().collect();
                parts.iter().find(|p| p.contains(".worktrees/")).map(|s| s.to_string())
            } else {
                None
            }
        })
    });

    let path = path.context("Could not extract worktree path from spawn output")?;

    Ok(SpawnResult {
        branch: branch.to_string(),
        path,
    })
}

/// Parse the output of `lumi-ops merge <source> <target>`.
///
/// Detects conflicts by looking for conflict-related keywords.
#[allow(unused)]
pub fn parse_merge_output(stdout: &str) -> MergeResult {
    let clean = strip_ansi(stdout);
    let lines: Vec<&str> = clean.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();

    let mut conflicts = Vec::new();
    let mut has_conflict = false;

    for line in &lines {
        let lower = line.to_lowercase();
        if lower.contains("conflict") {
            has_conflict = true;
            // Try to extract filename from "CONFLICT (content): Merge conflict in <file>"
            if let Some(idx) = lower.find("merge conflict in ") {
                let file = line[idx + "merge conflict in ".len()..].trim().to_string();
                if !file.is_empty() {
                    conflicts.push(file);
                }
            }
        }
    }

    let message = if lines.is_empty() {
        "Merge completed".to_string()
    } else {
        lines.join("\n")
    };

    MergeResult {
        success: !has_conflict,
        message,
        conflicts,
    }
}

/// Strip ANSI escape codes from a string (public alias for cross-module use).
pub fn strip_ansi_pub(input: &str) -> String {
    strip_ansi(input)
}

/// Strip ANSI escape codes from a string.
///
/// Handles standard SGR sequences like `\x1b[...m`.
fn strip_ansi(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            // Skip until we hit a letter (end of escape sequence)
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(ch);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi() {
        assert_eq!(strip_ansi("\x1b[34mhello\x1b[0m"), "hello");
        assert_eq!(strip_ansi("no ansi here"), "no ansi here");
        assert_eq!(strip_ansi("\x1b[1m\x1b[32mOK\x1b[0m"), "OK");
    }

    #[test]
    fn test_parse_spawn_output_with_path() {
        let stdout = "✨ Created shadow clone for feat/auth\n/Users/ryan/project.worktrees/feat/auth\n";
        let result = parse_spawn_output(stdout, "feat/auth").unwrap();
        assert_eq!(result.branch, "feat/auth");
        assert_eq!(result.path, "/Users/ryan/project.worktrees/feat/auth");
    }

    #[test]
    fn test_parse_spawn_output_with_arrow() {
        let stdout = "[SHADOW] feat/auth -> /Users/ryan/project.worktrees/feat/auth\n";
        let result = parse_spawn_output(stdout, "feat/auth").unwrap();
        assert_eq!(result.path, "/Users/ryan/project.worktrees/feat/auth");
    }

    #[test]
    fn test_parse_spawn_output_with_worktrees_marker() {
        let stdout = "Created worktree at /home/user/repo.worktrees/fix/bug-123\n";
        let result = parse_spawn_output(stdout, "fix/bug-123").unwrap();
        assert!(result.path.contains(".worktrees/"));
    }

    #[test]
    fn test_parse_spawn_output_empty_fails() {
        let result = parse_spawn_output("", "feat/x");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_spawn_output_with_ansi() {
        let stdout = "\x1b[34m✨ Created shadow clone\x1b[0m\n/Users/ryan/project.worktrees/feat/auth\n";
        let result = parse_spawn_output(stdout, "feat/auth").unwrap();
        assert_eq!(result.path, "/Users/ryan/project.worktrees/feat/auth");
    }

    #[test]
    fn test_parse_merge_output_success() {
        let stdout = "Squash merged feat/auth into main\nAll changes applied.\n";
        let result = parse_merge_output(stdout);
        assert!(result.success);
        assert!(result.conflicts.is_empty());
    }

    #[test]
    fn test_parse_merge_output_conflict() {
        let stdout = "CONFLICT (content): Merge conflict in src/auth.rs\nAutomatic merge failed.\n";
        let result = parse_merge_output(stdout);
        assert!(!result.success);
        assert_eq!(result.conflicts, vec!["src/auth.rs"]);
    }

    #[test]
    fn test_parse_merge_output_multiple_conflicts() {
        let stdout = concat!(
            "CONFLICT (content): Merge conflict in src/a.rs\n",
            "CONFLICT (content): Merge conflict in src/b.rs\n",
            "Automatic merge failed.\n"
        );
        let result = parse_merge_output(stdout);
        assert!(!result.success);
        assert_eq!(result.conflicts, vec!["src/a.rs", "src/b.rs"]);
    }

    #[test]
    fn test_parse_merge_output_empty() {
        let result = parse_merge_output("");
        assert!(result.success);
        assert_eq!(result.message, "Merge completed");
    }
}
