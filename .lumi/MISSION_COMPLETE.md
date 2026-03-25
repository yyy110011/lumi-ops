## Summary
Created `packages/tui/src/app/status_detector.rs` — a standalone, regex-based status detection module that analyzes terminal screen text to determine AI agent status. Implements 8 `LazyLock<Regex>` pattern groups adapted from Grove's `agent_detector.rs`, a `last_n_lines()` helper for focused text analysis, and a `detect_status()` function with 6-level priority ordering. Includes local `DriverName` and `AgentStatus` enums (with TODO to re-export from `pty_pool` once merged). Module registered in `app/mod.rs`.

## Key Decisions
- Used `LazyLock<Regex>` (stable since Rust 1.80) instead of `lazy_static` per mission rules.
- Adapted regex patterns from Grove's battle-tested `agent_detector.rs` for spinner, working, tool, question, completion, error, and prompt detection.
- Gemini's `esc to cancel, 15s` timer pattern is correctly classified as `Running` (not AwaitingInput), distinct from question patterns.
- Prompt char detection is restricted to last 3 lines only, preventing false Idle detection from old prompts in scrollback.
- Default status is `Running` when no patterns match (assumes agent is working).

## ⚠️ Needs Attention
- The `DriverName` and `AgentStatus` enums are local copies. When `pty_pool.rs` is merged (parallel development), these should be replaced with re-exports.
- `detect_status()` currently takes `&str` screen text directly. The design doc shows it taking a `vt100::Parser` — the caller should extract `parser.screen().contents()` before calling.

## Changes
| File | What | Why |
|------|------|-----|
| `src/app/status_detector.rs` | New module with 8 regex pattern groups, `detect_status()`, `last_n_lines()`, local enums, 17 unit tests | Core deliverable of this mission |
| `src/app/mod.rs` | Added `pub mod status_detector;` | Register new module |

## Verification Evidence
```
running 17 tests
test app::status_detector::tests::test_empty_string_default ... ok
test app::status_detector::tests::test_last_n_lines_basic ... ok
test app::status_detector::tests::test_last_n_lines_exceeds ... ok
test app::status_detector::tests::test_priority_question_beats_spinner ... ok
test app::status_detector::tests::test_awaiting_input_yn ... ok
test app::status_detector::tests::test_error_detection ... ok
test app::status_detector::tests::test_rust_compiler_error ... ok
test app::status_detector::tests::test_fatal_error ... ok
test app::status_detector::tests::test_prompt_only_on_last_lines ... ok
test app::status_detector::tests::test_running_spinner ... ok
test app::status_detector::tests::test_gemini_awaiting_input ... ok
test app::status_detector::tests::test_gemini_esc_cancel_timer_is_running ... ok
test app::status_detector::tests::test_working_indicator_ing_ellipsis ... ok
test app::status_detector::tests::test_tool_pattern ... ok
test app::status_detector::tests::test_completed ... ok
test app::status_detector::tests::test_mission_complete ... ok
test app::status_detector::tests::test_idle_prompt ... ok

test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 56 filtered out; finished in 0.03s
```

## Open Questions
None — all mission deliverables completed as specified.
