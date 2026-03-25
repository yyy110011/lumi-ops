//! Lumi Protocol parsers — reads file-based state from the Lumi-Ops ecosystem.
//!
//! All types here mirror the TypeScript definitions in `@lumi-ops/cli`.

pub mod agent;
pub mod metadata;
pub mod mission;
pub mod registry;
pub mod worktree;

// Re-export key types for convenient access.
#[allow(unused_imports)]
pub use agent::{AgentInfo, AgentStatus};
#[allow(unused_imports)]
pub use metadata::{CloneMetadata, MetadataMap, ReviewStatus};
#[allow(unused_imports)]
pub use registry::RegisteredRepo;
#[allow(unused_imports)]
pub use worktree::ShadowClone;
