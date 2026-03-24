//! Agent status detection from tmux pane output.
//!
//! Distilled from Grove's agent_detector.rs (MIT, ZiiMs/Grove).
//! Contains the ~25 most important regex patterns for detecting
//! Claude, Gemini, and generic AI agent states.

use regex::Regex;
use std::sync::LazyLock;

use crate::protocol::agent::{AgentStatus, ForegroundProcess, StatusDetection};

// ─── ANSI Stripping ────────────────────────────────────────────────

/// Pattern to strip ANSI escape codes from text.
static ANSI_ESCAPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07").unwrap());

/// Strip ANSI escape codes from text.
pub fn strip_ansi(text: &str) -> String {
    ANSI_ESCAPE.replace_all(text, "").to_string()
}

// ─── Shared Patterns (used across all agents) ──────────────────────

/// Braille spinner characters used by Claude Code and others.
static SPINNER_CHARS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒⣾⣽⣻⢿⡿⣟⣯⣷]").unwrap());

/// Claude Code working status indicators (dingbat + *ing…).
/// e.g., "✻ Slithering…", "✢ Sketching…"
static WORKING_INDICATORS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[✢✣✤✥✦✧✨✩✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊❋✡★☆]\s*\w+ing\s*[.…]{1,3}")
        .unwrap()
});

/// Tool execution patterns (Claude Code shows these when running tools).
static TOOL_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"⏺\s*(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch)").unwrap(),
        Regex::new(r"(?i)^(reading|writing|editing|searching|running|executing|thinking|analyzing|processing|fetching|installing|building|compiling|testing)").unwrap(),
    ]
});

/// Patterns indicating the agent is asking a question or needs permission.
static QUESTION_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        // Yes/No prompts
        Regex::new(r"\(y/n\)").unwrap(),
        Regex::new(r"\[y/N\]").unwrap(),
        Regex::new(r"\[Y/n\]").unwrap(),
        Regex::new(r"\[yes/no\]").unwrap(),
        // Permission prompts
        Regex::new(r"Allow\s*(this|once|always)?\s*\?").unwrap(),
        Regex::new(r"Do you want to (allow|proceed|continue)").unwrap(),
        // Bash command confirmation
        Regex::new(r"Run this command\?").unwrap(),
        Regex::new(r"Execute\?").unwrap(),
        // Plan mode
        Regex::new(r"Ready to implement\?").unwrap(),
        Regex::new(r"Proceed with").unwrap(),
        // Numbered selection (❯ 1. Option text)
        Regex::new(r"❯\s*\d+\.").unwrap(),
        // Keyboard confirmation hints
        Regex::new(r"Enter\s+to\s+confirm").unwrap(),
        Regex::new(r"Esc\s+to\s+cancel").unwrap(),
    ]
});

/// Patterns indicating completion.
static COMPLETION_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"[✓✔☑]\s").unwrap(),
        Regex::new(r"(?i)^done\.?\s*$").unwrap(),
        Regex::new(r"(?i)completed successfully").unwrap(),
        Regex::new(r"(?i)finished").unwrap(),
        Regex::new(r"(?i)all tests pass").unwrap(),
    ]
});

/// Patterns indicating an error.
static ERROR_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"[✗✘❌]\s").unwrap(),
        Regex::new(r"(?m)^Error:").unwrap(),
        Regex::new(r"(?m)^ERROR:").unwrap(),
        Regex::new(r"(?m)^error\[E\d+\]").unwrap(), // Rust errors
        Regex::new(r"FAILED").unwrap(),
        Regex::new(r"panicked at").unwrap(),
        Regex::new(r"(?i)command failed").unwrap(),
    ]
});

// ─── Gemini-specific Patterns ──────────────────────────────────────

/// Gemini CLI shows "Action Required" for needs input.
static GEMINI_ACTION_REQUIRED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)action\s+required").unwrap());

/// Gemini shows "Waiting for confirmation" dialogs.
static GEMINI_WAITING_CONFIRMATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)waiting\s+for\s+confirmation").unwrap());

/// Gemini question/answer dialog panel title.
static GEMINI_ANSWER_QUESTIONS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)answer\s+questions").unwrap());

/// Gemini keyboard hints in question panel.
static GEMINI_KEYBOARD_HINTS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)enter\s+to\s+select.*esc\s+to\s+cancel").unwrap());

/// Gemini running indicator: timer format "(esc to cancel, 15s)".
static GEMINI_ESC_CANCEL_TIMER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(esc\s+to\s+cancel,?\s*\d+s").unwrap());

/// Gemini dots spinner (braille animation).
static GEMINI_DOTS_SPINNER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[⠁⠃⠇⡇⡏⡟⡿⣿]").unwrap());

// ─── Prompt Detection ──────────────────────────────────────────────

/// Check if any of the last N non-empty lines look like a shell/agent prompt.
fn is_at_prompt(lines: &[&str], check_count: usize) -> bool {
    lines
        .iter()
        .rev()
        .filter(|l| !l.trim().is_empty())
        .take(check_count)
        .any(|line| {
            let trimmed = line.trim().trim_matches('\u{00A0}');
            // Exact single-char prompts
            if matches!(trimmed, ">" | "›" | "❯" | "$" | "%") {
                return true;
            }
            // Short prompt prefix (≤3 chars)
            if trimmed.len() <= 3
                && (trimmed.starts_with('>')
                    || trimmed.starts_with('›')
                    || trimmed.starts_with('❯')
                    || trimmed.starts_with('$')
                    || trimmed.starts_with('%'))
            {
                return true;
            }
            // Oh-my-zsh style
            if trimmed.starts_with('➜') {
                return true;
            }
            false
        })
}

/// Check if any pattern in a list matches the text.
fn any_matches(patterns: &[Regex], text: &str) -> bool {
    patterns.iter().any(|p| p.is_match(text))
}

// ─── Public Detection API ──────────────────────────────────────────

/// Detect agent status from pane output (text-only, no process info).
///
/// Priority: AwaitingInput → Running → Prompt → Error → Completion → Default
pub fn detect_agent_status(pane_output: &str) -> AgentStatus {
    detect_status(pane_output).status
}

/// Full detection with diagnostic info (text-only, no process info).
pub fn detect_status(output: &str) -> StatusDetection {
    let clean = strip_ansi(output);
    let lines: Vec<&str> = clean.lines().collect();

    if lines.is_empty() {
        return StatusDetection::new(AgentStatus::Idle).with_reason("No output captured");
    }

    // Recent context for analysis
    let recent: Vec<&str> = lines.iter().rev().take(15).copied().collect();
    let recent_text = recent.join("\n");
    let last_3: Vec<&str> = lines.iter().rev().take(3).copied().collect();
    let last_3_text = last_3.join("\n");

    // 1. Questions/permission prompts (highest priority)
    if any_matches(&QUESTION_PATTERNS, &recent_text) {
        return StatusDetection::new(AgentStatus::AwaitingInput)
            .with_reason("Found question/permission prompt")
            .with_pattern("QUESTION_PATTERNS");
    }

    // 2. Running indicators (spinners, tools)
    if SPINNER_CHARS.is_match(&last_3_text) {
        return StatusDetection::new(AgentStatus::Running)
            .with_reason("Found spinner characters")
            .with_pattern("SPINNER_CHARS");
    }

    if WORKING_INDICATORS.is_match(&last_3_text) {
        return StatusDetection::new(AgentStatus::Running)
            .with_reason("Found working indicator")
            .with_pattern("WORKING_INDICATORS");
    }

    if any_matches(&TOOL_PATTERNS, &last_3_text) {
        return StatusDetection::new(AgentStatus::Running)
            .with_reason("Found tool execution pattern")
            .with_pattern("TOOL_PATTERNS");
    }

    // 3. At prompt → Idle
    if is_at_prompt(&lines, 5) {
        return StatusDetection::new(AgentStatus::Idle).with_reason("At prompt, ready for input");
    }

    // 4. Errors
    for pattern in ERROR_PATTERNS.iter() {
        if pattern.is_match(&recent_text) {
            // Find the matching line to extract error message
            for line in recent.iter() {
                if pattern.is_match(line) {
                    let msg: String = line.trim().chars().take(40).collect();
                    return StatusDetection::new(AgentStatus::Error(msg))
                        .with_reason("Error pattern matched")
                        .with_pattern("ERROR_PATTERNS");
                }
            }
        }
    }

    // 5. Completion
    if any_matches(&COMPLETION_PATTERNS, &recent_text) {
        return StatusDetection::new(AgentStatus::Completed)
            .with_reason("Found completion pattern")
            .with_pattern("COMPLETION_PATTERNS");
    }

    // 6. Default
    if clean.trim().is_empty() {
        StatusDetection::new(AgentStatus::Idle).with_reason("Empty output")
    } else {
        StatusDetection::new(AgentStatus::Idle).with_reason("No clear indicators")
    }
}

/// Detect agent status using process-level ground truth + text analysis.
///
/// More accurate than `detect_status()` alone because knowing which process
/// is running lets us pick the right patterns and default assumptions.
pub fn detect_status_with_process(
    output: &str,
    foreground: ForegroundProcess,
) -> StatusDetection {
    match foreground {
        ForegroundProcess::ClaudeRunning => detect_claude_running(output),
        ForegroundProcess::GeminiRunning => detect_gemini_running(output),
        ForegroundProcess::CodexRunning => detect_claude_running(output), // Codex uses similar patterns
        ForegroundProcess::Shell => detect_at_shell(output),
        ForegroundProcess::OtherProcess(ref p) => detect_other_process(output, p),
        ForegroundProcess::Unknown => detect_status(output),
    }
}

// ─── Process-aware Detectors ───────────────────────────────────────

/// When Claude/Codex is the foreground process, default to Running.
fn detect_claude_running(output: &str) -> StatusDetection {
    let clean = strip_ansi(output);
    let lines: Vec<&str> = clean.lines().collect();

    if lines.is_empty() {
        return StatusDetection::new(AgentStatus::Running)
            .with_reason("Agent process running, no output yet");
    }

    let last_5: Vec<&str> = lines
        .iter()
        .rev()
        .filter(|l| !l.trim().is_empty())
        .take(5)
        .copied()
        .collect();
    let last_5_text = last_5.join("\n");

    // 1. Questions (highest priority)
    if any_matches(&QUESTION_PATTERNS, &last_5_text) {
        return StatusDetection::new(AgentStatus::AwaitingInput)
            .with_reason("Found question/permission prompt")
            .with_pattern("QUESTION_PATTERNS");
    }

    // 2. Errors
    for pattern in ERROR_PATTERNS.iter() {
        if pattern.is_match(&last_5_text) {
            for line in last_5.iter() {
                if pattern.is_match(line) {
                    let msg: String = line.trim().chars().take(40).collect();
                    return StatusDetection::new(AgentStatus::Error(msg))
                        .with_reason("Error pattern matched")
                        .with_pattern("ERROR_PATTERNS");
                }
            }
        }
    }

    // 3. Working indicators
    let last_15: Vec<&str> = lines
        .iter()
        .rev()
        .filter(|l| !l.trim().is_empty())
        .take(15)
        .copied()
        .collect();
    let last_15_text = last_15.join("\n");

    if WORKING_INDICATORS.is_match(&last_15_text) {
        return StatusDetection::new(AgentStatus::Running)
            .with_reason("Found working indicator")
            .with_pattern("WORKING_INDICATORS");
    }

    // 4. At prompt → check for completion, then idle
    if is_at_prompt(&lines, 5) {
        let last_10: Vec<&str> = lines
            .iter()
            .rev()
            .filter(|l| !l.trim().is_empty())
            .take(10)
            .copied()
            .collect();
        let last_10_text = last_10.join("\n");

        if any_matches(&COMPLETION_PATTERNS, &last_10_text) {
            return StatusDetection::new(AgentStatus::Completed)
                .with_reason("At prompt with completion pattern")
                .with_pattern("COMPLETION_PATTERNS");
        }
        return StatusDetection::new(AgentStatus::Idle).with_reason("At prompt, ready for input");
    }

    // 5. Default: process is running
    StatusDetection::new(AgentStatus::Running).with_reason("Agent process running")
}

/// When Gemini is the foreground process.
fn detect_gemini_running(output: &str) -> StatusDetection {
    let clean = strip_ansi(output);
    let lines: Vec<&str> = clean.lines().collect();

    if lines.is_empty() {
        return StatusDetection::new(AgentStatus::Running)
            .with_reason("Gemini process running, no output yet");
    }

    let recent: Vec<&str> = lines
        .iter()
        .rev()
        .filter(|l| !l.trim().is_empty())
        .take(15)
        .copied()
        .collect();
    let recent_text = recent.join("\n");

    // 1. Gemini-specific awaiting input patterns
    if GEMINI_ACTION_REQUIRED.is_match(&recent_text) {
        return StatusDetection::new(AgentStatus::AwaitingInput)
            .with_reason("Gemini action required")
            .with_pattern("GEMINI_ACTION_REQUIRED");
    }
    if GEMINI_WAITING_CONFIRMATION.is_match(&recent_text) {
        return StatusDetection::new(AgentStatus::AwaitingInput)
            .with_reason("Gemini waiting for confirmation")
            .with_pattern("GEMINI_WAITING_CONFIRMATION");
    }
    if GEMINI_ANSWER_QUESTIONS.is_match(&recent_text) {
        return StatusDetection::new(AgentStatus::AwaitingInput)
            .with_reason("Gemini answer questions dialog")
            .with_pattern("GEMINI_ANSWER_QUESTIONS");
    }
    if GEMINI_KEYBOARD_HINTS.is_match(&recent_text) {
        return StatusDetection::new(AgentStatus::AwaitingInput)
            .with_reason("Gemini keyboard hints visible")
            .with_pattern("GEMINI_KEYBOARD_HINTS");
    }

    // 2. Shared question patterns
    if any_matches(&QUESTION_PATTERNS, &recent_text) {
        return StatusDetection::new(AgentStatus::AwaitingInput)
            .with_reason("Found question/permission prompt")
            .with_pattern("QUESTION_PATTERNS");
    }

    // 3. Gemini running indicators
    if GEMINI_ESC_CANCEL_TIMER.is_match(&recent_text) {
        return StatusDetection::new(AgentStatus::Running)
            .with_reason("Gemini timer active")
            .with_pattern("GEMINI_ESC_CANCEL_TIMER");
    }

    let last_3: Vec<&str> = lines.iter().rev().take(3).copied().collect();
    let last_3_text = last_3.join("\n");

    if GEMINI_DOTS_SPINNER.is_match(&last_3_text) {
        return StatusDetection::new(AgentStatus::Running)
            .with_reason("Gemini spinner active")
            .with_pattern("GEMINI_DOTS_SPINNER");
    }

    // 4. Shared running indicators
    if SPINNER_CHARS.is_match(&last_3_text) {
        return StatusDetection::new(AgentStatus::Running)
            .with_reason("Found spinner characters")
            .with_pattern("SPINNER_CHARS");
    }

    // 5. Errors
    for pattern in ERROR_PATTERNS.iter() {
        if pattern.is_match(&recent_text) {
            for line in recent.iter() {
                if pattern.is_match(line) {
                    let msg: String = line.trim().chars().take(40).collect();
                    return StatusDetection::new(AgentStatus::Error(msg))
                        .with_reason("Error pattern matched")
                        .with_pattern("ERROR_PATTERNS");
                }
            }
        }
    }

    // 6. Default: Gemini is running
    StatusDetection::new(AgentStatus::Running).with_reason("Gemini process running")
}

/// When at a shell prompt (agent has exited).
fn detect_at_shell(output: &str) -> StatusDetection {
    let clean = strip_ansi(output);
    let lines: Vec<&str> = clean.lines().collect();
    let recent: Vec<&str> = lines.iter().rev().take(10).copied().collect();
    let recent_text = recent.join("\n");

    for pattern in ERROR_PATTERNS.iter() {
        if pattern.is_match(&recent_text) {
            for line in recent.iter() {
                if pattern.is_match(line) {
                    let msg: String = line.trim().chars().take(40).collect();
                    return StatusDetection::new(AgentStatus::Error(msg))
                        .with_reason("Error detected at shell")
                        .with_pattern("ERROR_PATTERNS");
                }
            }
        }
    }

    StatusDetection::new(AgentStatus::Idle).with_reason("Shell in foreground, agent exited")
}

/// When a subprocess (cargo, git, python, etc.) is in the foreground.
fn detect_other_process(output: &str, process_name: &str) -> StatusDetection {
    let clean = strip_ansi(output);
    let lines: Vec<&str> = clean.lines().collect();
    let last_5: Vec<&str> = lines
        .iter()
        .rev()
        .filter(|l| !l.trim().is_empty())
        .take(5)
        .copied()
        .collect();
    let last_5_text = last_5.join("\n");

    // Check for input prompts even in subprocesses
    if any_matches(&QUESTION_PATTERNS, &last_5_text) {
        return StatusDetection::new(AgentStatus::AwaitingInput)
            .with_reason("Question in subprocess output")
            .with_pattern("QUESTION_PATTERNS");
    }

    // Check for errors
    for pattern in ERROR_PATTERNS.iter() {
        if pattern.is_match(&last_5_text) {
            for line in last_5.iter() {
                if pattern.is_match(line) {
                    let msg: String = line.trim().chars().take(40).collect();
                    return StatusDetection::new(AgentStatus::Error(msg))
                        .with_reason(format!("Error in subprocess '{}'", process_name))
                        .with_pattern("ERROR_PATTERNS");
                }
            }
        }
    }

    StatusDetection::new(AgentStatus::Running)
        .with_reason(format!("Subprocess '{}' in foreground", process_name))
}

// ─── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi() {
        let input = "\x1b[32mHello\x1b[0m World";
        assert_eq!(strip_ansi(input), "Hello World");
    }

    #[test]
    fn test_strip_ansi_osc() {
        let input = "before\x1b]0;title\x07after";
        assert_eq!(strip_ansi(input), "beforeafter");
    }

    #[test]
    fn test_detect_spinner_running() {
        let output = "Some output\n⠋ Working on task...";
        let result = detect_status(output);
        assert_eq!(result.status, AgentStatus::Running);
    }

    #[test]
    fn test_detect_working_indicator() {
        let output = "Previous output\n✻ Sketching…";
        let result = detect_status(output);
        assert_eq!(result.status, AgentStatus::Running);
    }

    #[test]
    fn test_detect_tool_pattern() {
        let output = "Some context\n⏺ Read src/main.rs";
        let result = detect_status(output);
        assert_eq!(result.status, AgentStatus::Running);
    }

    #[test]
    fn test_detect_question_yn() {
        let output = "Do something? (y/n)";
        let result = detect_status(output);
        assert_eq!(result.status, AgentStatus::AwaitingInput);
    }

    #[test]
    fn test_detect_permission_prompt() {
        let output = "Allow this?";
        let result = detect_status(output);
        assert_eq!(result.status, AgentStatus::AwaitingInput);
    }

    #[test]
    fn test_detect_run_command() {
        let output = "Run this command?\nls -la";
        let result = detect_status(output);
        assert_eq!(result.status, AgentStatus::AwaitingInput);
    }

    #[test]
    fn test_detect_completion() {
        let output = "✓ All changes applied successfully";
        let result = detect_status(output);
        assert_eq!(result.status, AgentStatus::Completed);
    }

    #[test]
    fn test_detect_error_pattern() {
        let output = "Error: file not found";
        let result = detect_status(output);
        assert!(matches!(result.status, AgentStatus::Error(_)));
    }

    #[test]
    fn test_detect_rust_error() {
        let output = "error[E0308]: mismatched types";
        let result = detect_status(output);
        assert!(matches!(result.status, AgentStatus::Error(_)));
    }

    #[test]
    fn test_detect_prompt_idle() {
        let output = "Some previous output\n\n❯";
        let result = detect_status(output);
        assert_eq!(result.status, AgentStatus::Idle);
    }

    #[test]
    fn test_detect_empty_stopped() {
        let output = "";
        let result = detect_status(output);
        assert_eq!(result.status, AgentStatus::Idle);
    }

    #[test]
    fn test_detect_agent_status_api() {
        let output = "⠙ Processing...";
        assert_eq!(detect_agent_status(output), AgentStatus::Running);
    }

    #[test]
    fn test_claude_running_default() {
        let output = "Some output with no clear indicators\nJust text here";
        let result = detect_status_with_process(output, ForegroundProcess::ClaudeRunning);
        assert_eq!(result.status, AgentStatus::Running);
    }

    #[test]
    fn test_shell_foreground_idle() {
        let output = "$ ls\nfile1.txt\nfile2.txt";
        let result = detect_status_with_process(output, ForegroundProcess::Shell);
        assert_eq!(result.status, AgentStatus::Idle);
    }

    #[test]
    fn test_other_process_running() {
        let output = "Compiling lumi-tui v0.1.0";
        let result = detect_status_with_process(
            output,
            ForegroundProcess::OtherProcess("cargo".to_string()),
        );
        assert_eq!(result.status, AgentStatus::Running);
    }

    #[test]
    fn test_gemini_action_required() {
        let output = "Processing...\nAction Required: please confirm";
        let result = detect_status_with_process(output, ForegroundProcess::GeminiRunning);
        assert_eq!(result.status, AgentStatus::AwaitingInput);
    }

    #[test]
    fn test_gemini_timer_running() {
        let output = "Working on task\n(esc to cancel, 15s)";
        let result = detect_status_with_process(output, ForegroundProcess::GeminiRunning);
        assert_eq!(result.status, AgentStatus::Running);
    }

    #[test]
    fn test_foreground_process_from_command() {
        assert!(matches!(
            ForegroundProcess::from_command("claude"),
            ForegroundProcess::ClaudeRunning
        ));
        assert!(matches!(
            ForegroundProcess::from_command("node"),
            ForegroundProcess::ClaudeRunning
        ));
        assert!(matches!(
            ForegroundProcess::from_command("gemini"),
            ForegroundProcess::GeminiRunning
        ));
        assert!(matches!(
            ForegroundProcess::from_command("bash"),
            ForegroundProcess::Shell
        ));
        assert!(matches!(
            ForegroundProcess::from_command("zsh"),
            ForegroundProcess::Shell
        ));
        assert!(matches!(
            ForegroundProcess::from_command("cargo"),
            ForegroundProcess::OtherProcess(_)
        ));
        assert!(matches!(
            ForegroundProcess::from_command(""),
            ForegroundProcess::Unknown
        ));
    }

    #[test]
    fn test_question_priority_over_error() {
        // Question patterns should take priority over errors
        let output = "error[E0308]: mismatched types\nDo you want to proceed? (y/n)";
        let result = detect_status(output);
        assert_eq!(result.status, AgentStatus::AwaitingInput);
    }
}
