use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use std::process::Stdio;

pub struct ScraperController {
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: Arc<Mutex<u64>>,
    process: Arc<Mutex<Option<Child>>>,
}

impl ScraperController {
    pub fn new() -> Self {
        Self {
            stdin: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(0)),
            process: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        let mut base_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        if base_dir.ends_with("src-tauri") {
            base_dir = base_dir.parent().unwrap().to_path_buf();
        }
        
        let python_path = base_dir.join("python-scraper").join("venv").join("Scripts").join("python.exe");
        let script_path = base_dir.join("python-scraper").join("scraper_ipc.py");
        
        let mut cmd = if python_path.exists() {
            let mut c = Command::new(&python_path);
            c.arg(&script_path);
            c
        } else {
            // Fallback to global python
            let mut c = Command::new("python");
            c.arg(base_dir.join("python-scraper").join("scraper_ipc.py"));
            c
        };
        
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn Python sidecar: {}", e))?;
            
        let stdin = child.stdin.take().ok_or("Failed to open sidecar stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open sidecar stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open sidecar stderr")?;
        
        *self.stdin.lock().await = Some(stdin);
        *self.process.lock().await = Some(child);
        
        let pending_clone = self.pending.clone();
        let app_handle_clone = app_handle.clone();
        
        // Task to process stdout
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Ok(msg) = serde_json::from_str::<Value>(&line) {
                    let msg_type = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    
                    if msg_type == "response" {
                        if let Some(id) = msg.get("id").and_then(|i| i.as_u64()) {
                            let mut pending = pending_clone.lock().await;
                            if let Some(sender) = pending.remove(&id) {
                                let result = msg.get("result").cloned().unwrap_or(Value::Null);
                                let _ = sender.send(result);
                            }
                        }
                    } else if msg_type == "event" {
                        // Forward 2FA / checkpoint challenges as tauri events to frontend
                        let event_name = msg.get("event").and_then(|e| e.as_str()).unwrap_or("");
                        let username = msg.get("username").and_then(|u| u.as_str()).unwrap_or("");
                        
                        if event_name == "2fa_required" {
                            let _ = app_handle_clone.emit_all("verification-required", json!({
                                "type": "2FA",
                                "username": username
                            }));
                        } else if event_name == "challenge_required" {
                            let choice = msg.get("choice").and_then(|c| c.as_str()).unwrap_or("");
                            let _ = app_handle_clone.emit_all("verification-required", json!({
                                "type": "CHALLENGE",
                                "username": username,
                                "choice": choice
                            }));
                        }
                    }
                }
            }
        });
        
        // Task to process stderr
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                eprintln!("[Python Sidecar Stderr] {}", line);
            }
        });
        
        Ok(())
    }

    pub async fn send_command(&self, method: &str, params: Value) -> Result<Value, String> {
        let mut id_guard = self.next_id.lock().await;
        let msg_id = *id_guard;
        *id_guard += 1;
        drop(id_guard);
        
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(msg_id, tx);
        
        let payload = json!({
            "id": msg_id,
            "method": method,
            "params": params
        });
        
        let payload_str = payload.to_string() + "\n";
        
        let mut stdin_guard = self.stdin.lock().await;
        if let Some(ref mut stdin) = *stdin_guard {
            stdin
                .write_all(payload_str.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to sidecar: {}", e))?;
            stdin.flush().await.map_err(|e| format!("Failed to flush sidecar stdin: {}", e))?;
        } else {
            return Err("Python sidecar is not running".to_string());
        }
        drop(stdin_guard);
        
        let result = rx.await.map_err(|_| "Sidecar channel closed before response".to_string())?;
        
        if let Some(status) = result.get("status").and_then(|s| s.as_str()) {
            if status == "error" {
                let err_msg = result.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown error");
                return Err(err_msg.to_string());
            }
        }
        
        Ok(result)
    }

    pub async fn submit_otp(&self, code: &str) -> Result<(), String> {
        let payload = json!({
            "method": "submit_otp",
            "params": {
                "code": code
            }
        });
        let payload_str = payload.to_string() + "\n";
        
        let mut stdin_guard = self.stdin.lock().await;
        if let Some(ref mut stdin) = *stdin_guard {
            stdin
                .write_all(payload_str.as_bytes())
                .await
                .map_err(|e| format!("Failed to submit OTP: {}", e))?;
            stdin.flush().await.map_err(|e| format!("Failed to flush OTP submission: {}", e))?;
            Ok(())
        } else {
            Err("Python sidecar is not running".to_string())
        }
    }

    pub async fn stop(&self) {
        let mut process_guard = self.process.lock().await;
        if let Some(mut child) = process_guard.take() {
            let _ = child.kill().await;
        }
        let mut stdin_guard = self.stdin.lock().await;
        *stdin_guard = None;
    }
}
