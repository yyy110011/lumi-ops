# ratatui Ecosystem — Pattern Library for lumi-tui

Reference code extracted from official examples and crate documentation.
These are **not runnable as-is** — they are patterns to copy-adapt into `packages/tui/src/`.

## Crate Versions & Compatibility

| Crate | Version | Purpose | ratatui compat |
|-------|---------|---------|----------------|
| `ratatui` | 0.29 | TUI framework | — |
| `crossterm` | 0.28 | Terminal backend | via ratatui |
| `tui-tree-widget` | 0.22+ | Hierarchical tree view | ratatui 0.29 |
| `tui-textarea` | 0.7 | Multi-line text input | ratatui 0.29 |
| `ansi-to-tui` | 7 (or 8) | ANSI → ratatui Text | ratatui 0.29 |
| `tui-scrollview` | 0.6 | Virtual scrollable canvas | ratatui 0.29 |
| `fuzzy-matcher` | 0.3 | Fuzzy string matching | pure Rust, no dep |
| `pulldown-cmark` | 0.12 | Markdown parser | pure Rust, no dep |

## File Index

| File | Patterns | Key Takeaways |
|------|----------|---------------|
| `layout_examples.rs` | 7 | 4-panel layout, Constraint types, Flex, popup overlay, responsive |
| `event_loop.rs` | 6 | Sync/async loops, tokio channels, Action dispatch, input modes |
| `tree_widget_example.rs` | 5 | TreeItem/TreeState, project tree, keyboard nav, selection |
| `textarea_example.rs` | 7 | Single-line input, search, mode switching, method cheat sheet |
| `ansi_rendering.rs` | 7 | tmux capture-pane → Text, sync/async, scrollbar integration |
| `scrollview_example.rs` | 3 | ScrollView virtual canvas, key navigation, mixed widgets |
| `fuzzy_search.rs` | 5 | SkimMatcherV2, filtering, match highlighting, search state |
| `markdown_renderer.rs` | 5 | pulldown-cmark AST → ratatui Spans, heading styles, file I/O |

## Architecture Notes

### Layout Strategy
- Use `Layout::vertical` + `Layout::horizontal` with array destructuring
- 4-panel design: `[Percentage(20), Percentage(40), Percentage(40)]` horizontal
- Popup overlays: `area.centered()` + `Clear` widget

### Event Loop Strategy
- **Phase 1**: Sync `ratatui::run()` with `event::poll(timeout)`
- **Phase 2**: Async tokio with `mpsc::channel` for background polling
- Background tasks: metadata polling (2s), tmux capture (2s), tick (250ms)

### Widget Rendering
- **StatefulWidget** pattern: `Tree`, `Table` → `render_stateful_widget(widget, area, &mut state)`
- **Widget** pattern: `Paragraph`, `Block`, `Clear` → `render_widget(widget, area)`
- **TextArea** renders as Widget but owns its state internally

### Key Dependencies Decision
- `ansi-to-tui` for tmux output (IntoText trait, `.into_text()`)
- `tui-scrollview` only if mixed-widget scrolling needed; `Paragraph::scroll()` for text-only
- `fuzzy-matcher::skim::SkimMatcherV2` — best general-purpose matcher
- `pulldown-cmark` for MISSION.md preview (streaming event parser)

## Sources

- [ratatui examples](https://github.com/ratatui/ratatui/tree/main/examples) (MIT)
- [tui-textarea examples](https://github.com/rhysd/tui-textarea/tree/main/examples) (MIT)
- [tui-tree-widget docs](https://docs.rs/tui-tree-widget) (MIT)
- [ansi-to-tui docs](https://docs.rs/ansi-to-tui) (MIT)
- [tui-scrollview docs](https://docs.rs/tui-scrollview) (MIT)
- [fuzzy-matcher docs](https://docs.rs/fuzzy-matcher) (MIT)
- [pulldown-cmark docs](https://docs.rs/pulldown-cmark) (MIT)
