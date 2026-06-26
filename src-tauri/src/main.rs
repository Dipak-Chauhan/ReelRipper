// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core {
    pub mod config;
    pub mod database;
    pub mod downloader;
    pub mod filename;
    pub mod queue;
    pub mod auth;
}

mod sidecar {
    pub mod scraper;
}

mod commands;

use std::sync::Arc;
use tokio::sync::Mutex;
use commands::AppState;
use tauri::Manager;

fn main() {
    let pool = tauri::async_runtime::block_on(async {
        core::database::get_db_pool().await.expect("Failed to initialize database")
    });
    
    let scraper = Arc::new(sidecar::scraper::ScraperController::new());
    let config = Arc::new(Mutex::new(core::config::ConfigManager::new()));
    let queue = Arc::new(core::queue::QueueManager::new(pool.clone(), scraper.clone()));
    
    let state = AppState {
        pool,
        scraper,
        config,
        queue,
    };
    
    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            let handle = app.handle();
            let app_state = handle.state::<AppState>();
            
            let scraper_clone = app_state.scraper.clone();
            let queue_clone = app_state.queue.clone();
            let handle_clone = handle.clone();
            
            tauri::async_runtime::spawn(async move {
                if let Err(e) = scraper_clone.start(handle_clone.clone()).await {
                    eprintln!("Failed to start sidecar: {}", e);
                }
                queue_clone.start(handle_clone).await;
            });
            
            Ok(())
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::Destroyed = event.event() {
                let handle = event.window().app_handle();
                let app_state = handle.state::<AppState>();
                let scraper = app_state.scraper.clone();
                let queue = app_state.queue.clone();
                
                tauri::async_runtime::spawn(async move {
                    scraper.stop().await;
                    queue.stop();
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::auto_login,
            commands::logout,
            commands::submit_otp,
            commands::trigger_sync,
            commands::get_library_items,
            commands::add_to_queue,
            commands::add_all_to_queue,
            commands::get_queue_items,
            commands::pause_queue,
            commands::resume_queue,
            commands::remove_from_queue,
            commands::clear_completed_queue,
            commands::clear_entire_queue,
            commands::get_downloads_history,
            commands::clear_download_history,
            commands::delete_download_record,
            commands::get_config,
            commands::save_settings,
            commands::select_directory,
            commands::get_remembered_username
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
