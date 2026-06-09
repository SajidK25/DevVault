use serde::Serialize;

/// All backend errors. Serializes to a plain string for the frontend so the
/// React layer can show `String(err)` directly.
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("vault is already set up")]
    AlreadySetup,

    #[error("vault has not been set up yet")]
    NotSetup,

    #[error("vault is locked")]
    Locked,

    #[error("incorrect master password")]
    BadPassword,

    #[error("too many failed attempts — wait a moment and try again")]
    #[allow(dead_code)]
    RateLimited,

    #[error("{0} not found")]
    NotFound(String),

    #[error("{0}")]
    Conflict(String),

    #[error("crypto error: {0}")]
    Crypto(String),

    #[error("database error: {0}")]
    Db(String),

    #[error("io error: {0}")]
    Io(String),
}

impl From<rusqlite::Error> for VaultError {
    fn from(e: rusqlite::Error) -> Self {
        VaultError::Db(e.to_string())
    }
}

impl From<std::io::Error> for VaultError {
    fn from(e: std::io::Error) -> Self {
        VaultError::Io(e.to_string())
    }
}

// Tauri commands must return a serializable error.
impl Serialize for VaultError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, VaultError>;
