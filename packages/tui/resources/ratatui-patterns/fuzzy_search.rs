// =============================================================================
// Fuzzy Search — fuzzy-matcher Integration for / Search Feature
// =============================================================================
//
// Crate: https://docs.rs/fuzzy-matcher (MIT)
// Version: fuzzy-matcher = "0.3"
//
// Key types:
//   - FuzzyMatcher trait — fuzzy_match(haystack, needle) → Option<i64>
//   - skim::SkimMatcherV2 — best general-purpose matcher (from fzf/skim)
//   - clangd::ClangdMatcher — alternative matcher with clangd-style scoring
//
// For lumi-tui: use SkimMatcherV2 for the `/` search feature
// to filter clones, files, and agent names.

use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;

// ---------------------------------------------------------------------------
// Pattern 1: Basic fuzzy matching
// ---------------------------------------------------------------------------
fn basic_fuzzy_match() {
    let matcher = SkimMatcherV2::default();

    // fuzzy_match returns Option<i64> — None if no match, Some(score) if matched
    let score = matcher.fuzzy_match("feat/add-authentication", "auth");
    assert!(score.is_some()); // "auth" fuzzy-matches "add-authentication"

    let score = matcher.fuzzy_match("fix/login-bug", "auth");
    assert!(score.is_none()); // "auth" does not match "fix/login-bug"
}

// ---------------------------------------------------------------------------
// Pattern 2: Fuzzy filtering a list of items with ranking
// ---------------------------------------------------------------------------
/// Filter and rank items by fuzzy match score.
/// Returns items sorted by relevance (highest score first).
fn fuzzy_filter<'a>(
    items: &'a [String],
    query: &str,
) -> Vec<(&'a String, i64)> {
    if query.is_empty() {
        // No query → return all items with score 0
        return items.iter().map(|item| (item, 0i64)).collect();
    }

    let matcher = SkimMatcherV2::default();

    let mut matches: Vec<(&String, i64)> = items
        .iter()
        .filter_map(|item| {
            matcher
                .fuzzy_match(item, query)
                .map(|score| (item, score))
        })
        .collect();

    // Sort by score descending (best match first)
    matches.sort_by(|a, b| b.1.cmp(&a.1));
    matches
}

// ---------------------------------------------------------------------------
// Pattern 3: Fuzzy search with match indices (for highlighting)
// ---------------------------------------------------------------------------
/// Get both score and matched character positions for highlighting.
fn fuzzy_match_with_indices(haystack: &str, needle: &str) -> Option<(i64, Vec<usize>)> {
    let matcher = SkimMatcherV2::default();
    matcher.fuzzy_indices(haystack, needle)
}

/// Example: highlighting matched characters in ratatui
fn highlight_match_example() {
    use ratatui::style::{Color, Style};
    use ratatui::text::{Line, Span};

    let text = "feat/add-authentication";
    let query = "auth";

    if let Some((_score, indices)) = fuzzy_match_with_indices(text, query) {
        // indices = positions of matched chars, e.g. [9, 10, 11, 12]
        let mut spans: Vec<Span> = Vec::new();
        let mut last = 0;

        for &idx in &indices {
            if idx > last {
                // Non-matched characters
                spans.push(Span::raw(&text[last..idx]));
            }
            // Matched character (highlighted)
            spans.push(Span::styled(
                &text[idx..idx + 1],
                Style::default().fg(Color::Yellow).bold(),
            ));
            last = idx + 1;
        }
        if last < text.len() {
            spans.push(Span::raw(&text[last..]));
        }

        let _line = Line::from(spans);
        // Render this line in a List or Paragraph
    }
}

// ---------------------------------------------------------------------------
// Pattern 4: Integration with lumi-tui search overlay
// ---------------------------------------------------------------------------
/// SearchState manages the search query and filtered results index
struct SearchState {
    query: String,
    is_active: bool,
    selected_index: usize,
}

impl SearchState {
    fn new() -> Self {
        Self {
            query: String::new(),
            is_active: false,
            selected_index: 0,
        }
    }

    fn activate(&mut self) {
        self.is_active = true;
        self.query.clear();
        self.selected_index = 0;
    }

    fn deactivate(&mut self) {
        self.is_active = false;
    }

    fn push_char(&mut self, ch: char) {
        self.query.push(ch);
        self.selected_index = 0; // reset selection on query change
    }

    fn pop_char(&mut self) {
        self.query.pop();
        self.selected_index = 0;
    }

    fn select_next(&mut self, max: usize) {
        if max > 0 {
            self.selected_index = (self.selected_index + 1) % max;
        }
    }

    fn select_prev(&mut self, max: usize) {
        if max > 0 {
            self.selected_index = (self.selected_index + max - 1) % max;
        }
    }

    /// Filter clone branches by the current query
    fn filter_clones<'a>(&self, branches: &'a [String]) -> Vec<&'a String> {
        if self.query.is_empty() {
            return branches.iter().collect();
        }

        let matcher = SkimMatcherV2::default();
        let mut scored: Vec<(&String, i64)> = branches
            .iter()
            .filter_map(|b| {
                matcher
                    .fuzzy_match(b, &self.query)
                    .map(|score| (b, score))
            })
            .collect();

        scored.sort_by(|a, b| b.1.cmp(&a.1));
        scored.into_iter().map(|(b, _)| b).collect()
    }
}

// ---------------------------------------------------------------------------
// Pattern 5: Case sensitivity configuration
// ---------------------------------------------------------------------------
fn case_sensitive_matcher() {
    let matcher = SkimMatcherV2::default()
        .smart_case()  // lowercase query = case-insensitive, mixed = case-sensitive
        .use_cache(true); // cache compiled patterns for repeated queries

    let _ = matcher.fuzzy_match("FeatAuth", "fa");
    // smart_case: "fa" is all-lowercase → matches case-insensitively
}
