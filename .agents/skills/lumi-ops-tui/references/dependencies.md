# Lumi-Ops TUI — Dependencies

## Cargo.toml — Recommended Dependencies

Based on Grove (MIT) reference + design requirements:

```toml
[package]
name = "lumi-tui"
version = "0.1.0"
edition = "2021"

[dependencies]
# TUI
ratatui = "0.29"
crossterm = { version = "0.28", features = ["event-stream"] }
ansi-to-tui = "7"          # Render ANSI from tmux capture-pane

# Async
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time", "process"] }

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Error handling
anyhow = "1"

# Logging
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# Time
chrono = { version = "0.4", features = ["serde"] }

# Markdown rendering
pulldown-cmark = "0.12"

# Tree widget
tui-tree-widget = "0.22"

# Text input
tui-textarea = "0.7"

# Fuzzy search
fuzzy-matcher = "0.3"

# Dirs
dirs = "5"

# UUID (for agent tracking)
uuid = { version = "1", features = ["v4", "serde"] }

# Regex (for agent status detection)
regex = "1"
```

> **Note:** `git2` is optional — TUI reads file state directly. Only needed if we want branch listing without `lumi-ops list --json`.

## Key Crate Documentation

| Crate | Docs |
|-------|------|
| ratatui | https://docs.rs/ratatui/latest |
| crossterm | https://docs.rs/crossterm/latest |
| ansi-to-tui | https://docs.rs/ansi-to-tui/latest |
| tui-tree-widget | https://docs.rs/tui-tree-widget/latest |
| tui-textarea | https://docs.rs/tui-textarea/latest |
| pulldown-cmark | https://docs.rs/pulldown-cmark/latest |
| fuzzy-matcher | https://docs.rs/fuzzy-matcher/latest |
