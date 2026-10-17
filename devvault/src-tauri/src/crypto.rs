//! All cryptography lives here and only here (spec §7 key rule).
//!
//! - Key derivation: Argon2id (memory-hard) from the master password + salt.
//! - Value encryption: AES-256-GCM with a fresh random 96-bit nonce per value.
//! - On-disk blob layout for an encrypted value: `nonce(12) || ciphertext+tag`.
//!
//! The derived key is wrapped in `Zeroizing` so it is wiped from memory on drop.

use aes_gcm::aead::{Aead, AeadCore, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::rngs::OsRng;
use rand::RngCore;
use zeroize::Zeroizing;

use crate::error::{Result, VaultError};

pub const KEY_LEN: usize = 32; // AES-256
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12; // GCM standard

/// Fixed plaintext encrypted at setup with the derived key. On unlock we try to
/// decrypt the stored verifier; GCM authentication succeeds only with the right
/// key, which is how we know the master password was correct — without ever
/// storing the password or the key.
const VERIFY_PLAINTEXT: &[u8] = b"devvault-verify-v1";

/// Argon2id tuning parameters. Persisted alongside the salt so future unlocks
/// reproduce the same key even if defaults change.
#[derive(Debug, Clone, Copy)]
pub struct KdfParams {
    pub mem_kib: u32,
    pub iters: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        // ~64 MB, 3 passes — tuned for roughly a quarter second on a laptop.
        KdfParams {
            mem_kib: 65_536,
            iters: 3,
            parallelism: 1,
        }
    }
}

/// 32-byte symmetric key, zeroized on drop.
pub type Key32 = Zeroizing<[u8; KEY_LEN]>;

/// Generate a fresh random salt for a new vault.
pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Derive the AES key from the master password and salt using Argon2id.
pub fn derive_key(password: &str, salt: &[u8], params: KdfParams) -> Result<Key32> {
    let argon_params = Params::new(
        params.mem_kib,
        params.iters,
        params.parallelism,
        Some(KEY_LEN),
    )
    .map_err(|e| VaultError::Crypto(format!("argon2 params: {e}")))?;

    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);

    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon
        .hash_password_into(password.as_bytes(), salt, key.as_mut_slice())
        .map_err(|e| VaultError::Crypto(format!("argon2 derive: {e}")))?;
    Ok(key)
}

/// Encrypt a value. Output is `nonce || ciphertext+tag`.
pub fn encrypt(key: &Key32, plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_slice()));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| VaultError::Crypto(format!("encrypt: {e}")))?;

    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(nonce.as_slice());
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a `nonce || ciphertext+tag` blob. Fails (BadPassword) if the GCM tag
/// doesn't verify — i.e. wrong key or tampered data.
pub fn decrypt(key: &Key32, blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < NONCE_LEN {
        return Err(VaultError::Crypto("ciphertext too short".into()));
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_slice()));
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| VaultError::BadPassword)
}

/// Build the verifier blob to persist at setup time.
pub fn make_verifier(key: &Key32) -> Result<Vec<u8>> {
    encrypt(key, VERIFY_PLAINTEXT)
}

/// True if `key` correctly decrypts the stored verifier.
pub fn verify_key(key: &Key32, verifier: &[u8]) -> bool {
    matches!(decrypt(key, verifier), Ok(pt) if pt == VERIFY_PLAINTEXT)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Fast params keep the test suite snappy; production uses KdfParams::default().
    fn test_params() -> KdfParams {
        KdfParams {
            mem_kib: 4096,
            iters: 1,
            parallelism: 1,
        }
    }

    #[test]
    fn derive_is_deterministic() {
        let salt = [7u8; SALT_LEN];
        let a = derive_key("correct horse", &salt, test_params()).unwrap();
        let b = derive_key("correct horse", &salt, test_params()).unwrap();
        assert_eq!(a.as_slice(), b.as_slice());
    }

    #[test]
    fn derive_differs_by_salt() {
        let a = derive_key("pw", &[1u8; SALT_LEN], test_params()).unwrap();
        let b = derive_key("pw", &[2u8; SALT_LEN], test_params()).unwrap();
        assert_ne!(a.as_slice(), b.as_slice());
    }

    #[test]
    fn derive_differs_by_password() {
        let salt = [9u8; SALT_LEN];
        let a = derive_key("alpha", &salt, test_params()).unwrap();
        let b = derive_key("bravo", &salt, test_params()).unwrap();
        assert_ne!(a.as_slice(), b.as_slice());
    }

    #[test]
    fn encrypt_decrypt_round_trip() {
        let key = derive_key("pw", &[3u8; SALT_LEN], test_params()).unwrap();
        let msg = b"super secret api key value";
        let blob = encrypt(&key, msg).unwrap();
        // Plaintext must not appear in the ciphertext.
        assert!(!blob.windows(msg.len()).any(|w| w == msg));
        let back = decrypt(&key, &blob).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn empty_plaintext_round_trips() {
        let key = derive_key("pw", &[4u8; SALT_LEN], test_params()).unwrap();
        let blob = encrypt(&key, b"").unwrap();
        assert_eq!(decrypt(&key, &blob).unwrap(), b"");
    }

    #[test]
    fn wrong_key_fails_to_decrypt() {
        let salt = [5u8; SALT_LEN];
        let key = derive_key("right", &salt, test_params()).unwrap();
        let wrong = derive_key("wrong", &salt, test_params()).unwrap();
        let blob = encrypt(&key, b"data").unwrap();
        assert!(matches!(
            decrypt(&wrong, &blob),
            Err(VaultError::BadPassword)
        ));
    }

    #[test]
    fn nonce_is_unique_per_encryption() {
        let key = derive_key("pw", &[6u8; SALT_LEN], test_params()).unwrap();
        let a = encrypt(&key, b"same").unwrap();
        let b = encrypt(&key, b"same").unwrap();
        // Identical plaintext + key must still yield different blobs (fresh nonce).
        assert_ne!(a, b);
        assert_ne!(a[..NONCE_LEN], b[..NONCE_LEN]);
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = derive_key("pw", &[8u8; SALT_LEN], test_params()).unwrap();
        let mut blob = encrypt(&key, b"data").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0xff; // flip a tag bit
        assert!(decrypt(&key, &blob).is_err());
    }

    #[test]
    fn too_short_blob_errors() {
        let key = derive_key("pw", &[10u8; SALT_LEN], test_params()).unwrap();
        assert!(decrypt(&key, &[0u8; 4]).is_err());
    }

    #[test]
    fn verifier_accepts_right_key_rejects_wrong() {
        let salt = [11u8; SALT_LEN];
        let key = derive_key("master", &salt, test_params()).unwrap();
        let wrong = derive_key("nope", &salt, test_params()).unwrap();
        let v = make_verifier(&key).unwrap();
        assert!(verify_key(&key, &v));
        assert!(!verify_key(&wrong, &v));
    }

    #[test]
    fn generated_salts_differ() {
        assert_ne!(generate_salt(), generate_salt());
    }
}
