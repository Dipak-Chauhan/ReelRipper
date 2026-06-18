use std::io::SeekFrom;
use std::path::Path;
use tokio::fs::OpenOptions;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use futures_util::StreamExt;

pub async fn download_file_chunked<F>(
    url: &str,
    dest_path: &Path,
    progress_cb: F,
) -> Result<u64, String>
where
    F: Fn(u64, u64) + Send + Sync + 'static,
{
    let tmp_path = dest_path.with_extension("tmp");
    let mut file_start_byte = 0;
    
    if tmp_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&tmp_path) {
            file_start_byte = metadata.len();
        }
    }
    
    // Create reqwest client with realistic User Agent
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
        
    let mut request = client.get(url);
    if file_start_byte > 0 {
        request = request.header("Range", format!("bytes={}-", file_start_byte));
    }
    
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    
    // Check if direct link expired
    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::GONE {
        return Err("EXPIRED_URL".to_string());
    }
    
    if !status.is_success() {
        return Err(format!("HTTP Status Code: {}", status));
    }
    
    let is_resume = status == reqwest::StatusCode::PARTIAL_CONTENT;
    let actual_start_byte = if is_resume { file_start_byte } else { 0 };
    
    let content_len = response.content_length().unwrap_or(0);
    let total_bytes = content_len + actual_start_byte;
    
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(is_resume)
        .open(&tmp_path)
        .await
        .map_err(|e| e.to_string())?;
        
    if !is_resume {
        let _ = file.set_len(0).await;
    } else {
        let _ = file.seek(SeekFrom::End(0)).await;
    }
    
    let mut stream = response.bytes_stream();
    let mut downloaded = actual_start_byte;
    
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        
        progress_cb(downloaded, total_bytes);
    }
    
    // Flush to disk
    file.sync_all().await.map_err(|e| e.to_string())?;
    drop(file);
    
    // Integrity check
    let file_size = std::fs::metadata(&tmp_path).map_err(|e| e.to_string())?.len();
    if total_bytes > 0 && file_size != total_bytes {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!(
            "Size mismatch. Expected {} bytes, got {} bytes.",
            total_bytes, file_size
        ));
    }
    
    // Atomic rename
    if dest_path.exists() {
        std::fs::remove_file(dest_path).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp_path, dest_path).map_err(|e| e.to_string())?;
    
    Ok(downloaded)
}
