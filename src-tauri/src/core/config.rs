use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub download_dir: String,
    pub download_quality: String,
    pub concurrency_limit: usize,
    pub include_date: bool,
    pub include_media_type: bool,
    pub include_media_id: bool,
    pub theme: String,
    pub accent_color: String,
    pub window_width: u32,
    pub window_height: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| "C:\\".to_string());
        
        let default_download = Path::new(&home)
            .join("Downloads")
            .join("ReelRipper")
            .to_string_lossy()
            .into_owned();

        Self {
            download_dir: default_download,
            download_quality: "best".to_string(),
            concurrency_limit: 3,
            include_date: true,
            include_media_type: true,
            include_media_id: true,
            theme: "dark".to_string(),
            accent_color: "#7C4DFF".to_string(),
            window_width: 1000,
            window_height: 700,
        }
    }
}

impl AppConfig {
    pub fn validate(&mut self) {
        if self.concurrency_limit < 1 {
            self.concurrency_limit = 1;
        } else if self.concurrency_limit > 10 {
            self.concurrency_limit = 10;
        }

        let valid_qualities = vec!["best", "1080p", "720p", "audio"];
        if !valid_qualities.contains(&self.download_quality.as_str()) {
            self.download_quality = "best".to_string();
        }

        let valid_themes = vec!["system", "light", "dark"];
        if !valid_themes.contains(&self.theme.as_str()) {
            self.theme = "dark".to_string();
        }
    }
}

pub fn get_app_dir() -> PathBuf {
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| "C:\\".to_string());
        format!("{}\\AppData\\Local", home)
    });
    PathBuf::from(local_appdata).join("ReelRipperTeam").join("ReelRipper")
}

pub struct ConfigManager {
    config_path: PathBuf,
    current_config: AppConfig,
}

impl ConfigManager {
    pub fn new() -> Self {
        let app_dir = get_app_dir();
        let config_path = app_dir.join("config.json");
        let mut manager = Self {
            config_path,
            current_config: AppConfig::default(),
        };
        manager.load();
        manager
    }

    pub fn load(&mut self) -> AppConfig {
        let _ = fs::create_dir_all(&get_app_dir());
        if self.config_path.exists() {
            if let Ok(content) = fs::read_to_string(&self.config_path) {
                if let Ok(mut config) = serde_json::from_str::<AppConfig>(&content) {
                    config.validate();
                    self.current_config = config;
                    return self.current_config.clone();
                }
            }
        }
        // Save default configuration if it didn't exist or failed to load
        self.save();
        self.current_config.clone()
    }

    pub fn save(&self) -> bool {
        let _ = fs::create_dir_all(&get_app_dir());
        if let Ok(content) = serde_json::to_string_pretty(&self.current_config) {
            if fs::write(&self.config_path, content).is_ok() {
                return true;
            }
        }
        false
    }

    pub fn get_config(&self) -> AppConfig {
        self.current_config.clone()
    }

    pub fn update_config(&mut self, new_config: AppConfig) -> bool {
        self.current_config = new_config;
        self.current_config.validate();
        self.save()
    }
}
