// =============================================================================
// Tree Widget — tui-tree-widget 0.22+ for Projects Panel
// =============================================================================
//
// Crate: https://docs.rs/tui-tree-widget
// License: MIT
//
// Key types:
//   - TreeItem<'a, Identifier> — a node with text, children, and a unique ID
//   - TreeState<Identifier>    — tracks selection, open/close state
//   - Tree<'a, Identifier>     — the widget itself (render with render_stateful_widget)
//
// For lumi-tui: Identifier = String (branch name or "repo:branch" composite key)
//
// Cargo.toml: tui-tree-widget = "0.22"

use ratatui::prelude::*;
use ratatui::widgets::Block;
use tui_tree_widget::{Tree, TreeItem, TreeState};

// ---------------------------------------------------------------------------
// Pattern 1: Building a tree from lumi-ops registry + metadata
// ---------------------------------------------------------------------------
// The Projects panel shows:
//   📂 lumi-ops
//   ├── 🔵 feat/add-auth (inProgress)
//   ├── 🟣 fix/login-bug (needsReview)
//   └── ✅ feat/dashboard (done)
//   📂 lumadient
//   └── 🟡 feat/new-page (todo)

fn build_project_tree<'a>(
    repos: &[RepoData],
) -> Vec<TreeItem<'a, String>> {
    repos
        .iter()
        .map(|repo| {
            let children: Vec<TreeItem<'a, String>> = repo
                .clones
                .iter()
                .map(|clone| {
                    let icon = status_icon(&clone.status);
                    let label = format!("{} {} ({})", icon, clone.branch, clone.status);
                    TreeItem::new_leaf(clone.branch.clone(), label)
                })
                .collect();

            TreeItem::new(
                repo.name.clone(),
                format!("📂 {}", repo.name),
                children,
            )
            .expect("unique identifiers required")
        })
        .collect()
}

fn status_icon(status: &str) -> &'static str {
    match status {
        "todo" => "🟡",
        "inProgress" => "🔵",
        "needsReview" => "🟣",
        "needsRevision" => "🟠",
        "done" => "✅",
        "wontDo" => "⬛",
        _ => "❓",
    }
}

// Sample data structures
struct RepoData {
    name: String,
    clones: Vec<CloneData>,
}

struct CloneData {
    branch: String,
    status: String,
}

// ---------------------------------------------------------------------------
// Pattern 2: TreeState management — selection, open/close
// ---------------------------------------------------------------------------
fn tree_state_example() {
    // TreeState tracks which nodes are expanded and which is selected
    let mut state = TreeState::<String>::default();

    // Open a node (expand its children)
    state.open(vec!["lumi-ops".to_string()]);

    // Close a node
    state.close(&vec!["lumi-ops".to_string()]);

    // Toggle open/close
    state.toggle(vec!["lumi-ops".to_string()]);

    // Select specific item (by path of identifiers)
    state.select(vec![
        "lumi-ops".to_string(),
        "feat/add-auth".to_string(),
    ]);

    // Get currently selected item
    let selected: Vec<String> = state.selected().to_vec();

    // Navigation
    state.key_up();    // move selection up
    state.key_down();  // move selection down
    state.key_left();  // collapse current or move to parent
    state.key_right(); // expand current or move to first child
}

// ---------------------------------------------------------------------------
// Pattern 3: Rendering the Tree widget
// ---------------------------------------------------------------------------
fn render_tree(
    frame: &mut ratatui::Frame,
    area: Rect,
    items: &[TreeItem<'_, String>],
    state: &mut TreeState<String>,
) {
    let tree = Tree::new(items)
        .expect("all item identifiers must be unique")
        .block(Block::bordered().title(" 📂 Projects "))
        .highlight_style(
            Style::new()
                .bold()
                .fg(Color::Black)
                .bg(Color::LightCyan),
        )
        .highlight_symbol("▶ ");

    // Tree is a StatefulWidget — use render_stateful_widget
    frame.render_stateful_widget(tree, area, state);
}

// ---------------------------------------------------------------------------
// Pattern 4: Handling keyboard events for tree navigation
// ---------------------------------------------------------------------------
use crossterm::event::{KeyCode, KeyEvent};

fn handle_tree_key(key: KeyEvent, state: &mut TreeState<String>) -> bool {
    match key.code {
        KeyCode::Char('j') | KeyCode::Down => {
            state.key_down();
            true
        }
        KeyCode::Char('k') | KeyCode::Up => {
            state.key_up();
            true
        }
        KeyCode::Char('l') | KeyCode::Right | KeyCode::Enter => {
            state.key_right(); // expand or select child
            true
        }
        KeyCode::Char('h') | KeyCode::Left => {
            state.key_left(); // collapse or select parent
            true
        }
        KeyCode::Char(' ') => {
            // Toggle expand/collapse on current selection
            let selected = state.selected().to_vec();
            if !selected.is_empty() {
                state.toggle(selected);
            }
            true
        }
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Pattern 5: Getting the selected clone's branch name
// ---------------------------------------------------------------------------
fn get_selected_branch(state: &TreeState<String>) -> Option<String> {
    let selected = state.selected();
    // The path is [repo_name, branch_name] for clone items
    // or [repo_name] for repo-level items
    if selected.len() == 2 {
        Some(selected[1].clone()) // branch name
    } else {
        None // repo-level or nothing selected
    }
}
