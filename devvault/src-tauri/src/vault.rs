//! Unlock/lock state held in memory. The derived key lives here and nowhere
//! else; it is dropped (and zeroized) on `lock()` and never serialized.

use std::sync::Mutex;
use std::time::Duration;

use rusqlite::Connection;

use crate::crypto::Key32;

/// Failed-unlock threshold before we start throttling (spec §5).
const RATE_LIMIT_AFTER: u32 = 5;
/// Per-attempt delay added past the threshold, capped.
const MAX_DELAY_SECS: u64 = 5;

/// Shared application state, registered with Tauri via `manage`.
pub struct VaultState {
    pub db: Mutex<Connection>,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    key: Option<Key32>,
    failed_attempts: u32,
}

impl VaultState {
    pub fn new(db: Connection) -> Self {
        VaultState {
            db: Mutex::new(db),
            inner: Mutex::new(Inner::default()),
        }
    }

    pub fn is_unlocked(&self) -> bool {
        self.inner.lock().unwrap().key.is_some()
    }

    /// Store the key in memory and reset the failure counter.
    pub fn unlock_with(&self, key: Key32) {
        let mut inner = self.inner.lock().unwrap();
        inner.key = Some(key);
        inner.failed_attempts = 0;
    }

    /// Drop the in-memory key. Zeroized on drop via `Zeroizing`.
    pub fn lock(&self) {
        self.inner.lock().unwrap().key = None;
    }

    /// Clone the live key for an encrypt/decrypt operation. The clone is wrapped
    /// in `Zeroizing`, so it wipes itself when the caller drops it.
    pub fn current_key(&self) -> Option<Key32> {
        self.inner.lock().unwrap().key.clone()
    }

    /// Block briefly if the caller has exceeded the failure threshold, then
    /// record this failure. Returns nothing; throttling is the side effect.
    pub fn throttle_then_record_failure(&self) {
        let delay = {
            let inner = self.inner.lock().unwrap();
            if inner.failed_attempts >= RATE_LIMIT_AFTER {
                let over = inner.failed_attempts - RATE_LIMIT_AFTER + 1;
                Some(Duration::from_secs((over as u64).min(MAX_DELAY_SECS)))
            } else {
                None
            }
        };
        // Sleep with the lock released so other commands aren't blocked.
        if let Some(d) = delay {
            std::thread::sleep(d);
        }
        self.inner.lock().unwrap().failed_attempts += 1;
    }
}
