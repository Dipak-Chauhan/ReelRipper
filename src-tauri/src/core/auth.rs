use keyring::Entry;
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use super::database;

const KEYRING_PASSWORD_SERVICE: &str = "ReelRipper_Password";
const KEYRING_ENCRYPTION_KEY_SERVICE: &str = "ReelRipper_SessionKey";

#[derive(Serialize, Deserialize)]
struct EncryptedSession {
    ciphertext: String,
    nonce: String,
    tag: String,
}

pub fn get_password(username: &str) -> Option<String> {
    let entry = Entry::new(KEYRING_PASSWORD_SERVICE, username).ok()?;
    entry.get_password().ok()
}

pub fn set_password(username: &str, password: &str) -> Result<(), String> {
    let entry = Entry::new(KEYRING_PASSWORD_SERVICE, username)
        .map_err(|e| format!("Keyring error: {}", e))?;
    entry.set_password(password)
        .map_err(|e| format!("Failed to set password in keyring: {}", e))?;
    Ok(())
}

pub fn delete_password(username: &str) {
    if let Ok(entry) = Entry::new(KEYRING_PASSWORD_SERVICE, username) {
        let _ = entry.delete_password();
    }
}

fn get_or_create_encryption_key(username: &str) -> Result<Vec<u8>, String> {
    let entry = Entry::new(KEYRING_ENCRYPTION_KEY_SERVICE, username)
        .map_err(|e| format!("Keyring error: {}", e))?;
        
    if let Ok(hex_key) = entry.get_password() {
        if let Ok(key) = hex::decode(hex_key) {
            return Ok(key);
        }
    }
    
    // Generate new random 32-byte key
    use rand::RngCore;
    let mut key = vec![0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    
    let hex_key = hex::encode(&key);
    let _ = entry.set_password(&hex_key);
    
    Ok(key)
}

pub fn delete_encryption_key(username: &str) {
    if let Ok(entry) = Entry::new(KEYRING_ENCRYPTION_KEY_SERVICE, username) {
        let _ = entry.delete_password();
    }
}

pub fn encrypt_session(username: &str, session_data: &Value) -> Result<Value, String> {
    let key_bytes = get_or_create_encryption_key(username)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    
    let serialized = serde_json::to_string(session_data)
        .map_err(|e| format!("Serialization error: {}", e))?;
        
    // Generate nonce
    use rand::RngCore;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher.encrypt(nonce, serialized.as_bytes())
        .map_err(|e| format!("Encryption error: {}", e))?;
        
    // In aes-gcm crate, tag is appended to ciphertext by default
    // We separate them to match Python's output
    let tag_pos = ciphertext.len() - 16;
    let actual_ciphertext = &ciphertext[..tag_pos];
    let tag = &ciphertext[tag_pos..];
    
    Ok(serde_json::to_value(EncryptedSession {
        ciphertext: hex::encode(actual_ciphertext),
        nonce: hex::encode(nonce_bytes),
        tag: hex::encode(tag),
    }).unwrap())
}

pub fn decrypt_session(username: &str, encrypted_val: &Value) -> Result<Value, String> {
    let enc: EncryptedSession = serde_json::from_value(encrypted_val.clone())
        .map_err(|e| format!("Invalid encrypted session format: {}", e))?;
        
    let key_bytes = get_or_create_encryption_key(username)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    
    let ciphertext_bytes = hex::decode(&enc.ciphertext)
        .map_err(|e| format!("Hex decode error: {}", e))?;
    let nonce_bytes = hex::decode(&enc.nonce)
        .map_err(|e| format!("Hex decode error: {}", e))?;
    let tag_bytes = hex::decode(&enc.tag)
        .map_err(|e| format!("Hex decode error: {}", e))?;
        
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    // Reassemble ciphertext + tag
    let mut full_ciphertext = ciphertext_bytes;
    full_ciphertext.extend_from_slice(&tag_bytes);
    
    let decrypted_bytes = cipher.decrypt(nonce, full_ciphertext.as_ref())
        .map_err(|e| format!("Decryption error: {}", e))?;
        
    let decrypted_str = String::from_utf8(decrypted_bytes)
        .map_err(|e| format!("Utf8 error: {}", e))?;
        
    let parsed: Value = serde_json::from_str(&decrypted_str)
        .map_err(|e| format!("JSON parse error: {}", e))?;
        
    Ok(parsed)
}

pub async fn load_session(pool: &SqlitePool, username: &str) -> Option<Value> {
    let key = format!("session_encrypted_{}", username);
    let stored_val = database::get_setting(pool, &key, None).await.ok()??;
    let encrypted_json = serde_json::from_str::<Value>(&stored_val).ok()?;
    decrypt_session(username, &encrypted_json).ok()
}

pub async fn save_session(pool: &SqlitePool, username: &str, session_data: &Value) -> Result<(), String> {
    let key = format!("session_encrypted_{}", username);
    let encrypted_json = encrypt_session(username, session_data)?;
    let serialized = serde_json::to_string(&encrypted_json)
        .map_err(|e| format!("JSON serialize error: {}", e))?;
    database::set_setting(pool, &key, &serialized)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    Ok(())
}
