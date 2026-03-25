//! Regex-based status detection module.
//!
//! Analyzes terminal screen text to determine AI agent status.
//! Adapted from Grove's `agent_detector.rs` patterns.

use std::sync::LazyLock;

use regex::Regex;

// Re-export from pty_pool — single source of truth for these types.
pub use super::pty_pool::{AgentStatus, DriverName};

// ---------------------------------------------------------------------------
// Compile-once regex patterns (LazyLock)
// ---------------------------------------------------------------------------

/// Braille spinner characters used by Claude Code and other agents.
static SPINNER_CHARS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒⣾⣽⣻⢿⡿⣟⣯⣷]").unwrap());

/// Working status indicators: dingbat char `✻`, or words ending in `ing…` / `ing...`.
static WORKING_INDICATORS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"✻|\w+ing\s*[…]{1}|\w+ing\s*\.{3}").unwrap());

/// Tool execution patterns (Claude Code style).
static TOOL_PATTERNS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"⏺\s*(Read|Write|Edit|Bash|Search|List)").unwrap());

/// Question / confirmation patterns → AwaitingInput.
static QUESTION_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"\(y/n\)").unwrap(),
        Regex::new(r"\(Y/n\)").unwrap(),
        Regex::new(r"\[Y/n\]").unwrap(),
        Regex::new(r"\[y/N\]").unwrap(),
        Regex::new(r"(?i)Allow\s*\?").unwrap(),
        Regex::new(r"(?i)Run this command\?").unwrap(),
        Regex::new(r"(?i)Enter\s+to\s+confirm").unwrap(),
        Regex::new(r"(?i)approve").unwrap(),
        Regex::new(r"(?i)permission").unwrap(),
    ]
});

/// Gemini-specific AwaitingInput patterns.
static GEMINI_ACTION_REQUIRED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)action\s+required").unwrap());

static GEMINI_WAITING_CONFIRMATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)waiting\s+for\s+confirmation").unwrap());

/// Gemini running indicator: `esc to cancel` followed by a timer like `15s`.
static GEMINI_ESC_CANCEL_TIMER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"esc\s+to\s+cancel.*\d+s").unwrap());

/// Completion patterns.
static COMPLETION_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"[✓✔]").unwrap(),
        Regex::new(r"(?i)\bdone\b").unwrap(),
        Regex::new(r"(?i)completed successfully").unwrap(),
        Regex::new(r"(?i)Task completed").unwrap(),
        Regex::new(r"(?i)Mission complete").unwrap(),
    ]
});

/// Error patterns.
static ERROR_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"[✗✘]").unwrap(),
        Regex::new(r"(?m)^Error:").unwrap(),
        Regex::new(r"FAILED").unwrap(),
        Regex::new(r"panicked at").unwrap(),
        Regex::new(r"(?m)^fatal:").unwrap(),
        Regex::new(r"error\[E").unwrap(),
    ]
});

/// Prompt characters that indicate an idle shell (checked on last line only).
static PROMPT_CHARS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(^[>›❯$%➜]|[>›❯$%➜]\s*$)").unwrap());

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/// Extract the last `n` lines of screen text for focused analysis.
///
/// Returns a string slice pointing into the original `text`.
fn last_n_lines(text: &str, n: usize) -> &str {
    if n == 0 || text.is_empty() {
        return "";
    }

    let mut count = 0;
    for (idx, byte) in text.as_bytes().iter().enumerate().rev() {
        if *byte == b'\n' {
            count += 1;
            if count == n {
                // Return everything after this newline.
                return &text[idx + 1..];
            }
        }
    }
    // Fewer than `n` newlines — return the entire text.
    text
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

/// Detect AI agent status from terminal screen text.
///
/// Uses the last 20 lines for most pattern checks and last 3 lines for prompt
/// detection. Priority order:
///
/// 1. AwaitingInput (question + Gemini-specific)
/// 2. Error
/// 3. Running (spinner / working / tool patterns)
/// 4. Completed
/// 5. Idle (prompt chars — last 3 lines only)
/// 6. Default → `Running`
pub fn detect_status(screen_text: &str, driver: DriverName) -> AgentStatus {
    if screen_text.is_empty() {
        return AgentStatus::Running; // default per spec
    }

    let recent = last_n_lines(screen_text, 20);
    let tail = last_n_lines(screen_text, 3);

    // 1. Question / AwaitingInput (highest priority — user needs to act)
    for pat in QUESTION_PATTERNS.iter() {
        if pat.is_match(recent) {
            return AgentStatus::AwaitingInput;
        }
    }

    // Gemini-specific awaiting input
    if matches!(driver, DriverName::Gemini) {
        if GEMINI_ACTION_REQUIRED.is_match(recent) {
            return AgentStatus::AwaitingInput;
        }
        if GEMINI_WAITING_CONFIRMATION.is_match(recent) {
            return AgentStatus::AwaitingInput;
        }
        // "esc to cancel" with a timer is a *running* indicator for Gemini,
        // but we check it here to avoid mis-classifying it in step 5.
        if GEMINI_ESC_CANCEL_TIMER.is_match(recent) {
            return AgentStatus::Running;
        }
    }

    // 2. Error patterns
    for pat in ERROR_PATTERNS.iter() {
        if pat.is_match(recent) {
            return AgentStatus::Error;
        }
    }

    // 3. Running (spinner / working / tool patterns)
    if SPINNER_CHARS.is_match(recent) {
        return AgentStatus::Running;
    }
    if WORKING_INDICATORS.is_match(recent) {
        return AgentStatus::Running;
    }
    if TOOL_PATTERNS.is_match(recent) {
        return AgentStatus::Running;
    }

    // 4. Completion patterns
    for pat in COMPLETION_PATTERNS.iter() {
        if pat.is_match(recent) {
            return AgentStatus::Completed;
        }
    }

    // 5. Prompt chars → Idle (last 3 lines only)
    for line in tail.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && PROMPT_CHARS.is_match(trimmed) {
            return AgentStatus::Idle;
        }
    }

    // 6. Default: assume agent is working
    AgentStatus::Running
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_running_spinner() {
        let output = "Loading modules...\n⠙ Processing files\nsome output";
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::Running);
    }

    #[test]
    fn test_awaiting_input_yn() {
        let output = "Do you want to continue? (y/n)";
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::AwaitingInput);
    }

    #[test]
    fn test_gemini_awaiting_input() {
        let output = "Some processing output\nAction Required: Please confirm the changes";
        assert_eq!(detect_status(output, DriverName::Gemini), AgentStatus::AwaitingInput);
    }

    #[test]
    fn test_completed() {
        let output = "Building project...\n✓ All tasks completed\nDone.";
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::Completed);
    }

    #[test]
    fn test_error_detection() {
        let output = "Compiling...\nError: cannot find module 'foo'\n";
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::Error);
    }

    #[test]
    fn test_idle_prompt() {
        // Only prompt char on last line → Idle
        let output = "last command finished\n$";
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::Idle);
    }

    #[test]
    fn test_priority_question_beats_spinner() {
        // Both spinner and question present → AwaitingInput (higher priority)
        let output = "⠙ Working on something\nAllow this? (y/n)";
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::AwaitingInput);
    }

    #[test]
    fn test_empty_string_default() {
        assert_eq!(detect_status("", DriverName::Claude), AgentStatus::Running);
    }

    #[test]
    fn test_last_n_lines_basic() {
        let text = "line1\nline2\nline3\nline4\nline5";
        let last2 = last_n_lines(text, 2);
        assert_eq!(last2, "line4\nline5");
    }

    #[test]
    fn test_last_n_lines_exceeds() {
        let text = "only\ntwo";
        let last5 = last_n_lines(text, 5);
        assert_eq!(last5, "only\ntwo");
    }

    #[test]
    fn test_working_indicator_ing_ellipsis() {
        let output = "✻ Reading files...\nSome other output";
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::Running);
    }

    #[test]
    fn test_tool_pattern() {
        let output = "Some output\n⏺ Edit src/main.rs\nMore output";
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::Running);
    }

    #[test]
    fn test_prompt_only_on_last_lines() {
        // A `>` deep in history should NOT trigger Idle if recent lines have a spinner.
        let mut lines: Vec<String> = Vec::new();
        lines.push("> old prompt".to_string());
        for i in 0..25 {
            lines.push(format!("work line {}", i));
        }
        lines.push("⠹ Processing...".to_string());
        let output = lines.join("\n");
        assert_eq!(detect_status(&output, DriverName::Claude), AgentStatus::Running);
    }

    #[test]
    fn test_gemini_esc_cancel_timer_is_running() {
        let output = "Generating code...\n(esc to cancel, 15s)";
        assert_eq!(detect_status(output, DriverName::Gemini), AgentStatus::Running);
    }

    #[test]
    fn test_fatal_error() {
        let output = "Cloning repo...\nfatal: repository not found\n";
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::Error);
    }

    #[test]
    fn test_rust_compiler_error() {
        let output = "Compiling project...\nerror[E0433]: failed to resolve\n";
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::Error);
    }

    #[test]
    fn test_mission_complete() {
        let output = "Wrapping up...\nMission complete!\n$";
        // Completion pattern checked before prompt, but both are present.
        // "Mission complete" triggers Completed (priority 4) before `$` Idle (priority 5).
        assert_eq!(detect_status(output, DriverName::Claude), AgentStatus::Completed);
    }
}
