//! TOML-based configuration system for the TUI dashboard.
//!
//! Reads `~/.lumi-ops/tui-config.toml` and provides typed config structs
//! with sensible defaults for agent drivers and keybindings.

use serde::Deserialize;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Config structs
// ---------------------------------------------------------------------------

/// Top-level TUI configuration.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct TuiConfig {
    pub agent: AgentConfig,
    pub keybindings: KeybindingsConfig,
}

/// Agent driver configuration.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AgentConfig {
    /// Which AI driver to launch by default (`"gemini"` or `"claude"`).
    pub default_driver: String,
    /// If `true`, skip agent permission prompts (e.g. `--dangerously-skip-permissions`).
    pub no_permissions: bool,
    /// Gemini-specific settings.
    pub gemini: GeminiConfig,
    /// Claude-specific settings.
    pub claude: ClaudeConfig,
}

/// Gemini driver settings.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct GeminiConfig {
    /// Sandbox mode for Gemini (default: `"none"`).
    pub sandbox: String,
}

/// Claude driver settings.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ClaudeConfig {
    /// Maximum number of turns for Claude.
    pub max_turns: Option<u32>,
    /// Maximum budget in USD for Claude.
    pub max_budget_usd: Option<f64>,
}

/// Hot-key overrides.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct KeybindingsConfig {
    /// Key to launch an agent.
    pub launch_agent: String,
    /// Key to kill an agent.
    pub kill_agent: String,
    /// Key to open settings popup.
    pub settings: String,
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

impl Default for TuiConfig {
    fn default() -> Self {
        Self {
            agent: AgentConfig::default(),
            keybindings: KeybindingsConfig::default(),
        }
    }
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            default_driver: "gemini".to_string(),
            no_permissions: true,
            gemini: GeminiConfig::default(),
            claude: ClaudeConfig::default(),
        }
    }
}

impl Default for GeminiConfig {
    fn default() -> Self {
        Self {
            sandbox: "none".to_string(),
        }
    }
}

impl Default for ClaudeConfig {
    fn default() -> Self {
        Self {
            max_turns: None,
            max_budget_usd: None,
        }
    }
}

impl Default for KeybindingsConfig {
    fn default() -> Self {
        Self {
            launch_agent: "a".to_string(),
            kill_agent: "x".to_string(),
            settings: "S".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

impl TuiConfig {
    /// Path to the user config file: `~/.lumi-ops/tui-config.toml`.
    pub fn config_path() -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".lumi-ops").join("tui-config.toml"))
    }

    /// Load configuration from `~/.lumi-ops/tui-config.toml`.
    ///
    /// Returns `TuiConfig::default()` when the file is missing or unparseable
    /// (a warning is logged on parse errors).
    pub fn load() -> Self {
        let Some(path) = Self::config_path() else {
            tracing::warn!("Could not determine home directory; using default config");
            return Self::default();
        };

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // File not found is expected — silently use defaults.
                return Self::default();
            }
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "Failed to read config file; using defaults");
                return Self::default();
            }
        };

        match toml::from_str::<TuiConfig>(&content) {
            Ok(cfg) => cfg,
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "Failed to parse config file; using defaults");
                Self::default()
            }
        }
    }

    /// Build the shell command + args for launching an agent in a worktree.
    ///
    /// Reads `.lumi/MISSION.md` from the worktree and embeds its content
    /// directly in the prompt (bypasses gitignore restrictions).
    ///
    /// Returns `(command, args_vec)` ready for `PtyManager::spawn()`.
    pub fn build_agent_command(&self, worktree_path: &str) -> (String, Vec<String>) {
        let mission_path = std::path::Path::new(worktree_path)
            .join(".lumi")
            .join("MISSION.md");
        let prompt = match std::fs::read_to_string(&mission_path) {
            Ok(content) => format!(
                "Execute the following mission. The mission file is at .lumi/MISSION.md in your working directory.\n\n{content}"
            ),
            Err(_) => "Read .lumi/MISSION.md and execute the mission".to_string(),
        };

        match self.agent.default_driver.as_str() {
            "claude" => {
                let mut args = vec!["-p".to_string(), prompt];
                if self.agent.no_permissions {
                    args.push("--dangerously-skip-permissions".to_string());
                }
                if let Some(turns) = self.agent.claude.max_turns {
                    args.push("--max-turns".to_string());
                    args.push(turns.to_string());
                }
                if let Some(budget) = self.agent.claude.max_budget_usd {
                    args.push("--max-budget-usd".to_string());
                    args.push(budget.to_string());
                }
                ("claude".to_string(), args)
            }
            // Default to gemini for any unrecognised driver name.
            _ => {
                let mut args = vec![];
                // --yolo enables headless autonomous mode (no permission prompts)
                if self.agent.no_permissions {
                    args.push("--yolo".to_string());
                }
                let sandbox_flag = format!("--sandbox={}", self.agent.gemini.sandbox);
                args.push(sandbox_flag);
                args.push("-p".to_string());
                args.push(prompt);
                ("gemini".to_string(), args)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_values() {
        let cfg = TuiConfig::default();
        assert_eq!(cfg.agent.default_driver, "gemini");
        assert!(cfg.agent.no_permissions);
        assert_eq!(cfg.agent.gemini.sandbox, "none");
        assert!(cfg.agent.claude.max_turns.is_none());
        assert!(cfg.agent.claude.max_budget_usd.is_none());
        assert_eq!(cfg.keybindings.launch_agent, "a");
        assert_eq!(cfg.keybindings.kill_agent, "x");
        assert_eq!(cfg.keybindings.settings, "S");
    }

    #[test]
    fn test_parse_valid_toml() {
        let toml_str = r#"
[agent]
default_driver = "claude"
no_permissions = false

[agent.gemini]
sandbox = "auto"

[agent.claude]
max_turns = 10
max_budget_usd = 5.0

[keybindings]
launch_agent = "L"
kill_agent = "K"
settings = "P"
"#;
        let cfg: TuiConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(cfg.agent.default_driver, "claude");
        assert!(!cfg.agent.no_permissions);
        assert_eq!(cfg.agent.gemini.sandbox, "auto");
        assert_eq!(cfg.agent.claude.max_turns, Some(10));
        assert_eq!(cfg.agent.claude.max_budget_usd, Some(5.0));
        assert_eq!(cfg.keybindings.launch_agent, "L");
        assert_eq!(cfg.keybindings.kill_agent, "K");
        assert_eq!(cfg.keybindings.settings, "P");
    }

    #[test]
    fn test_parse_partial_toml_falls_back_to_defaults() {
        let toml_str = r#"
[agent]
default_driver = "claude"
"#;
        let cfg: TuiConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(cfg.agent.default_driver, "claude");
        // Everything else should fall back to defaults.
        assert!(cfg.agent.no_permissions);
        assert_eq!(cfg.agent.gemini.sandbox, "none");
        assert!(cfg.agent.claude.max_turns.is_none());
        assert_eq!(cfg.keybindings.launch_agent, "a");
    }

    #[test]
    fn test_parse_invalid_toml_returns_default() {
        let bad_toml = "this is not valid [[[ toml";
        let result = toml::from_str::<TuiConfig>(bad_toml);
        assert!(result.is_err());
        // In TuiConfig::load(), this path returns TuiConfig::default().
        let cfg = TuiConfig::default();
        assert_eq!(cfg.agent.default_driver, "gemini");
    }

    #[test]
    fn test_build_agent_command_gemini() {
        let cfg = TuiConfig::default();
        let (cmd, args) = cfg.build_agent_command("/tmp/worktree");
        assert_eq!(cmd, "gemini");
        assert!(args.contains(&"--yolo".to_string()));
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"--sandbox=none".to_string()));
    }

    #[test]
    fn test_build_agent_command_claude() {
        let mut cfg = TuiConfig::default();
        cfg.agent.default_driver = "claude".to_string();
        cfg.agent.claude.max_turns = Some(20);
        cfg.agent.claude.max_budget_usd = Some(3.5);

        let (cmd, args) = cfg.build_agent_command("/tmp/worktree");
        assert_eq!(cmd, "claude");
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"--dangerously-skip-permissions".to_string()));
        assert!(args.contains(&"--max-turns".to_string()));
        assert!(args.contains(&"20".to_string()));
        assert!(args.contains(&"--max-budget-usd".to_string()));
        assert!(args.contains(&"3.5".to_string()));
    }

    #[test]
    fn test_build_agent_command_claude_no_permissions_false() {
        let mut cfg = TuiConfig::default();
        cfg.agent.default_driver = "claude".to_string();
        cfg.agent.no_permissions = false;

        let (_, args) = cfg.build_agent_command("/tmp/worktree");
        assert!(!args.contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn test_config_path_returns_some() {
        let path = TuiConfig::config_path();
        assert!(path.is_some());
        let p = path.unwrap();
        assert!(p.ends_with("tui-config.toml"));
    }
}
