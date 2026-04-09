---
name: codebase-pattern-mining
description: Research an external codebase to extract design patterns, then produce a tiered analysis of what's adaptable to the current project.
when_to_use: >
  Use when the user wants to study an external codebase or project to find
  transferable patterns, architecture ideas, or best practices. Examples:
  'research X for patterns', 'analyze X codebase', 'see what we can learn from X',
  'mine patterns from X', 'what can we borrow from X', '研究一下X有什麼可以借鑑的'.
argument-hint: "[source_path] [optional focus area]"
arguments:
  - source_path
  - focus
---

# Codebase Pattern Mining

Analyze an external codebase to extract transferable design patterns, then produce
a tiered report mapping each pattern to the current project.

## Inputs
- `$source_path`: Path to the external codebase to analyze
- `$focus`: (Optional) Area of focus — e.g. "agent coordination", "plugin system", "testing patterns"

## Goal
Produce a structured analysis artifact that:
- Identifies valuable patterns in the source codebase
- Categorizes them by priority (ROI vs effort)
- Maps each pattern to concrete files/locations in the current project
- Lists open questions for the user to decide on

The skill ends at the report — it does NOT execute any changes.

## Steps

### 1. Explore the Source Codebase
Survey the target codebase to understand its architecture:
- `list_dir` the root and key directories
- `view_file` on entry points, config files, and README
- `grep_search` for patterns related to `$focus` (if provided)
- Identify the project's tech stack, structure, and key modules

If the user has provided prior analysis (e.g. a resolved artifact), read that first
to avoid redundant work.

**Rules:**
- Do NOT modify any files in either codebase
- Spend time understanding, not skimming — this phase determines report quality

**Success criteria**: You can describe the source project's architecture, key modules, and design philosophy.

### 2. Extract Patterns
Identify transferable patterns and categorize into three tiers:

| Tier | Criteria | Examples |
|------|----------|---------|
| **Tier 1** | High ROI, low-to-medium effort, directly applicable | Prompt improvements, config patterns |
| **Tier 2** | Medium ROI, requires some adaptation | Workflow changes, new abstractions |
| **Tier 3** | Interesting but significant effort or unclear value | Architecture overhauls, new systems |

For each pattern, document:
- **What it is** — the pattern name and a 1-2 sentence description
- **How the source does it** — specific file paths and code references
- **Current state in our project** — do we already have something similar?

**Rules:**
- Include file paths and line numbers from the source codebase as evidence
- Don't list everything — curate the most valuable patterns (aim for 5-12 total)
- If `$focus` is provided, prioritize patterns in that area

**Success criteria**: A curated list of 5-12 patterns across tiers, each with source evidence.

### 3. Map to Current Project
For each extracted pattern, identify:
- **Target files** — which files in our project would need changes
- **Gap analysis** — what's the delta between current state and the pattern
- **Proposed approach** — high-level description of how to adapt it
- **Open questions** — design decisions that require user input

**Rules:**
- Every pattern MUST have at least one open question or explicit "no questions" note
- Reference concrete file paths in the current project
- Be honest about effort estimates — don't undersell complexity
- Patterns that only require prompt/config changes should be clearly marked as such

**Success criteria**: Each pattern has a concrete mapping to our project with file paths and open questions.

### 4. Produce the Analysis Report
Create an artifact with the complete analysis, structured as:

```markdown
# Pattern Mining: [Source Project Name]

## Executive Summary
What the source project is, what we focused on, key takeaways (3-5 sentences).

## Tier 1 — High Priority
### [Pattern Name]
- **Source**: how they do it (with file paths)
- **Our project**: current state
- **Gap**: what's missing
- **Proposed change**: what to do and where
- **Effort**: low / medium / high
- **Open questions**: decisions for the user

## Tier 2 — Medium Priority
(same structure)

## Tier 3 — Future Consideration
(same structure)

## Open Questions Summary
Consolidated list of all decisions needed from the user.
```

**Rules:**
- The report is the FINAL DELIVERABLE — do NOT proceed to implementation
- When the user asks "how does [source] do X?", go back and read the actual
  source code to answer — don't guess from memory
- Present the artifact and wait for user feedback
- Do NOT treat artifact auto-approval as permission to implement

**Success criteria**: A complete, well-structured analysis artifact has been presented to the user.
