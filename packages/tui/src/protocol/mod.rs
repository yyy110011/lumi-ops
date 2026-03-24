//! Lumi Protocol parsers — reads file-based state from the Lumi-Ops ecosystem.
//!
//! All types here mirror the TypeScript definitions in `@lumi-ops/cli`.

pub mod agent;
pub mod metadata;
pub mod mission;
pub mod registry;
pub mod worktree;

// Re-export key types for convenient access.
pub use agent::{AgentInfo, AgentStatus};
pub use metadata::{CloneMetadata, MetadataMap, ReviewStatus};
pub use registry::RegisteredRepo;
pub use worktree::ShadowClone;
