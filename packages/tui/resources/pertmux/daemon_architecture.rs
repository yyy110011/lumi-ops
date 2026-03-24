// ─── Pertmux Daemon/Client Architecture ──────────────────────────────────────
// Source: https://github.com/rupert648/pertmux
// License: MIT
//
// This file documents the daemon/client architecture pattern from Pertmux,
// which is the PRIMARY architectural reference for lumi-tui Phase 2.
//
// Architecture Overview:
//   pertmux serve  → background daemon (polls tmux/metadata/forge at intervals)
//                   → serializes ALL state into DashboardSnapshot
//                   → broadcasts to connected TUI clients via Unix socket
//   pertmux connect → TUI client connects to daemon, receives snapshots
//   pertmux stop    → sends Stop command, daemon shuts down
//
// Key Insight: The daemon owns ALL state. Clients are pure renderers that
// receive snapshots and send commands. This enables multi-client support.

// ─── 1. Socket Path Convention ───────────────────────────────────────────────
//
// Socket lives at /tmp/pertmux-{USER}.sock
// - Per-user isolation via $USER env var
// - Stale socket detection: try connect, if fails → remove and rebind
//
// ```rust
// pub fn socket_path() -> PathBuf {
//     let name = std::env::var("USER").unwrap_or_else(|_| "unknown".to_string());
//     PathBuf::from(format!("/tmp/pertmux-{}.sock", name))
// }
// ```
//
// For lumi-tui, we'd use: /tmp/lumi-tui-{USER}.sock

// ─── 2. Daemon Main Loop ────────────────────────────────────────────────────
//
// The daemon uses tokio::select! with multiple interval timers, each polling
// different data sources at different frequencies:
//
// ```rust
// pub async fn run(config: Config) -> Result<()> {
//     // 1. Stale socket cleanup
//     let sock = socket_path();
//     if sock.exists() {
//         match UnixStream::connect(&sock).await {
//             Ok(_) => bail!("another daemon is already running"),
//             Err(_) => std::fs::remove_file(&sock)?,  // stale → clean up
//         }
//     }
//     let listener = UnixListener::bind(&sock)?;
//
//     // 2. Channels
//     let (broadcast_tx, _) = broadcast::channel::<DaemonMsg>(32);  // daemon → clients
//     let (cmd_tx, mut cmd_rx) = mpsc::channel::<ClientMsg>(64);    // clients → daemon
//
//     // 3. Initial state
//     let mut app = App::new(config);
//     app.refresh().await;
//     let latest_snapshot = Arc::new(Mutex::new(app.snapshot()));
//
//     // 4. Spawn accept loop (handles new client connections)
//     tokio::spawn(accept_loop(listener, broadcast_tx.clone(), ...));
//
//     // 5. Multi-interval polling
//     let mut refresh_interval = tokio::time::interval(app.refresh_interval);     // 2s
//     let mut detail_interval = tokio::time::interval(app.mr_detail_interval);    // 60s
//     let mut worktree_interval = tokio::time::interval(app.worktree_interval);   // 30s
//     let mut mr_list_interval = tokio::time::interval(app.mr_list_interval);     // 300s
//
//     loop {
//         tokio::select! {
//             Some(cmd) = cmd_rx.recv() => handle_command(cmd),
//             _ = refresh_interval.tick() => { app.refresh().await; broadcast(); }
//             _ = detail_interval.tick() => { app.refresh_mr_detail().await; broadcast(); }
//             _ = worktree_interval.tick() => { app.refresh_worktrees().await; broadcast(); }
//             _ = mr_list_interval.tick() => { app.refresh_mrs().await; broadcast(); }
//             _ = tokio::signal::ctrl_c() => break,
//         }
//     }
// }
// ```
//
// Key pattern: MissedTickBehavior::Delay prevents burst refreshes after slow operations.

// ─── 3. Client Connection Handling ───────────────────────────────────────────
//
// Each client gets its own tokio task. Uses LengthDelimitedCodec for framing.
//
// ```rust
// async fn handle_client(
//     stream: UnixStream,
//     mut snapshot_rx: broadcast::Receiver<DaemonMsg>,  // subscribe to broadcasts
//     cmd_tx: mpsc::Sender<ClientMsg>,                  // forward commands to daemon
//     latest_snapshot: Arc<Mutex<DashboardSnapshot>>,    // for initial state
// ) -> Result<()> {
//     let mut framed = Framed::new(stream, LengthDelimitedCodec::new());
//
//     // Send initial snapshot immediately (client doesn't wait for next tick)
//     let initial = latest_snapshot.lock().await.clone();
//     framed.send(Bytes::from(serde_json::to_vec(&DaemonMsg::Snapshot(Box::new(initial)))?)).await?;
//
//     loop {
//         tokio::select! {
//             // Client → Daemon: forward commands
//             incoming = framed.next() => {
//                 let client_msg: ClientMsg = serde_json::from_slice(&bytes)?;
//                 match client_msg {
//                     ClientMsg::Handshake { version } => {
//                         // Version mismatch → disconnect
//                         if version != PROTOCOL_VERSION {
//                             send_error_and_break();
//                         }
//                         send_ack();
//                     }
//                     other => cmd_tx.send(other).await?,
//                 }
//             }
//             // Daemon → Client: relay broadcasts
//             outgoing = snapshot_rx.recv() => {
//                 framed.send(serialize(msg)).await?;
//             }
//         }
//     }
// }
// ```
//
// Pattern: broadcast::channel allows multiple subscribers (clients).
// Each client subscribes via broadcast_tx.subscribe().
// Lagged receivers (slow clients) get RecvError::Lagged → continue (skip frames).

// ─── 4. Protocol Messages ────────────────────────────────────────────────────
//
// ```rust
// pub const PROTOCOL_VERSION: u32 = 2;
//
// // Client → Daemon
// pub enum ClientMsg {
//     Handshake { version: u32 },
//     Refresh,
//     Stop,
//     CreateWorktree { project_idx: usize, branch: String },
//     RemoveWorktree { project_idx: usize, branch: String },
//     MergeWorktree { project_idx: usize, worktree_path: String },
//     AgentAction { pane_pid: u32, session_id: String, prompt: String },
//     SelectMr { project_idx: usize, mr_iid: u64 },
// }
//
// // Daemon → Client
// pub enum DaemonMsg {
//     HandshakeAck { version: u32 },
//     Snapshot(Box<DashboardSnapshot>),       // Box to reduce stack size
//     ActionResult { ok: bool, message: String },
// }
// ```
//
// Key insight: ALL state is in DashboardSnapshot. Client never queries
// individual pieces — it just renders the latest snapshot.

// ─── 5. DashboardSnapshot — The Complete State Object ────────────────────────
//
// ```rust
// pub struct DashboardSnapshot {
//     pub projects: Vec<ProjectSnapshot>,        // multi-project support
//     pub panes: Vec<AgentPane>,                 // tmux agent panes
//     pub groups: Vec<(String, Vec<usize>)>,     // panes grouped by session
//     pub detail: Option<SessionDetail>,         // selected session detail
//     pub error: Option<String>,                 // last error message
//     pub seconds_since_refresh: u64,            // staleness indicator
//     pub default_agent_command: Option<String>,  // e.g. "opencode"
//     pub keybindings: KeybindingsConfig,        // user-configurable keys
//     pub pending_changes: Vec<MrChange>,        // MR change notifications
//     pub agent_actions: Vec<AgentActionConfig>, // configurable agent prompts
// }
//
// pub struct ProjectSnapshot {
//     pub name: String,
//     pub source: ProjectForge,                  // Gitlab | Github
//     pub project_path: String,                  // e.g. "team/pertmux"
//     pub local_path: String,                    // e.g. "/Users/rupert/project"
//     pub dashboard: DashboardState,             // linked MRs
//     pub cached_worktrees: Vec<WtWorktree>,     // from wt CLI
//     pub cached_mr_detail: Option<MergeRequestDetail>,
//     pub cached_pipeline_jobs: Vec<PipelineJob>,
//     pub cached_threads: Vec<MergeRequestThread>,
// }
// ```
//
// For lumi-tui, our DashboardSnapshot would be simpler:
// - projects: Vec<ProjectSnapshot> with clone metadata
// - agents: Vec<AgentState> with tmux pane info
// - no forge/MR integration (we use lumi-ops review protocol instead)

// ─── 6. Daemonize Pattern ────────────────────────────────────────────────────
//
// ```rust
// fn daemonize(config_path: Option<&str>) -> Result<()> {
//     // Check for existing daemon
//     let sock = socket_path();
//     if sock.exists() && UnixStream::connect(&sock).is_ok() {
//         bail!("another daemon is already running");
//     }
//
//     // Re-exec self with --foreground flag
//     let exe = std::env::current_exe()?;
//     let mut cmd = Command::new(exe);
//     cmd.args(["serve", "--foreground"]);
//
//     // Redirect stdout/stderr to log file
//     let log_file = OpenOptions::new().create(true).append(true).open("/tmp/pertmux-daemon.log")?;
//     cmd.stdout(log_file.try_clone()?).stderr(log_file).stdin(Stdio::null());
//
//     // Detach from terminal (Unix-specific)
//     #[cfg(unix)]
//     cmd.process_group(0);
//
//     cmd.spawn()?;
//     Ok(())
// }
// ```

// ─── 7. Client State Management ─────────────────────────────────────────────
//
// The client maintains its own UI state (selections, popups) separate from
// the daemon's snapshot:
//
// ```rust
// pub struct ClientState {
//     pub snapshot: DashboardSnapshot,     // latest from daemon
//     pub active_project: usize,           // local UI state
//     pub mr_selected: Vec<usize>,         // per-project selection
//     pub worktree_selected: Vec<usize>,   // per-project selection
//     pub popup: PopupState,               // current popup/dialog
//     pub notification: Option<(String, Instant)>,
//     pub running: bool,
// }
// ```
//
// Pattern: When a new snapshot arrives, the client updates its reference
// but preserves selection indices (clamping if list sizes changed).

// ─── 8. Client Event Loop ────────────────────────────────────────────────────
//
// ```rust
// async fn run_client_loop(
//     terminal: &mut Terminal<impl Backend>,
//     state: &mut ClientState,
//     framed: &mut Framed<UnixStream, LengthDelimitedCodec>,
// ) -> Result<()> {
//     let mut event_stream = EventStream::new();  // crossterm async events
//
//     while state.running {
//         terminal.draw(|frame| ui::draw_client(frame, state))?;
//
//         tokio::select! {
//             // Keyboard input
//             maybe_event = event_stream.next() => {
//                 if let Some(Ok(Event::Key(key))) = maybe_event {
//                     handle_key(state, framed, key.code).await?;
//                 }
//             }
//             // Daemon messages
//             msg = framed.next() => {
//                 match daemon_msg {
//                     DaemonMsg::Snapshot(snap) => state.update_snapshot(*snap),
//                     DaemonMsg::ActionResult { ok, message } => state.notify(message),
//                     _ => {}
//                 }
//             }
//         }
//     }
//     Ok(())
// }
// ```
//
// Key difference from Grove: No manual polling — snapshots arrive via socket.
// The client loop only handles keyboard events and message reception.

// ─── 9. Offline Change Buffering ─────────────────────────────────────────────
//
// When no clients are connected, the daemon buffers pending changes:
//
// ```rust
// async fn drain_changes(
//     app: &mut App,
//     client_count: &Arc<AtomicUsize>,
//     pending_for_offline: &Arc<Mutex<Vec<MrChange>>>,
// ) {
//     let changes = app.take_pending_changes();
//     if changes.is_empty() { return; }
//
//     if client_count.load(Ordering::SeqCst) == 0 {
//         // No clients → buffer for next connection
//         pending_for_offline.lock().await.extend(changes);
//     }
//     // If clients are connected, changes are included in the next snapshot
// }
// ```
//
// On client connect, buffered changes are injected into the initial snapshot.
// This ensures the client sees all changes that happened while disconnected.

// ─── 10. Adoption Notes for lumi-tui ─────────────────────────────────────────
//
// Phase 1 (Direct reads — current plan):
//   - Skip daemon/client entirely
//   - TUI reads .lumi-metadata.json directly (like what we do now)
//   - Simpler, faster to implement
//
// Phase 2 (Daemon/client — future):
//   - Adopt this pattern when we need:
//     a) Multi-client support (VS Code extension + TUI reading same state)
//     b) Background agent monitoring without TUI running
//     c) Expensive computations (git diff, code analysis) cached in daemon
//   - Use /tmp/lumi-tui-{USER}.sock
//   - Our DashboardSnapshot would contain:
//     - projects: Vec<ProjectSnapshot> with clone metadata
//     - agents: Vec<AgentState> with tmux pane status
//     - No forge integration (we use lumi-ops review protocol)
//
// Crates needed for daemon/client:
//   - tokio (UnixListener, UnixStream, broadcast, mpsc)
//   - tokio-util (LengthDelimitedCodec, Framed)
//   - bytes (Bytes for serialized messages)
//   - futures (SinkExt, StreamExt for Framed)
//   - serde_json (serialization)
