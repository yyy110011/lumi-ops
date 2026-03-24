---
name: ratatui-patterns
description: Condensed reference for ratatui 0.29 ecosystem widget patterns. Maps each widget to our 4-panel layout.
---

# Ratatui 0.29 — Pattern Reference for lumi-tui

## Crate Version Table

| Crate | Version | Panel / Purpose |
|-------|---------|-----------------|
| `ratatui` | 0.29 | TUI framework |
| `crossterm` | 0.28 (`event-stream`) | Terminal backend + events |
| `tui-tree-widget` | 0.22+ | Left: Projects tree |
| `tui-textarea` | 0.7 | Bottom-right: Input box |
| `ansi-to-tui` | 7 | Right: tmux ANSI → `Text` |
| `tui-scrollview` | 0.6 | Virtual scrollable canvas (optional) |
| `fuzzy-matcher` | 0.3 | `/` search overlay |
| `pulldown-cmark` | 0.12 | Center-top: MISSION.md preview |

---

## 4-Panel Layout Recipe

```rust
fn lumi_4panel_layout(frame: &mut Frame) {
    let area = frame.area();

    // Top-level: main + status bar
    let [main_area, status_bar] = area.layout(&Layout::vertical([
        Constraint::Fill(1),
        Constraint::Length(1),
    ]));

    // 3-column split
    let [left, center, right] = main_area.layout(&Layout::horizontal([
        Constraint::Percentage(20),  // Projects tree
        Constraint::Percentage(40),  // File viewer + Agent table
        Constraint::Percentage(40),  // Terminal
    ]));

    // Center split: file viewer (top) + agent table (bottom)
    let [file_viewer, agent_table] = center.layout(&Layout::vertical([
        Constraint::Percentage(40),
        Constraint::Percentage(60),
    ]));

    // Right split: terminal output + input
    let [terminal_output, input_box] = right.layout(&Layout::vertical([
        Constraint::Fill(1),
        Constraint::Length(3),  // 2 lines + border
    ]));
}
```

**Constraint cheat sheet:** `Length(n)` fixed, `Min(n)` grow, `Max(n)` cap, `Percentage(p)` relative, `Fill(w)` weighted remainder.

**Popup overlay:** `area.centered(Constraint::Percentage(60), Constraint::Percentage(30))` + render `Clear` widget before popup content.

**Responsive:** Check `area.width >= 120` for 3-col, `>= 80` for 2-col, else stacked.

---

## Event Loop Skeleton (Async + tokio)

```rust
#[tokio::main]
async fn main() -> Result<()> {
    enable_raw_mode()?;
    execute!(io::stdout(), EnterAlternateScreen)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(io::stdout()))?;
    let mut app = AppState::new();

    // Background pollers → UI via mpsc channel
    let (tx, mut rx) = mpsc::channel::<AppUpdate>(32);
    tokio::spawn(poll_metadata(tx.clone()));    // 2s interval
    tokio::spawn(poll_agent_status(tx.clone())); // 2s interval

    loop {
        terminal.draw(|f| ui::render(f, &app))?;

        if event::poll(Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                match app.handle_key(key) {
                    Action::Quit => break,
                    _ => {}
                }
            }
        }

        // Drain background updates (non-blocking)
        while let Ok(update) = rx.try_recv() {
            app.apply_update(update);
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
```

**Input modes:** `Normal` (shortcuts active) vs `TextInput` (forward to textarea). Toggle with `Enter`/`Esc`.

**Action enum:** Map keybindings → `Action::{Quit, CyclePanelFocus, JumpToPanel(n), SpawnClone, AttachTmux, ...}`.

---

## Per-Panel Widget Guide

### Left — Projects Tree (`tui-tree-widget`)

**Key types:** `TreeItem<'a, String>`, `TreeState<String>`, `Tree<'a, String>`

```rust
// Build: repo → clone hierarchy
let item = TreeItem::new(repo_id, "📂 repo", vec![
    TreeItem::new_leaf(branch.clone(), format!("{} {}", icon, branch)),
]).expect("unique IDs");

// Render (StatefulWidget)
let tree = Tree::new(&items).expect("unique IDs")
    .block(Block::bordered().title(" 📂 Projects "))
    .highlight_style(Style::new().bold().bg(Color::LightCyan))
    .highlight_symbol("▶ ");
frame.render_stateful_widget(tree, area, &mut tree_state);
```

**Navigation:** `state.key_up()`, `key_down()`, `key_left()` (collapse), `key_right()` (expand), `toggle(ids)`.

**Selection path:** `state.selected()` → `[repo, branch]` for clones, `[repo]` for repos.

---

### Center-Top — File Viewer (`pulldown-cmark`)

Parse MISSION.md → styled `Text`:

```rust
let options = Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS;
let parser = Parser::new_ext(markdown, options);
// Walk events: Start(Heading/Paragraph/...) → Text(content) → End(...)
// Push styled Span per event, flush to Line on End(Paragraph/Item)
```

**Heading styles:** H1 = Cyan+Bold+Underline, H2 = LightCyan+Bold, H3 = LightBlue+Bold.

**Render:** `Paragraph::new(text).block(block).wrap(Wrap { trim: false }).scroll((offset, 0))`.

**File paths:** `{worktree}/.lumi/MISSION.md`, `MISSION_COMPLETE.md`, `REVIEW_FEEDBACK.md`.

---

### Center-Bottom — Agent Table

Use ratatui's built-in `Table` + `TableState` (StatefulWidget). Add `Scrollbar` via:

```rust
let scrollbar_area = table_area.inner(Margin { vertical: 1, horizontal: 1 });
frame.render_stateful_widget(Scrollbar::default()
    .orientation(ScrollbarOrientation::VerticalRight), scrollbar_area, &mut scrollbar_state);
```

---

### Right — Terminal (`ansi-to-tui`)

**Core pattern:** `tmux capture-pane -t <session> -p -e -J -S -<lines>` → `stdout.into_text()`.

```rust
// Async capture
let output = AsyncCommand::new("tmux")
    .args(["capture-pane", "-t", session, "-p", "-e", "-J", "-S", &format!("-{}", lines)])
    .output().await?;
let text: Text = output.stdout.into_text()?;  // IntoText trait

// Render with scroll
Paragraph::new(text).block(block).scroll((offset, 0)).wrap(Wrap { trim: false });
```

**Scrollbar:** `ScrollbarState::new(total_lines).position(offset)` → render with `VerticalRight`.

**`-e` flag is critical** — without it, no colors preserved.

---

### Bottom-Right — Input (`tui-textarea`)

```rust
let mut textarea = TextArea::default();
textarea.set_block(Block::bordered().title(" Send to Agent "));
textarea.set_placeholder_text("Type a message...");
textarea.set_cursor_style(Style::default().fg(Color::LightCyan).add_modifier(Modifier::REVERSED));

// Render: textarea implements Widget
frame.render_widget(&textarea, input_area);

// Handle input (in TextInput mode)
let input: Input = event.into();
match input {
    Input { key: Key::Enter, .. } => { /* submit textarea.lines().join("\n") then select_all + cut */ }
    Input { key: Key::Esc, .. }   => { /* exit TextInput mode */ }
    other => { textarea.input(other); }
}
```

**Key methods:** `lines()`, `cursor()`, `is_empty()`, `select_all()`, `cut()`, `undo()`, `redo()`, `set_search_pattern()`, `search_forward()`.

---

## Fuzzy Search Integration (`/` key)

```rust
let matcher = SkimMatcherV2::default().smart_case();
// Filter + rank
let mut matches: Vec<_> = items.iter()
    .filter_map(|item| matcher.fuzzy_match(item, query).map(|s| (item, s)))
    .collect();
matches.sort_by(|a, b| b.1.cmp(&a.1));

// Highlight matched chars
if let Some((_score, indices)) = matcher.fuzzy_indices(text, query) {
    // Build Span per char: highlighted (Yellow+Bold) for matched, raw for rest
}
```

**SearchState:** Track `query: String`, `is_active: bool`, `selected_index: usize`. Activate on `/`, deactivate on `Esc`.

---

## ScrollView (Optional — `tui-scrollview`)

Use when composing **multiple widgets** in a scrollable area. For text-only, prefer `Paragraph::scroll()`.

```rust
let mut sv = ScrollView::new(Size::new(width, content_height));
sv.render_widget(widget_a, Rect::new(0, 0, w, h1));
sv.render_widget(widget_b, Rect::new(0, h1, w, h2));
sv.render(area, buf, &mut scroll_state);  // StatefulWidget
```

**Navigation:** `scroll_up/down()`, `scroll_page_up/down()`, `scroll_to_top/bottom()`.

---

## Common Gotchas

1. **StatefulWidget vs Widget** — `Tree`, `Table`, `Scrollbar`, `ScrollView` need `render_stateful_widget(widget, area, &mut state)`. `Paragraph`, `Block`, `Clear` use `render_widget`.
2. **Array destructuring** — `area.layout(&Layout::vertical([...]))` returns a fixed-size array. Use `let [a, b, c] = ...` syntax.
3. **`Paragraph::scroll((row, col))`** — first element is vertical offset. Wrap with `Wrap { trim: false }` to preserve whitespace.
4. **`ansi-to-tui` trait import** — must `use ansi_to_tui::IntoText;` to call `.into_text()` on byte slices.
5. **`tui-textarea` Input type** — convert crossterm events via `let input: Input = event.into();`, not the raw `KeyEvent`.
6. **TreeItem identifiers must be unique** — `TreeItem::new()` / `Tree::new()` return `Result`, call `.expect()` or handle.
7. **`crossterm::event::poll()` timeout** — use short (50ms) for responsive UI with background tasks, longer (250ms) for simpler apps.
8. **Blocking in async** — all subprocess calls must be `tokio::process::Command`, never `std::process::Command` in the event loop.
