//! Parse `~/.lumi-ops/.registry.json` — global repo registry.

use std::collections::HashMap;
use std::path::PathBuf;

/// Registry maps repo display names to absolute root paths.
pub type RepoRegistry = HashMap<String, String>;

/// A registered repository with its computed storage directory.
#[derive(Debug, Clone)]
pub struct RegisteredRepo {
    /// Display name from the registry (e.g., "lumi-ops").
    pub name: String,
    /// Absolute path to the repo root (e.g., "/Users/ryan/project_in_progress/lumi-ops").
    pub root_dir: PathBuf,
}

impl RegisteredRepo {
    /// Compute the worktrees storage directory: `<repo_root>.worktrees/`
    ///
    /// This mirrors the CLI's `getClonesDir()` function in `constants.ts`.
    pub fn storage_dir(&self) -> PathBuf {
        let root_str = self.root_dir.to_string_lossy();
        PathBuf::from(format!("{}.worktrees", root_str))
    }
}

/// Read the global registry and return repos sorted by name.
///
/// Returns an empty vec if the registry doesn't exist.
pub fn list_repos() -> Vec<RegisteredRepo> {
    let registry = read_registry();
    let mut repos: Vec<RegisteredRepo> = registry
        .into_iter()
        .map(|(name, root)| RegisteredRepo {
            name,
            root_dir: PathBuf::from(root),
        })
        .collect();
    repos.sort_by(|a, b| a.name.cmp(&b.name));
    repos
}

/// Read the global registry file.
///
/// Returns an empty map if the file doesn't exist.
pub fn read_registry() -> RepoRegistry {
    let registry_path = registry_path();
    match std::fs::read_to_string(&registry_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

/// Get the path to the global registry file.
fn registry_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".lumi-ops").join(".registry.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_dir_appends_worktrees() {
        let repo = RegisteredRepo {
            name: "lumi-ops".to_string(),
            root_dir: PathBuf::from("/Users/ryan/project_in_progress/lumi-ops"),
        };
        assert_eq!(
            repo.storage_dir(),
            PathBuf::from("/Users/ryan/project_in_progress/lumi-ops.worktrees")
        );
    }

    #[test]
    fn list_repos_from_json() {
        // Test parsing from raw JSON (simulating read_registry)
        let json = r#"{
            "lumadient": "/Users/ryan/project_in_progress/lumadient",
            "lumi-ops": "/Users/ryan/project_in_progress/lumi-ops",
            "alpha-project": "/Users/ryan/alpha"
        }"#;
        let registry: RepoRegistry = serde_json::from_str(json).unwrap();
        let mut repos: Vec<RegisteredRepo> = registry
            .into_iter()
            .map(|(name, root)| RegisteredRepo {
                name,
                root_dir: PathBuf::from(root),
            })
            .collect();
        repos.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(repos.len(), 3);
        assert_eq!(repos[0].name, "alpha-project");
        assert_eq!(repos[1].name, "lumadient");
        assert_eq!(repos[2].name, "lumi-ops");
    }

    #[test]
    fn empty_registry_returns_empty_vec() {
        let json = r#"{}"#;
        let registry: RepoRegistry = serde_json::from_str(json).unwrap();
        let repos: Vec<RegisteredRepo> = registry
            .into_iter()
            .map(|(name, root)| RegisteredRepo {
                name,
                root_dir: PathBuf::from(root),
            })
            .collect();
        assert!(repos.is_empty());
    }

    #[test]
    fn registry_path_uses_home() {
        let path = registry_path();
        let home = dirs::home_dir().unwrap();
        assert_eq!(path, home.join(".lumi-ops").join(".registry.json"));
    }
}
