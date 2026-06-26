use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn find_in_path(name: &str) -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("PATH") {
        for path in std::env::split_paths(&path_var) {
            let exe_path = path.join(name);
            if exe_path.exists() {
                return Some(exe_path);
            }
            let exe_path_with_ext = path.join(format!("{}.exe", name));
            if exe_path_with_ext.exists() {
                return Some(exe_path_with_ext);
            }
        }
    }
    None
}

fn main() {
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR not set");
    let wrapper_dir = Path::new(&out_dir).join("bin_wrappers");
    fs::create_dir_all(&wrapper_dir).expect("Failed to create wrappers dir");
    
    // 1. Write the wrapper Rust source code
    let wrapper_rs_path = Path::new(&out_dir).join("wrapper.rs");
    let wrapper_rs_content = r#"use std::process::Command;
use std::env;
use std::fs;

fn main() {
    let args: Vec<String> = env::args().collect();
    let wrapper_path = env::current_exe().unwrap();
    let wrapper_name = wrapper_path.file_name().unwrap().to_str().unwrap();
    
    let real_exe = find_real_exe(wrapper_name, &wrapper_path).expect("Real executable not found");
    
    let mut clean_args: Vec<String> = args[1..].iter().cloned().collect();
    let mut temp_rc_file: Option<std::path::PathBuf> = None;
    
    for i in 0..clean_args.len() {
        if clean_args[i] == "--input" || clean_args[i] == "-i" {
            if i + 1 < clean_args.len() {
                let rc_path = std::path::Path::new(&clean_args[i + 1]);
                if rc_path.exists() {
                    if let Ok(content) = fs::read_to_string(rc_path) {
                        let cleaned_content = content.replace("\\\\\\\\?\\\\", "").replace("\\\\\\\\?\\", "").replace("\\\\?\\", "");
                        let temp_dir = env::temp_dir();
                        let temp_rc = temp_dir.join("cleaned_resource.rc");
                        fs::write(&temp_rc, cleaned_content).unwrap();
                        
                        clean_args[i + 1] = temp_rc.to_string_lossy().into_owned();
                        temp_rc_file = Some(temp_rc);
                    }
                }
            }
        } else if clean_args[i].to_lowercase().ends_with(".rc") {
            let rc_path = std::path::Path::new(&clean_args[i]);
            if rc_path.exists() {
                if let Ok(content) = fs::read_to_string(rc_path) {
                    let cleaned_content = content.replace("\\\\\\\\?\\\\", "").replace("\\\\\\\\?\\", "").replace("\\\\?\\", "");
                    let temp_dir = env::temp_dir();
                    let temp_rc = temp_dir.join("cleaned_resource.rc");
                    fs::write(&temp_rc, cleaned_content).unwrap();
                    
                    clean_args[i] = temp_rc.to_string_lossy().into_owned();
                    temp_rc_file = Some(temp_rc);
                }
            }
        }
    }
    
    let log_content = format!(
        "args: {:?}\nclean_args: {:?}\nreal_exe: {}\ntemp_rc: {:?}\n",
        args, clean_args, real_exe.to_string_lossy(), temp_rc_file
    );
    let _ = fs::write("wrapper_run.txt", log_content);
    
    let status = Command::new(real_exe)
        .args(&clean_args)
        .status()
        .expect("Failed to execute compiler");
        
    if let Some(ref temp_path) = temp_rc_file {
        let _ = fs::remove_file(temp_path);
    }
    
    std::process::exit(status.code().unwrap_or(1));
}

fn find_real_exe(name: &str, wrapper_path: &std::path::Path) -> Option<std::path::PathBuf> {
    if let Ok(path_var) = env::var("PATH") {
        for path in env::split_paths(&path_var) {
            if path == wrapper_path.parent().unwrap() {
                continue;
            }
            let exe_path = path.join(name);
            if exe_path.exists() {
                return Some(exe_path);
            }
        }
    }
    None
}
"#;
    fs::write(&wrapper_rs_path, wrapper_rs_content)
        .expect("Failed to write wrapper.rs");
        
    // 2. Compile the wrapper Rust file into wrapper.exe using rustc with bundled linker
    let wrapper_exe_path = Path::new(&out_dir).join("wrapper.exe");
    let rustc_status = Command::new("rustc")
        .arg(&wrapper_rs_path)
        .arg("-o")
        .arg(&wrapper_exe_path)
        .arg("-C")
        .arg("linker=rust-lld")
        .status();
        
    let mut created_wrapper = false;
    
    if let Ok(status) = rustc_status {
        if status.success() {
            // 3. Create wrappers for each possible resource compiler in PATH by copying wrapper.exe
            let compilers = ["llvm-rc", "windres", "x86_64-w64-mingw32-windres"];
            for compiler in compilers {
                if find_in_path(compiler).is_some() {
                    let dest_exe = wrapper_dir.join(format!("{}.exe", compiler));
                    if fs::copy(&wrapper_exe_path, &dest_exe).is_ok() {
                        created_wrapper = true;
                    }
                }
            }
        }
    }
    
    // 4. Prepend our wrapper directory to PATH if we created any wrapper
    let mut debug_log = String::new();
    debug_log.push_str(&format!("out_dir: {}\n", out_dir));
    debug_log.push_str(&format!("rustc_status: {:?}\n", rustc_status));
    debug_log.push_str(&format!("created_wrapper: {}\n", created_wrapper));
    
    let compilers = ["llvm-rc", "windres", "x86_64-w64-mingw32-windres"];
    for compiler in compilers {
        debug_log.push_str(&format!("{}: {:?}\n", compiler, find_in_path(compiler)));
        let dest_exe = wrapper_dir.join(format!("{}.exe", compiler));
        debug_log.push_str(&format!("wrapper exists for {}: {}\n", compiler, dest_exe.exists()));
    }
    
    if created_wrapper {
        if let Ok(original_path) = std::env::var("PATH") {
            let mut paths = std::env::split_paths(&original_path).collect::<Vec<_>>();
            paths.insert(0, wrapper_dir);
            let new_path = std::env::join_paths(paths).unwrap();
            std::env::set_var("PATH", &new_path);
            debug_log.push_str(&format!("New PATH: {}\n", new_path.to_string_lossy()));
        }
    } else {
        if let Ok(p) = std::env::var("PATH") {
            debug_log.push_str(&format!("Original PATH: {}\n", p));
        }
    }
    
    let _ = fs::write("debug_build_wrapper.txt", debug_log);

    // 5. Run tauri-build
    tauri_build::build();
}



