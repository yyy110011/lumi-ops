// ─── Pertmux Agent Monitoring ────────────────────────────────────────────────
// Source: https://github.com/rupert648/pertmux
// License: MIT
//
// How Pertmux detects and monitors coding agents across tmux panes.

// ─── 1. CodingAgent Trait ────────────────────────────────────────────────────
//
// Pluggable agent interface. Each implementation knows how to detect,
// query status, enrich pane data, and send prompts to its agent type.
//
// ```rust
// pub trait CodingAgent {
//     /// Display name for UI (e.g. "claude-code", "opencode")
//     fn name(&self) -> &str;
//
//     /// Process name to match against tmux pane_current_command
//     fn process_name(&self) -> &str;
//
//     /// Query live status: Idle | Busy | Retry | Unknown
//     fn query_status(&self, pane: &AgentPane) -> PaneStatus;
//
//     /// Send a prompt to the agent (mechanism varies by agent type)
//     fn send_prompt(&self, pane_pid: u32, session_id: &str, prompt: &str) -> Result<String>;
//
//     /// Enrich pane with agent-specific metadata (model, session title, etc.)
//     fn enrich_pane(&self, _pane: &mut AgentPane) {}
//
//     /// Fetch detailed session info (messages, tokens, timeline)
//     fn fetch_session_detail(&self, _session_id: &str) -> Option<SessionDetail> { None }
// }
// ```
//
// Registration via config:
// ```rust
// pub fn agents_from_config(config: &AgentConfig) -> Vec<Box<dyn CodingAgent>> {
//     let mut agents: Vec<Box<dyn CodingAgent>> = Vec::new();
//     if config.opencode.is_some() {
//         agents.push(Box::new(opencode::OpenCode::new(db_path)));
//     }
//     if config.claude_code.is_some() {
//         agents.push(Box::new(claude_code::ClaudeCode));
//     }
//     agents
// }
// ```

// ─── 2. Pane Status Enum ─────────────────────────────────────────────────────
//
// ```rust
// #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
// pub enum PaneStatus {
//     Idle,                                    // Agent waiting for input
//     Busy,                                    // Agent actively working
//     Retry { attempt: u32, message: String }, // Retrying (rate limit, etc.)
//     Unknown,                                 // Can't determine status
// }
// ```

// ─── 3. AgentPane — Rich Pane Metadata ───────────────────────────────────────
//
// ```rust
// pub struct AgentPane {
//     // tmux identity
//     pub pane_id: String,           // "%1"
//     pub session_name: String,      // "pertmux"
//     pub window_index: u32,
//     pub pane_index: u32,
//     pub pane_title: String,        // "OC | protocol"
//     pub pane_path: String,         // "/tmp/pertmux-worktree"
//     pub pane_pid: u32,             // shell PID (for process tree walk)
//     pub pane_command: String,      // "opencode" or "claude" or "node"
//
//     // enriched by CodingAgent
//     pub status: PaneStatus,
//     pub db_session_title: Option<String>,   // first user prompt (truncated)
//     pub agent: Option<String>,              // "opencode" or "claude-code"
//     pub model: Option<String>,              // "gpt-5" or "claude-4-sonnet"
//     pub last_activity: Option<Timestamp>,   // when agent last responded
//     pub db_session_id: Option<String>,      // for session detail lookup
//     pub last_response: Option<String>,      // truncated last response text
// }
// ```

// ─── 4. Claude Code — Transcript-Based Monitoring ────────────────────────────
//
// Claude Code stores session transcripts as JSONL files in:
//   ~/.claude/projects/{encoded-path}/{session-id}.jsonl
//
// Status detection reads the LAST line of the most recent transcript:
//
// ```rust
// fn query_status(&self, pane: &AgentPane) -> PaneStatus {
//     let path = find_latest_transcript_for_path(&pane.pane_path)?;
//     let entry = read_last_entry(&path)?;
//     match entry.entry_type.as_str() {
//         "user" | "tool_use" => PaneStatus::Busy,      // working on something
//         "assistant" | "tool_result" => PaneStatus::Idle, // waiting for input
//         _ => PaneStatus::Unknown,
//     }
// }
// ```
//
// Path encoding: directory slashes become dashes
// ```rust
// fn encode_path_for_claude(path: &str) -> String {
//     path.replace('/', "-")
// }
// ```
//
// Transcript entry structure (JSONL):
// ```rust
// struct TranscriptEntry {
//     #[serde(rename = "type")]
//     entry_type: String,          // "user", "assistant", "tool_use", "tool_result"
//     timestamp: Option<String>,
//     session_id: Option<String>,
//     message: Option<TranscriptMessage>,
//     cwd: Option<String>,
// }
//
// struct TranscriptMessage {
//     role: Option<String>,
//     model: Option<String>,       // "claude-4-sonnet-20260514"
//     usage: Option<TokenUsage>,
//     content: Option<Value>,      // String | Array of {type: "text", text: "..."}
// }
// ```
//
// Enrichment extracts: session title (first user message), model name,
// last activity timestamp, last response text, session ID.
//
// Prompt sending: via tmux send-keys (no API):
// ```rust
// fn send_prompt(&self, pane_pid: u32, _session_id: &str, prompt: &str) -> Result<String> {
//     let pane_id = find_tmux_pane_by_pid(pane_pid)?;
//     let escaped = prompt.replace('\'', "'\\''");
//     Command::new("tmux").args(["send-keys", "-t", &pane_id, &escaped, "Enter"]).status()?;
//     Ok("Message sent to Claude Code via tmux".to_string())
// }
// ```

// ─── 5. OpenCode — HTTP API Monitoring ───────────────────────────────────────
//
// OpenCode exposes a local HTTP API for status and message sending.
//
// Port discovery via process tree + netstat:
// ```rust
// pub fn discover_port(pane_pid: u32) -> Option<u16> {
//     let mut sys = System::new();
//     sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ...);
//
//     // Walk: shell_pid → children → grandchildren → find "opencode"
//     let opencode_pid = find_opencode_pid(&sys, pane_pid)?;
//
//     // Collect opencode PID + all its children (HTTP server may be child)
//     let mut candidate_pids = vec![opencode_pid];
//     candidate_pids.extend(find_child_pids(&sys, opencode_pid));
//
//     // Use netstat2 to find TCP LISTEN port owned by any candidate PID
//     find_listening_port(&candidate_pids)
// }
// ```
//
// Status query:
// ```rust
// fn query_status(&self, pane: &AgentPane) -> PaneStatus {
//     let port = discovery::discover_port(pane.pane_pid)?;
//     let map: HashMap<String, SessionStatus> = get("http://127.0.0.1:{port}/session/status")?;
//     // Priority: Busy > Retry > Idle
//     for status in map.values() {
//         if status.status_type == "busy" { return PaneStatus::Busy; }
//     }
//     for status in map.values() {
//         if status.status_type == "retry" { return PaneStatus::Retry { ... }; }
//     }
//     PaneStatus::Idle
// }
// ```
//
// Message sending via HTTP POST:
// ```rust
// fn send_prompt(&self, pane_pid: u32, session_id: &str, prompt: &str) -> Result<String> {
//     let port = discover_port(pane_pid)?;
//     let url = format!("http://127.0.0.1:{}/session/{}/message", port, session_id);
//     let body = json!({ "parts": [{"type": "text", "text": prompt}] });
//     agent.post(&url).send_json(&body)?;
//     Ok("Message sent to opencode".to_string())
// }
// ```

// ─── 6. Tmux Pane Discovery ─────────────────────────────────────────────────
//
// Two-phase detection to handle interpreter-based agents:
//
// ```rust
// pub fn list_agent_panes(process_names: &[&str]) -> Result<Vec<AgentPane>> {
//     let format_str = "#{pane_id}\t#{session_name}\t#{window_index}\t#{pane_index}\
//                       \t#{pane_title}\t#{pane_current_path}\t#{pane_pid}\t#{pane_current_command}";
//     let output = Command::new("tmux").args(["list-panes", "-a", "-F", format_str]).output()?;
//
//     // Phase 1: Direct match on pane_current_command
//     for line in stdout.lines() {
//         let fields: Vec<&str> = line.split('\t').collect();
//         if process_names.iter().any(|name| *name == fields[7]) {
//             panes.push(make_agent_pane(&fields));
//         } else {
//             unmatched.push(fields);
//         }
//     }
//
//     // Phase 2: Child process inspection for unmatched panes
//     // e.g. Claude Code runs as "node" but argv[0] is "claude"
//     if !unmatched.is_empty() {
//         let mut sys = System::new();
//         sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ...);
//         for raw in &unmatched {
//             let shell_pid = raw.fields[6].parse::<u32>()?;
//             if let Some(agent_name) = find_agent_child(&sys, shell_pid, process_names) {
//                 let mut pane = make_agent_pane(&raw);
//                 pane.pane_command = agent_name;  // override with detected agent
//                 panes.push(pane);
//             }
//         }
//     }
//     Ok(panes)
// }
// ```
//
// Child process detection checks both process name AND argv[0]:
// ```rust
// fn find_agent_child(sys: &System, shell_pid: u32, process_names: &[&str]) -> Option<String> {
//     let parent = Pid::from_u32(shell_pid);
//     for proc_ in sys.processes().values() {
//         if proc_.parent() != Some(parent) { continue; }
//         let name = proc_.name().to_string_lossy();
//         for &agent_name in process_names {
//             if name.eq_ignore_ascii_case(agent_name) { return Some(agent_name.to_string()); }
//             if let Some(arg0) = proc_.cmd().first() {
//                 if arg0 == agent_name || arg0.ends_with(&format!("/{}", agent_name)) {
//                     return Some(agent_name.to_string());
//                 }
//             }
//         }
//     }
//     None
// }
// ```
//
// Crates used: sysinfo (process tree), netstat2 (port discovery)

// ─── 7. Find-or-Create Pane Pattern ──────────────────────────────────────────
//
// When focusing a worktree, Pertmux:
// 1. Checks if a tmux pane already exists at that path → switch to it
// 2. Otherwise creates a new window + optionally splits for agent command
//
// ```rust
// pub fn find_or_create_pane(path: &str, project_name: &str, agent_command: Option<&str>) {
//     if let Some(pane_id) = find_pane_by_path(&canonical_target)? {
//         return switch_to_pane(&pane_id);  // already exists
//     }
//
//     // Create new window in target session (not our dashboard session)
//     let target_session = find_session_by_name(project_name)
//         .or_else(|| find_other_client_session());
//
//     tmux new-window -a -t {target_session} -n {window_name} -c {path};
//
//     if let Some(cmd) = agent_command {
//         tmux split-window -h;  // side-by-side: editor + agent
//         tmux send-keys {cmd} Enter;
//     }
// }
// ```
//
// Multi-client awareness: the TUI runs in one tmux client, but opens panes
// in the OTHER client (the user's main terminal). Uses find_other_client()
// to discover the non-dashboard tmux client.

// ─── Adoption Notes for lumi-tui ─────────────────────────────────────────────
//
// Key borrowable patterns:
//
// 1. CodingAgent trait → Our agent detection can use a similar trait
//    but we detect Gemini (gemini-cli) and Claude (claude) and Antigravity
//
// 2. Two-phase pane discovery → Essential for interpreter-based agents
//    (node → claude, python → aider, etc.)
//
// 3. Claude transcript parsing → Directly applicable for Claude Code monitoring
//    We should support Claude's JSONL format for status detection
//
// 4. Find-or-create pane → Useful for our "attach to agent" feature
//    Switch to existing tmux pane if agent is running there
//
// Key differences:
// - We don't need opencode's HTTP API (we focus on Gemini + Claude initially)
// - Our status detection uses Grove's regex-based approach for Phase 1
// - Port discovery via netstat2 is only needed if we support opencode
