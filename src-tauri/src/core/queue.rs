use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{Notify, Mutex};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::collections::HashSet;
use super::database::{self, QueueItem, DownloadRecord};
use super::downloader::download_file_chunked;
use super::filename::get_unique_filepath;
use crate::sidecar::scraper::ScraperController;

pub struct QueueManager {
    pool: SqlitePool,
    scraper: Arc<ScraperController>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    is_paused: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    concurrency: Arc<Mutex<usize>>,
    active_downloads: Arc<Mutex<HashSet<String>>>,
    loop_notify: Arc<Notify>,
}

impl QueueManager {
    pub fn new(pool: SqlitePool, scraper: Arc<ScraperController>) -> Self {
        Self {
            pool,
            scraper,
            app_handle: Arc::new(Mutex::new(None)),
            is_paused: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
            concurrency: Arc::new(Mutex::new(3)),
            active_downloads: Arc::new(Mutex::new(HashSet::new())),
            loop_notify: Arc::new(Notify::new()),
        }
    }

    pub async fn start(self: &Arc<Self>, app_handle: AppHandle) {
        *self.app_handle.lock().await = Some(app_handle);
        if self.running.swap(true, Ordering::SeqCst) {
            return; // Already running
        }

        let manager = self.clone();
        tokio::spawn(async move {
            manager.run_loop().await;
        });
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        self.loop_notify.notify_one();
    }

    pub fn pause(&self) {
        self.is_paused.store(true, Ordering::SeqCst);
        let app_handle = self.app_handle.clone();
        let stats = self.get_stats_sync();
        tokio::spawn(async move {
            if let Some(ref handle) = *app_handle.lock().await {
                let _ = handle.emit_all("queue-stats-updated", stats);
            }
        });
    }

    pub fn resume(&self) {
        self.is_paused.store(false, Ordering::SeqCst);
        self.loop_notify.notify_one();
        let app_handle = self.app_handle.clone();
        let stats = self.get_stats_sync();
        tokio::spawn(async move {
            if let Some(ref handle) = *app_handle.lock().await {
                let _ = handle.emit_all("queue-stats-updated", stats);
            }
        });
    }

    pub fn is_paused(&self) -> bool {
        self.is_paused.load(Ordering::SeqCst)
    }

    pub async fn set_concurrency(&self, limit: usize) {
        let mut c = self.concurrency.lock().await;
        *c = limit;
        self.loop_notify.notify_one();
    }

    pub fn trigger_loop(&self) {
        self.loop_notify.notify_one();
    }

    pub async fn get_stats(&self) -> Value {
        let items = database::get_queue_items(&self.pool).await.unwrap_or_default();
        let total = items.len();
        let completed = items.iter().filter(|i| i.status == "COMPLETED").count();
        let failed = items.iter().filter(|i| i.status == "FAILED").count();
        let active = self.active_downloads.lock().await.len();
        
        json!({
            "total": total,
            "completed": completed,
            "failed": failed,
            "active": active,
            "is_paused": self.is_paused.load(Ordering::SeqCst)
        })
    }

    // Fallback sync stats for fast event triggers
    fn get_stats_sync(&self) -> Value {
        json!({
            "is_paused": self.is_paused.load(Ordering::SeqCst)
        })
    }

    async fn run_loop(&self) {
        while self.running.load(Ordering::SeqCst) {
            if self.is_paused.load(Ordering::SeqCst) {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                continue;
            }

            let active_len = self.active_downloads.lock().await.len();
            let limit = *self.concurrency.lock().await;

            if active_len >= limit {
                // Wait until notified of a slot opening
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                continue;
            }

            // Get next pending queue item
            let items = match database::get_queue_items(&self.pool).await {
                Ok(it) => it,
                Err(_) => {
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    continue;
                }
            };

            let pending_items: Vec<QueueItem> = items
                .into_iter()
                .filter(|i| i.status == "PENDING")
                .collect();

            if pending_items.is_empty() {
                // Wait until a new item is queued
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                continue;
            }

            let next_item = pending_items[0].clone();
            let media_id = next_item.media_id.clone();

            // Mark as active
            self.active_downloads.lock().await.insert(media_id.clone());
            let _ = database::update_queue_status(&self.pool, &media_id, "DOWNLOADING").await;
            
            let stats = self.get_stats().await;
            let app_handle = self.app_handle.clone();
            let media_id_clone = media_id.clone();
            tokio::spawn(async move {
                if let Some(ref handle) = *app_handle.lock().await {
                    let _ = handle.emit_all("download-status", json!({ "media_id": media_id_clone, "status": "DOWNLOADING" }));
                    let _ = handle.emit_all("queue-stats-updated", stats);
                }
            });

            // Spawn download task
            let pool_clone = self.pool.clone();
            let scraper_clone = self.scraper.clone();
            let app_handle_clone = self.app_handle.clone();
            let active_clone = self.active_downloads.clone();
            let loop_notify_clone = self.loop_notify.clone();

            tokio::spawn(async move {
                let handle_opt = {
                    let guard = app_handle_clone.lock().await;
                    guard.clone()
                };
                if let Some(handle) = handle_opt {
                    let _ = Self::download_job(pool_clone, scraper_clone, handle, next_item).await;
                }
                
                // Remove from active list
                active_clone.lock().await.remove(&media_id);
                loop_notify_clone.notify_one();
            });
            
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }

    async fn download_job(
        pool: SqlitePool,
        scraper: Arc<ScraperController>,
        app_handle: AppHandle,
        item: QueueItem,
    ) -> Result<String, String> {
        let media_id = item.media_id.clone();
        let username = item.username.clone();
        let media_type = item.media_type.clone();
        let taken_at = item.taken_at.clone();

        // Get download destination directory from settings (fallback to default)
        let config_str = database::get_setting(&pool, "config", None).await.unwrap_or(None);
        let download_dir = if let Some(cs) = config_str {
            if let Ok(cfg) = serde_json::from_str::<super::config::AppConfig>(&cs) {
                cfg.download_dir
            } else {
                super::config::AppConfig::default().download_dir
            }
        } else {
            super::config::AppConfig::default().download_dir
        };

        // Check if already in history
        let history = database::get_downloads_history(&pool).await.unwrap_or_default();
        let already_downloaded = history.iter().any(|h| h.media_id == media_id && h.status == "COMPLETED");
        if already_downloaded {
            let _ = database::update_queue_status(&pool, &media_id, "SKIPPED").await;
            let _ = app_handle.emit_all("download-status", json!({ "media_id": media_id, "status": "SKIPPED", "path": "" }));
            return Ok("".to_string());
        }

        // Gather urls to download
        let mut urls_to_download: Vec<(String, String, Option<usize>, Option<usize>)> = Vec::new();

        if media_type == "CAROUSEL" {
            let mut resources: Vec<Value> = Vec::new();
            if let Some(ref res_json) = item.resources_json {
                if let Ok(parsed) = serde_json::from_str::<Vec<Value>>(res_json) {
                    resources = parsed;
                }
            }
            
            for (idx, res) in resources.iter().enumerate() {
                let url = res.get("video_url")
                    .and_then(|u| u.as_str())
                    .or_else(|| res.get("thumbnail_url").and_then(|u| u.as_str()))
                    .unwrap_or("");
                    
                if !url.is_empty() {
                    let ext = if res.get("video_url").and_then(|u| u.as_str()).is_some() {
                        "mp4"
                    } else {
                        "jpg"
                    };
                    urls_to_download.push((url.to_string(), ext.to_string(), Some(idx + 1), Some(resources.len())));
                }
            }
        } else {
            let url = item.video_url.as_ref()
                .or(item.thumbnail_url.as_ref())
                .cloned()
                .unwrap_or_default();
                
            if !url.is_empty() {
                let ext = if item.video_url.is_some() { "mp4" } else { "jpg" };
                urls_to_download.push((url, ext.to_string(), None, None));
            }
        }

        if urls_to_download.is_empty() {
            let err_msg = "No valid download URLs found";
            let _ = Self::log_failure(&pool, &app_handle, &media_id, &username, err_msg).await;
            return Err(err_msg.to_string());
        }

        let mut downloaded_paths = Vec::new();
        let mut urls_expired = false;

        for (url, ext, idx, tot) in &urls_to_download {
            let dest_path = get_unique_filepath(
                &download_dir,
                &username,
                &taken_at,
                &media_type,
                &media_id,
                ext,
                *idx,
                *tot,
            );

            let media_id_clone = media_id.clone();
            let app_handle_clone = app_handle.clone();
            let res = download_file_chunked(&url, &dest_path, move |dl, tot_bytes| {
                if tot_bytes > 0 {
                    let pct = (dl as f32 / tot_bytes as f32) * 100.0;
                    let _ = app_handle_clone.emit_all("download-progress", json!({
                        "media_id": media_id_clone,
                        "progress": pct,
                        "downloaded": dl,
                        "total": tot_bytes
                    }));
                }
            }).await;

            match res {
                Ok(_) => {
                    downloaded_paths.push(dest_path);
                }
                Err(e) => {
                    if e == "EXPIRED_URL" {
                        urls_expired = true;
                        break;
                    } else {
                        let _ = Self::log_failure(&pool, &app_handle, &media_id, &username, &e).await;
                        return Err(e);
                    }
                }
            }
        }

        if urls_expired {
            // Refresh URLs from Instagrapi and retry
            let refresh_res = scraper.send_command("refresh_media", json!({ "media_id": media_id })).await;
            
            match refresh_res {
                Ok(refreshed_media) => {
                    // Update the media cache in database
                    if let Some(media_val) = refreshed_media.get("media") {
                        if let Ok(mut parsed_item) = serde_json::from_value::<database::MediaCacheItem>(media_val.clone()) {
                            parsed_item.scraped_at = chrono::Utc::now().to_rfc3339();
                            let _ = database::cache_media_items(&pool, vec![parsed_item.clone()]).await;
                            
                            // Re-build download list
                            urls_to_download.clear();
                            if media_type == "CAROUSEL" {
                                let mut resources: Vec<Value> = Vec::new();
                                if let Some(ref res_json) = parsed_item.resources_json {
                                    if let Ok(parsed) = serde_json::from_str::<Vec<Value>>(res_json) {
                                        resources = parsed;
                                    }
                                }
                                for (idx, res) in resources.iter().enumerate() {
                                    let url = res.get("video_url").and_then(|u| u.as_str()).or_else(|| res.get("thumbnail_url").and_then(|u| u.as_str())).unwrap_or("");
                                    if !url.is_empty() {
                                        let ext = if res.get("video_url").and_then(|u| u.as_str()).is_some() { "mp4" } else { "jpg" };
                                        urls_to_download.push((url.to_string(), ext.to_string(), Some(idx + 1), Some(resources.len())));
                                    }
                                }
                            } else {
                                let url = parsed_item.video_url.as_ref().or(parsed_item.thumbnail_url.as_ref()).cloned().unwrap_or_default();
                                if !url.is_empty() {
                                    let ext = if parsed_item.video_url.is_some() { "mp4" } else { "jpg" };
                                    urls_to_download.push((url, ext.to_string(), None, None));
                                }
                            }
                        }
                    }
                }
                Err(_) => {
                    // Fallback to yt-dlp
                    let fallback_res = scraper.send_command("resolve_fallback", json!({ "media_id": media_id })).await;
                    if let Ok(fb) = fallback_res {
                        if let Some(urls_val) = fb.get("urls") {
                            if let Ok(urls_list) = serde_json::from_value::<Vec<String>>(urls_val.clone()) {
                                urls_to_download.clear();
                                for (idx, url) in urls_list.iter().enumerate() {
                                    let ext = if url.contains(".mp4") || url.contains("video") { "mp4" } else { "jpg" };
                                    let car_args = if urls_list.len() > 1 { (Some(idx + 1), Some(urls_list.len())) } else { (None, None) };
                                    urls_to_download.push((url.clone(), ext.to_string(), car_args.0, car_args.1));
                                }
                            }
                        }
                    }
                }
            }

            if urls_to_download.is_empty() {
                let err_msg = "Failed to refresh URLs";
                let _ = Self::log_failure(&pool, &app_handle, &media_id, &username, err_msg).await;
                return Err(err_msg.to_string());
            }

            // Retry downloading with new URLs
            downloaded_paths.clear();
            for (url, ext, idx, tot) in &urls_to_download {
                let dest_path = get_unique_filepath(
                    &download_dir,
                    &username,
                    &taken_at,
                    &media_type,
                    &media_id,
                    ext,
                    *idx,
                    *tot,
                );

                let media_id_clone = media_id.clone();
                let app_handle_clone = app_handle.clone();
                let res = download_file_chunked(&url, &dest_path, move |dl, tot_bytes| {
                    if tot_bytes > 0 {
                        let pct = (dl as f32 / tot_bytes as f32) * 100.0;
                        let _ = app_handle_clone.emit_all("download-progress", json!({
                            "media_id": media_id_clone,
                            "progress": pct,
                            "downloaded": dl,
                            "total": tot_bytes
                        }));
                    }
                }).await;

                match res {
                    Ok(_) => {
                        downloaded_paths.push(dest_path);
                    }
                    Err(e) => {
                        let _ = Self::log_failure(&pool, &app_handle, &media_id, &username, &e).await;
                        return Err(e);
                    }
                }
            }
        }

        // Successfully downloaded
        let primary_path = downloaded_paths.get(0).cloned().unwrap_or_default();
        let filename = primary_path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let file_size = std::fs::metadata(&primary_path).map(|m| m.len() as i64).ok();

        let record = DownloadRecord {
            id: 0,
            media_id: media_id.clone(),
            filename,
            filepath: primary_path.to_string_lossy().into_owned(),
            file_size,
            status: "COMPLETED".to_string(),
            error_message: None,
            downloaded_at: chrono::Utc::now().to_rfc3339(),
        };

        let _ = database::add_download_record(&pool, &record).await;
        let _ = database::update_queue_status(&pool, &media_id, "COMPLETED").await;
        
        let _ = app_handle.emit_all("download-status", json!({
            "media_id": media_id,
            "status": "COMPLETED",
            "path": record.filepath
        }));
        
        Ok(record.filepath)
    }

    async fn log_failure(
        pool: &SqlitePool,
        app_handle: &AppHandle,
        media_id: &str,
        username: &str,
        error_msg: &str,
    ) -> Result<(), String> {
        let record = DownloadRecord {
            id: 0,
            media_id: media_id.to_string(),
            filename: format!("{}_{}.failed", username, media_id),
            filepath: "".to_string(),
            file_size: Some(0),
            status: "FAILED".to_string(),
            error_message: Some(error_msg.to_string()),
            downloaded_at: chrono::Utc::now().to_rfc3339(),
        };

        let _ = database::add_download_record(pool, &record).await;
        let _ = database::update_queue_status(pool, media_id, "FAILED").await;
        
        let _ = app_handle.emit_all("download-status", json!({
            "media_id": media_id,
            "status": "FAILED",
            "error": error_msg
        }));
        
        Ok(())
    }
}
