use tauri::Manager;
use std::path::PathBuf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  let mut sidecar = if cfg!(debug_assertions) {
    None
  } else {
    spawn_python_sidecar(app.handle())
  };

  app.run(move |_app_handle, event| {
    if matches!(event, tauri::RunEvent::Exit) {
      if let Some(child) = sidecar.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
      }
    }
  });
}

fn spawn_python_sidecar(app: &tauri::AppHandle) -> Option<std::process::Child> {
  use std::process::{Command, Stdio};

  let resource_dir = match app.path().resource_dir() {
    Ok(dir) => dir,
    Err(error) => {
      eprintln!("[desktop] 无法读取资源目录: {error}");
      return None;
    }
  };

  let sidecar_path = find_sidecar_binary(&resource_dir)
    .or_else(|| find_sidecar_binary(&resource_dir.join("_up_")))
    .or_else(|| find_sidecar_binary(&resource_dir.join("bin")));

  let Some(binary_path) = sidecar_path else {
    eprintln!("[desktop] 未找到 Python 侧车可执行文件，跳过自动启动");
    return None;
  };

  let mut command = Command::new(binary_path);
  command
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .env("PYTHONUNBUFFERED", "1");

  match command.spawn() {
    Ok(child) => Some(child),
    Err(error) => {
      eprintln!("[desktop] 启动 Python 侧车失败: {error}");
      None
    }
  }
}

fn find_sidecar_binary(dir: &std::path::Path) -> Option<PathBuf> {
  const BASE_NAME: &str = "comment-lab-python-sidecar";

  let direct = dir.join(BASE_NAME);
  if direct.is_file() {
    return Some(direct);
  }

  let direct_exe = dir.join(format!("{BASE_NAME}.exe"));
  if direct_exe.is_file() {
    return Some(direct_exe);
  }

  let entries = std::fs::read_dir(dir).ok()?;
  for entry in entries.flatten() {
    let path = entry.path();
    if !path.is_file() {
      continue;
    }
    if let Some(file_name) = path.file_name().and_then(|v| v.to_str()) {
      if file_name.starts_with(BASE_NAME) {
        return Some(path);
      }
    }
  }

  None
}
