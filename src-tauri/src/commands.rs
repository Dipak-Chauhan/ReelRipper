use std::sync::Arc;
use tokio::sync::Mutex;
use serde_json::{json, Value};
use tauri::{State, AppHandle, Manager};
use sqlx::SqlitePool;
use super::core::database::{self, MediaCacheItem, QueueItem, DownloadHistoryItem};
use super::core::config::{ConfigManager, AppConfig};
use super::core::queue::QueueManager;
use super::core::auth;
use crate::sidecar::scraper::ScraperController;

// Helper to wrap commands state
pub struct AppState {
    pub pool: SqlitePool,
    pub scraper: Arc<ScraperController>,
    pub config: Arc<Mutex<ConfigManager>>,
    pub queue: Arc<QueueManager>,
}

#[tauri::command]
pub async fn login(
    username: String,
    password: Option<String>,
    remember_me: bool,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let username = username.trim().to_lowercase();
    
    // Resolve password: check keyring if none provided
    let resolved_password = match password {
        Some(ref p) if !p.is_empty() => p.clone(),
        _ => auth::get_password(&username).unwrap_or_default(),
    };
    
    // Attempt to load existing session settings
    let session_settings = auth::load_session(&state.pool, &username).await;
    
    // Call sidecar login
    let login_res = state.scraper.send_command("login", json!({
        "username": username,
        "password": resolved_password,
        "session_settings": session_settings
    })).await;
    
    match login_res {
        Ok(res) => {
            // Login succeeded, persist session if remember_me
            if remember_me {
                if let Some(new_session) = res.get("session_settings") {
                    let _ = auth::save_session(&state.pool, &username, new_session).await;
                }
                let _ = auth::set_password(&username, &resolved_password);
                let _ = database::set_setting(&state.pool, "remembered_username", &username).await;
            }
            Ok(json!({ "status": "success", "username": username }))
        }
        Err(e) => {
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn logout(username: String, state: State<'_, AppState>) -> Result<Value, String> {
    let username = username.trim().to_lowercase();
    
    // Remove credentials
    auth::delete_password(&username);
    auth::delete_encryption_key(&username);
    let _ = database::set_setting(&state.pool, &format!("session_encrypted_{}", username), "").await;
    let _ = database::set_setting(&state.pool, "remembered_username", "").await;
    
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn submit_otp(code: String, state: State<'_, AppState>) -> Result<Value, String> {
    state.scraper.submit_otp(&code).await?;
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn trigger_sync(state: State<'_, AppState>, app_handle: AppHandle) -> Result<Value, String> {
    let pool = state.pool.clone();
    let scraper = state.scraper.clone();
    
    tauri::async_runtime::spawn(async move {
        let _ = app_handle.emit_all("sync-status", json!({ "status": "STARTED", "scraped_count": 0 }));
        
        let mut scraped_count = 0;
        let mut new_count = 0;
        let mut max_id = String::new();
        let mut has_more = true;
        
        while has_more {
            let res = scraper.send_command("scrape_saved", json!({ "max_id": max_id })).await;
            
            match res {
                Ok(data) => {
                    let items_val = data.get("items").cloned().unwrap_or(Value::Null);
                    let items_list: Vec<MediaCacheItem> = serde_json::from_value(items_val).unwrap_or_default();
                    
                    if items_list.is_empty() {
                        break;
                    }
                    
                    let mut items_to_cache = Vec::new();
                    let mut hit_cached = false;
                    
                    for item in items_list {
                        scraped_count += 1;
                        
                        // Check if already in database
                        let cached = database::get_cached_media(&pool, &item.media_id).await.ok().flatten();
                        if cached.is_some() {
                            // Delta sync logic: stop scraping if we hit an already cached item
                            hit_cached = true;
                            break;
                        }
                        
                        new_count += 1;
                        items_to_cache.push(item);
                    }
                    
                    if !items_to_cache.is_empty() {
                        let _ = database::cache_media_items(&pool, items_to_cache).await;
                    }
                    
                    let _ = app_handle.emit_all("sync-status", json!({
                        "status": "PROGRESS",
                        "scraped_count": scraped_count,
                        "new_count": new_count
                    }));
                    
                    max_id = data.get("next_max_id").and_then(|m| m.as_str()).unwrap_or("").to_string();
                    if max_id.is_empty() || hit_cached {
                        has_more = false;
                    }
                }
                Err(e) => {
                    let _ = app_handle.emit_all("sync-status", json!({ "status": "ERROR", "message": e }));
                    return;
                }
            }
            
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        
        let _ = app_handle.emit_all("sync-status", json!({
            "status": "FINISHED",
            "scraped_count": scraped_count,
            "new_count": new_count
        }));
    });
    
    Ok(json!({ "status": "sync_triggered" }))
}

#[tauri::command]
pub async fn get_library_items(state: State<'_, AppState>) -> Result<Vec<MediaCacheItem>, String> {
    database::get_all_cached_media(&state.pool)
        .await
        .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
pub async fn add_to_queue(media_id: String, priority: i64, state: State<'_, AppState>) -> Result<Value, String> {
    let is_new = database::add_to_queue(&state.pool, &media_id, priority)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
        
    state.queue.trigger_loop();
    let _ = state.queue.get_stats().await; // updates stats
    Ok(json!({ "status": "success", "new_item": is_new }))
}

#[tauri::command]
pub async fn add_all_to_queue(media_ids: Vec<String>, state: State<'_, AppState>) -> Result<Value, String> {
    for media_id in media_ids {
        let _ = database::add_to_queue(&state.pool, &media_id, 0).await;
    }
    state.queue.trigger_loop();
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn get_queue_items(state: State<'_, AppState>) -> Result<Vec<QueueItem>, String> {
    database::get_queue_items(&state.pool)
        .await
        .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
pub async fn pause_queue(state: State<'_, AppState>) -> Result<Value, String> {
    state.queue.pause();
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn resume_queue(state: State<'_, AppState>) -> Result<Value, String> {
    state.queue.resume();
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn remove_from_queue(media_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    database::remove_from_queue(&state.pool, &media_id)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    state.queue.trigger_loop();
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn clear_completed_queue(state: State<'_, AppState>) -> Result<Value, String> {
    database::clear_completed_queue(&state.pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    state.queue.trigger_loop();
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn clear_entire_queue(state: State<'_, AppState>) -> Result<Value, String> {
    database::clear_entire_queue(&state.pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    state.queue.trigger_loop();
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn get_downloads_history(state: State<'_, AppState>) -> Result<Vec<DownloadHistoryItem>, String> {
    database::get_downloads_history(&state.pool)
        .await
        .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
pub async fn clear_download_history(state: State<'_, AppState>) -> Result<Value, String> {
    database::clear_download_history(&state.pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn delete_download_record(id: i64, state: State<'_, AppState>) -> Result<Value, String> {
    database::delete_download_record(&state.pool, id)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let cfg = state.config.lock().await.get_config();
    Ok(cfg)
}

#[tauri::command]
pub async fn save_settings(settings: AppConfig, state: State<'_, AppState>) -> Result<Value, String> {
    // 1. Update config manager
    state.config.lock().await.update_config(settings.clone());
    
    // 2. Persist in settings DB table for sidecar accessibility
    if let Ok(serialized) = serde_json::to_string(&settings) {
        let _ = database::set_setting(&state.pool, "config", &serialized).await;
    }
    
    // 3. Update queue manager concurrency limit
    state.queue.set_concurrency(settings.concurrency_limit).await;
    
    Ok(json!({ "status": "success" }))
}

#[tauri::command]
pub async fn select_directory(state: State<'_, AppState>) -> Result<Option<String>, String> {
    // Tauri dialog for directory selection
    use tauri::api::dialog::blocking::FileDialogBuilder;
    let folder = FileDialogBuilder::new().pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn get_remembered_username(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let val = database::get_setting(&state.pool, "remembered_username", None)
        .await
        .unwrap_or(None);
    Ok(val)
}
