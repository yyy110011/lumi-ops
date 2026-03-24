//! Parse `~/.lumi-ops/.registry.json` — global repo registry.

use std::collections::HashMap;

/// Registry maps repo display names to absolute root paths.
pub type RepoRegistry = HashMap<String, String>;

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
fn registry_path() -> std::path::PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    home.join(".lumi-ops").join(".registry.json")
}
