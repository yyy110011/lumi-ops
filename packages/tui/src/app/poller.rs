//! Background polling tasks for metadata.
//!
//! The metadata poller runs as a `tokio::spawn` task that periodically reads
//! clone state and sends updates to the main event loop via `mpsc::Sender<StateUpdate>`.

use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::app::StateUpdate;

/// Spawn a background task that polls clone metadata every 2 seconds.
///
/// Calls `lumi-ops list --json` via the CLI subprocess wrapper and sends
/// `StateUpdate::ClonesRefreshed` with the updated clone list.
///
/// Returns a `JoinHandle` for lifecycle management (abort on repo change).
pub fn spawn_metadata_poller(
    tx: mpsc::Sender<StateUpdate>,
    repo_root: String,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));

        loop {
            interval.tick().await;

            match crate::cli::list_clones(&repo_root).await {
                Ok(clones) => {
                    // Filter to shadow clones only (exclude main worktree)
                    let shadow_clones: Vec<_> =
                        clones.into_iter().filter(|c| c.is_shadow).collect();
                    if tx
                        .send(StateUpdate::ClonesRefreshed(shadow_clones))
                        .await
                        .is_err()
                    {
                        // Receiver dropped — main loop exited
                        tracing::debug!("Metadata poller: channel closed, stopping");
                        break;
                    }
                }
                Err(e) => {
                    // Gracefully handle repos that have no clones or CLI not installed
                    tracing::warn!("Metadata poll failed: {}", e);
                }
            }
        }
    })
}
