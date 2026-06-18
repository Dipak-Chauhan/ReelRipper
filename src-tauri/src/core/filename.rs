use std::path::{Path, PathBuf};

pub fn sanitize_username(username: &str) -> String {
    if username.is_empty() {
        return "unknown".to_string();
    }
    
    let mut u = username.trim().to_lowercase();
    if u.starts_with('@') {
        u.remove(0);
    }
    u = u.replace(' ', "_");
    
    // Keep only letters, digits, and underscores
    u.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect()
}

pub fn build_filename(
    username: &str,
    taken_at_str: &str,
    media_type: &str,
    media_id: &str,
    ext: &str,
    carousel_index: Option<usize>,
    carousel_total: Option<usize>,
    dup_counter: u32,
) -> String {
    let clean_username = sanitize_username(username);
    
    // Parse date (YYYY-MM-DD)
    let date_str = if taken_at_str.len() >= 10 {
        &taken_at_str[0..10]
    } else {
        "0000-00-00"
    };
    
    let mtype = media_type.to_uppercase();
    let clean_mtype = match mtype.as_str() {
        "REEL" | "POST" | "CAROUSEL" | "IGTV" => mtype,
        _ => "POST".to_string(),
    };
    
    let carousel_suffix = match (carousel_index, carousel_total) {
        (Some(idx), Some(tot)) => format!("_{}of{}", idx, tot),
        _ => "".to_string(),
    };
    
    let dup_suffix = if dup_counter > 0 {
        format!("_dup{}", dup_counter)
    } else {
        "".to_string()
    };
    
    let clean_ext = ext.trim().replace('.', "");
    let final_ext = if clean_ext.is_empty() {
        if clean_mtype == "REEL" || clean_mtype == "IGTV" {
            "mp4".to_string()
        } else {
            "jpg".to_string()
        }
    } else {
        clean_ext
    };
    
    // Enforce 200 characters limit
    // Constant parts length: {username}_{date}_{mtype}_{media_id}{carousel}{dup}.{ext}
    let constant_len = clean_username.len() + 1 +
                       date_str.len() + 1 +
                       clean_mtype.len() + 1 +
                       carousel_suffix.len() +
                       dup_suffix.len() + 1 +
                       final_ext.len();
                       
    let max_media_id_len = if 200 > constant_len {
        200 - constant_len
    } else {
        0
    };
    
    let truncated_media_id = if media_id.len() > max_media_id_len {
        if max_media_id_len > 0 {
            // Take the tail of media_id
            &media_id[media_id.len() - max_media_id_len..]
        } else {
            ""
        }
    } else {
        media_id
    };
    
    format!(
        "{}_{}_{}_{}{}{}.{}",
        clean_username, date_str, clean_mtype, truncated_media_id, carousel_suffix, dup_suffix, final_ext
    )
}

pub fn get_unique_filepath(
    output_dir: &str,
    username: &str,
    taken_at_str: &str,
    media_type: &str,
    media_id: &str,
    ext: &str,
    carousel_index: Option<usize>,
    carousel_total: Option<usize>,
) -> PathBuf {
    let mut dup_counter = 0;
    let base_dir = Path::new(output_dir);
    let _ = std::fs::create_dir_all(base_dir);
    
    loop {
        let filename = build_filename(
            username,
            taken_at_str,
            media_type,
            media_id,
            ext,
            carousel_index,
            carousel_total,
            dup_counter,
        );
        let full_path = base_dir.join(filename);
        if !full_path.exists() {
            return full_path;
        }
        dup_counter += 1;
    }
}
