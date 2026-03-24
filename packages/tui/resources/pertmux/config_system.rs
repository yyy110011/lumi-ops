// ─── Pertmux Config System ───────────────────────────────────────────────────
// Source: https://github.com/rupert648/pertmux
// License: MIT
//
// Multi-project TOML configuration with validation, configurable keybindings,
// and agent selection. This pattern is useful for lumi-tui's optional config.

// ─── 1. Config File Location ─────────────────────────────────────────────────
//
// Resolution order:
//   1. Explicit path via `-c ./config.toml` flag
//   2. XDG convention: ~/.config/pertmux.toml
//   3. dirs::config_dir() (platform-native config directory)
//   4. Fallback: Config::default() (no file needed — graceful degradation)
//
// ```rust
// pub fn load(explicit_path: Option<&str>) -> Result<Config> {
//     let path = match explicit_path {
//         Some(p) => PathBuf::from(p),
//         None => {
//             let xdg_path = dirs::home_dir().map(|h| h.join(".config").join("pertmux.toml"));
//             let native_path = dirs::config_dir().map(|d| d.join("pertmux.toml"));
//             match xdg_path.filter(|p| p.exists()).or_else(|| native_path.filter(|p| p.exists())) {
//                 Some(p) => p,
//                 None => return Ok(Config::default()),  // no config = all defaults
//             }
//         }
//     };
//     let content = std::fs::read_to_string(&path)?;
//     let config: Config = toml::from_str(&content)?;
//     Ok(config)
// }
// ```

// ─── 2. Config Structure ─────────────────────────────────────────────────────
//
// ```toml
// # ~/.config/pertmux.toml
//
// refresh_interval = 2          # tmux poll interval (seconds)
// mr_detail_interval = 60       # MR detail fetch interval
// worktree_interval = 30        # worktree list refresh
// mr_list_interval = 300        # MR list refresh
// default_agent_command = "opencode"  # auto-launch in split pane
//
// [agent.opencode]
// db_path = "~/.local/share/opencode/opencode.db"
//
// [agent.claude_code]
// # no config needed — reads ~/.claude/projects/
//
// [github]
// token = "ghp_..."  # or use PERTMUX_GITHUB_TOKEN env var
//
// [gitlab]
// host = "gitlab.example.com"
// token = "glpat-..."  # or PERTMUX_GITLAB_TOKEN env var
//
// [[project]]
// name = "pertmux"
// source = "github"           # "github" | "gitlab"
// project = "rupert648/pertmux"
// local_path = "/Users/rupert/project"
// username = "rupert648"      # optional, for filtering own MRs
//
// [[project]]
// name = "ferroxide"
// source = "github"
// project = "rupert648/ferroxide"
// local_path = "/Users/rupert/ferroxide"
// ```
//
// Rust struct:
// ```rust
// #[derive(Debug, Deserialize)]
// #[serde(default)]
// pub struct Config {
//     pub refresh_interval: u64,          // default: 2
//     pub mr_detail_interval: u64,        // default: 60
//     pub worktree_interval: u64,         // default: 30
//     pub mr_list_interval: u64,          // default: 300
//     pub default_agent_command: Option<String>,
//     pub keybindings: KeybindingsConfig,
//     pub agent: AgentConfig,
//     pub gitlab: Option<GitLabSourceConfig>,
//     pub github: Option<GitHubSourceConfig>,
//     pub project: Option<Vec<ProjectConfig>>,
//     pub agent_action: Vec<AgentActionConfig>,
// }
// ```

// ─── 3. Multi-Project Resolution ─────────────────────────────────────────────
//
// Two formats supported (with backwards compatibility):
//
// OLD format (single project in [gitlab] section):
// ```toml
// [gitlab]
// project = "team/project"
// local_path = "/tmp/test-repo"
// ```
//
// NEW format (explicit [[project]] array):
// ```toml
// [[project]]
// name = "Alpha"
// source = "gitlab"
// project = "team/alpha"
// local_path = "/tmp/alpha"
// ```
//
// Resolution logic:
// ```rust
// impl Config {
//     pub fn resolve_projects(&self) -> Vec<ProjectConfig> {
//         if let Some(ref projects) = self.project {
//             return projects.clone();  // NEW format takes precedence
//         }
//         // Fallback: derive from old [gitlab] section
//         if let Some(ref gl) = self.gitlab {
//             if let (Some(project), Some(local_path)) = (&gl.project, &gl.local_path) {
//                 let name = project.split('/').next_back().unwrap_or(project).to_string();
//                 return vec![ProjectConfig { name, source: ProjectForge::Gitlab, ... }];
//             }
//         }
//         vec![]
//     }
// }
// ```

// ─── 4. Validation ───────────────────────────────────────────────────────────
//
// Config validation runs at startup, collecting ALL errors before bailing:
//
// ```rust
// impl Config {
//     pub fn validate(&self) -> Result<()> {
//         let mut errors: Vec<String> = Vec::new();
//
//         // Ambiguity check: old + new format simultaneously
//         if self.project.is_some() && self.gitlab.as_ref().map(|g| g.project.is_some()) {
//             errors.push("both [[project]] and [gitlab].project defined");
//         }
//
//         // Per-project checks
//         for proj in &self.resolve_projects() {
//             if !Path::new(&proj.local_path).is_dir() {
//                 errors.push(format!("local_path does not exist: {}", proj.local_path));
//             }
//             // Check forge section exists for project's source
//             match proj.source {
//                 ProjectForge::Gitlab if self.gitlab.is_none() => errors.push(...),
//                 ProjectForge::Github if self.github.is_none() => errors.push(...),
//                 _ => {}
//             }
//         }
//
//         // Token checks, duplicate names, keybinding conflicts...
//
//         if errors.is_empty() { Ok(()) } else { bail!("{}", errors.join("\n\n")) }
//     }
// }
// ```
//
// Pattern: Collect all errors, show them all at once instead of one-at-a-time.
// Each error includes a "hint:" with actionable fix suggestion.

// ─── 5. Configurable Keybindings ─────────────────────────────────────────────
//
// ```rust
// #[derive(Debug, Clone, Serialize, Deserialize)]
// #[serde(default)]
// pub struct KeybindingsConfig {
//     pub refresh: char,           // default: 'r'
//     pub open_browser: char,      // default: 'o'
//     pub copy_branch: char,       // default: 'b'
//     pub filter_projects: char,   // default: 'f'
//     pub create_worktree: char,   // default: 'c'
//     pub delete_worktree: char,   // default: 'd'
//     pub merge_worktree: char,    // default: 'm'
//     pub agent_actions: char,     // default: 'a'
// }
// ```
//
// Validation ensures no duplicate keybindings.
// Partial override supported: only specify keys you want to change.

// ─── 6. Agent Config ─────────────────────────────────────────────────────────
//
// ```rust
// #[derive(Debug, Clone, Deserialize)]
// #[serde(default)]
// pub struct AgentConfig {
//     pub opencode: Option<OpenCodeAgentConfig>,      // enabled by default
//     pub claude_code: Option<ClaudeCodeAgentConfig>,  // disabled by default
// }
//
// #[derive(Debug, Clone, Deserialize, Default)]
// pub struct OpenCodeAgentConfig {
//     pub db_path: Option<String>,  // custom SQLite DB path
// }
//
// #[derive(Debug, Clone, Deserialize, Default)]
// pub struct ClaudeCodeAgentConfig {}  // no config needed
// ```
//
// Agents are instantiated only if their config section exists (Some).
// This allows enabling/disabling agents via config.

// ─── 7. Agent Actions (Configurable Prompts) ─────────────────────────────────
//
// ```rust
// pub struct AgentActionConfig {
//     pub name: String,         // "Rebase with upstream"
//     pub prompt: String,       // template with {target_branch}, {mr_url} placeholders
//     pub requires_mr: bool,    // only show when MR context available
// }
// ```
//
// Default actions include "Rebase with upstream" and "Check pipeline & fix errors".
// Users can override or add new actions in config.

// ─── Adoption Notes for lumi-tui ─────────────────────────────────────────────
//
// For lumi-tui, we'd use a simpler config:
//
// ```toml
// # ~/.config/lumi-tui.toml
//
// refresh_interval = 2
//
// [keybindings]
// quit = "q"
// spawn = "n"
// attach = "a"
// # ...
//
// [agent]
// # Which agent types to detect
// gemini = true
// claude = true
// ```
//
// Key differences from Pertmux:
// - No forge integration (we use lumi-ops review protocol)
// - Projects come from ~/.lumi-ops/.registry.json (auto-registered)
// - Agent detection is simpler (we detect from tmux pane commands)
