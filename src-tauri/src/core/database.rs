use serde::{Deserialize, Serialize};
use sqlx::{SqlitePool, Row, FromRow};
use std::fs;
use std::path::PathBuf;
use super::config::get_app_dir;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MediaCacheItem {
    pub media_id: String,
    pub media_type: String,
    pub username: String,
    pub full_name: Option<String>,
    pub taken_at: String,
    pub caption: Option<String>,
    pub thumbnail_url: Option<String>,
    pub video_url: Option<String>,
    pub resources_json: Option<String>,
    pub like_count: Option<i64>,
    pub comment_count: Option<i64>,
    pub scraped_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DownloadRecord {
    pub id: i64,
    pub media_id: String,
    pub filename: String,
    pub filepath: String,
    pub file_size: Option<i64>,
    pub status: String,
    pub error_message: Option<String>,
    pub downloaded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DownloadHistoryItem {
    pub id: i64,
    pub media_id: String,
    pub filename: String,
    pub filepath: String,
    pub file_size: Option<i64>,
    pub status: String,
    pub error_message: Option<String>,
    pub downloaded_at: String,
    pub username: String,
    pub media_type: String,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct QueueItem {
    pub id: i64,
    pub media_id: String,
    pub priority: i64,
    pub status: String,
    pub retry_count: i64,
    pub added_at: String,
    
    pub username: String,
    pub media_type: String,
    pub taken_at: String,
    pub thumbnail_url: Option<String>,
    pub video_url: Option<String>,
    pub resources_json: Option<String>,
    pub filepath: Option<String>,
}

pub async fn get_db_pool() -> Result<SqlitePool, sqlx::Error> {
    let app_dir = get_app_dir();
    let _ = fs::create_dir_all(&app_dir);
    let db_path = app_dir.join("reelripper.db");
    
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .pragma("foreign_keys", "ON")
        .pragma("journal_mode", "WAL");
        
    let pool = SqlitePool::connect_with(options).await?;
    init_db(&pool).await?;
    Ok(pool)
}

async fn init_db(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // 1. Media Cache Table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS media_cache (
            media_id TEXT PRIMARY KEY,
            media_type TEXT NOT NULL,
            username TEXT NOT NULL,
            full_name TEXT,
            taken_at TEXT NOT NULL,
            caption TEXT,
            thumbnail_url TEXT,
            video_url TEXT,
            resources_json TEXT,
            like_count INTEGER,
            comment_count INTEGER,
            scraped_at TEXT NOT NULL
        );"
    ).execute(pool).await?;

    // 2. Download History Table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            file_size INTEGER,
            status TEXT NOT NULL,
            error_message TEXT,
            downloaded_at TEXT NOT NULL,
            FOREIGN KEY (media_id) REFERENCES media_cache(media_id) ON DELETE CASCADE
        );"
    ).execute(pool).await?;

    // 3. Queue Table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id TEXT NOT NULL UNIQUE,
            priority INTEGER DEFAULT 0,
            status TEXT DEFAULT 'PENDING',
            retry_count INTEGER DEFAULT 0,
            added_at TEXT NOT NULL,
            FOREIGN KEY (media_id) REFERENCES media_cache(media_id) ON DELETE CASCADE
        );"
    ).execute(pool).await?;

    // 4. Settings Table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );"
    ).execute(pool).await?;

    Ok(())
}

// --- Media Cache CRUD ---

pub async fn cache_media_items(pool: &SqlitePool, items: Vec<MediaCacheItem>) -> Result<(), sqlx::Error> {
    for item in items {
        sqlx::query(
            "INSERT OR REPLACE INTO media_cache (
                media_id, media_type, username, full_name, taken_at,
                caption, thumbnail_url, video_url, resources_json,
                like_count, comment_count, scraped_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);"
        )
        .bind(&item.media_id)
        .bind(&item.media_type)
        .bind(&item.username)
        .bind(&item.full_name)
        .bind(&item.taken_at)
        .bind(&item.caption)
        .bind(&item.thumbnail_url)
        .bind(&item.video_url)
        .bind(&item.resources_json)
        .bind(item.like_count)
        .bind(item.comment_count)
        .bind(&item.scraped_at)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn get_cached_media(pool: &SqlitePool, media_id: &str) -> Result<Option<MediaCacheItem>, sqlx::Error> {
    let item = sqlx::query_as::<_, MediaCacheItem>("SELECT * FROM media_cache WHERE media_id = ?;")
        .bind(media_id)
        .fetch_optional(pool)
        .await?;
    Ok(item)
}

pub async fn get_all_cached_media(pool: &SqlitePool) -> Result<Vec<MediaCacheItem>, sqlx::Error> {
    let items = sqlx::query_as::<_, MediaCacheItem>("SELECT * FROM media_cache ORDER BY datetime(taken_at) DESC;")
        .fetch_all(pool)
        .await?;
    Ok(items)
}

// --- Downloads history CRUD ---

pub async fn add_download_record(pool: &SqlitePool, record: &DownloadRecord) -> Result<i64, sqlx::Error> {
    let res = sqlx::query(
        "INSERT INTO downloads (
            media_id, filename, filepath, file_size, status, error_message, downloaded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?);"
    )
    .bind(&record.media_id)
    .bind(&record.filename)
    .bind(&record.filepath)
    .bind(record.file_size)
    .bind(&record.status)
    .bind(&record.error_message)
    .bind(&record.downloaded_at)
    .execute(pool)
    .await?;
    
    Ok(res.last_insert_rowid())
}

pub async fn get_downloads_history(pool: &SqlitePool) -> Result<Vec<DownloadHistoryItem>, sqlx::Error> {
    let items = sqlx::query_as::<_, DownloadHistoryItem>(
        "SELECT d.*, m.username, m.media_type, m.thumbnail_url 
         FROM downloads d
         JOIN media_cache m ON d.media_id = m.media_id
         ORDER BY datetime(d.downloaded_at) DESC;"
    )
    .fetch_all(pool)
    .await?;
    Ok(items)
}

pub async fn clear_download_history(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM downloads;").execute(pool).await?;
    Ok(())
}

pub async fn delete_download_record(pool: &SqlitePool, record_id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM downloads WHERE id = ?;")
        .bind(record_id)
        .execute(pool)
        .await?;
    Ok(())
}

// --- Queue CRUD ---

pub async fn add_to_queue(pool: &SqlitePool, media_id: &str, priority: i64) -> Result<bool, sqlx::Error> {
    let now = chrono::Utc::now().to_rfc3339();
    
    // Check if already in queue
    let existing = sqlx::query("SELECT 1 FROM queue WHERE media_id = ?;")
        .bind(media_id)
        .fetch_optional(pool)
        .await?;
        
    if existing.is_some() {
        sqlx::query("UPDATE queue SET priority = ? WHERE media_id = ?;")
            .bind(priority)
            .bind(media_id)
            .execute(pool)
            .await?;
        return Ok(false);
    }
    
    sqlx::query(
        "INSERT INTO queue (media_id, priority, status, retry_count, added_at)
         VALUES (?, ?, 'PENDING', 0, ?);"
    )
    .bind(media_id)
    .bind(priority)
    .bind(&now)
    .execute(pool)
    .await?;
    
    Ok(true)
}

pub async fn get_queue_items(pool: &SqlitePool) -> Result<Vec<QueueItem>, sqlx::Error> {
    let items = sqlx::query_as::<_, QueueItem>(
        "SELECT q.*, m.username, m.media_type, m.taken_at, m.thumbnail_url, m.video_url, m.resources_json, d.filepath
         FROM queue q
         JOIN media_cache m ON q.media_id = m.media_id
         LEFT JOIN downloads d ON q.media_id = d.media_id
         ORDER BY q.priority DESC, datetime(q.added_at) ASC;"
    )
    .fetch_all(pool)
    .await?;
    Ok(items)
}

pub async fn update_queue_status(pool: &SqlitePool, media_id: &str, status: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE queue SET status = ? WHERE media_id = ?;")
        .bind(status)
        .bind(media_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_queue_retry_count(pool: &SqlitePool, media_id: &str, retry_count: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE queue SET retry_count = ? WHERE media_id = ?;")
        .bind(retry_count)
        .bind(media_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_queue_priority(pool: &SqlitePool, media_id: &str, priority: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE queue SET priority = ? WHERE media_id = ?;")
        .bind(priority)
        .bind(media_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove_from_queue(pool: &SqlitePool, media_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM queue WHERE media_id = ?;")
        .bind(media_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn clear_completed_queue(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM queue WHERE status IN ('COMPLETED', 'FAILED', 'SKIPPED');")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn clear_entire_queue(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM queue;").execute(pool).await?;
    Ok(())
}

// --- Settings CRUD ---

pub async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_setting(pool: &SqlitePool, key: &str, default: Option<&str>) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?;")
        .bind(key)
        .fetch_optional(pool)
        .await?;
        
    match row {
        Some(r) => {
            let val: String = r.get("value");
            Ok(Some(val))
        }
        None => Ok(default.map(|d| d.to_string())),
    }
}
