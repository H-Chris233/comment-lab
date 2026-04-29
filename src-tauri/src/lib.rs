use std::fs::{self, OpenOptions};
use std::io;
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::time::Duration;
use serde::Serialize;
use tauri::Emitter;
use tauri::Manager;
use std::path::PathBuf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![get_desktop_diagnostics, read_sidecar_log, open_app_log_dir])
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

#[derive(Serialize)]
struct DesktopDiagnostics {
  app_log_dir: String,
  sidecar_log_path: String,
}

#[tauri::command]
fn get_desktop_diagnostics(app: tauri::AppHandle) -> Result<DesktopDiagnostics, String> {
  let app_log_dir = app
    .path()
    .app_log_dir()
    .map_err(|e| format!("无法读取日志目录: {e}"))?;
  let sidecar_log_path = app_log_dir.join("python-sidecar.stderr.log");
  Ok(DesktopDiagnostics {
    app_log_dir: app_log_dir.display().to_string(),
    sidecar_log_path: sidecar_log_path.display().to_string(),
  })
}

#[tauri::command]
fn read_sidecar_log(app: tauri::AppHandle) -> Result<String, String> {
  let log_path = resolve_sidecar_log_path(&app);
  fs::read_to_string(log_path).map_err(|e| format!("读取侧车日志失败: {e}"))
}

#[tauri::command]
fn open_app_log_dir(app: tauri::AppHandle) -> Result<(), String> {
  let dir = app
    .path()
    .app_log_dir()
    .map_err(|e| format!("无法读取日志目录: {e}"))?;
  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg(&dir)
      .spawn()
      .map_err(|e| format!("打开日志目录失败: {e}"))?;
    return Ok(());
  }
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(&dir)
      .spawn()
      .map_err(|e| format!("打开日志目录失败: {e}"))?;
    return Ok(());
  }
  #[cfg(all(unix, not(target_os = "macos")))]
  {
    std::process::Command::new("xdg-open")
      .arg(&dir)
      .spawn()
      .map_err(|e| format!("打开日志目录失败: {e}"))?;
    return Ok(());
  }
  #[allow(unreachable_code)]
  Err("当前平台暂不支持自动打开目录".to_string())
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

  let log_path = resolve_sidecar_log_path(app);
  let stderr_file = open_sidecar_log_file(&log_path).ok();
  if stderr_file.is_none() {
    eprintln!("[desktop] 无法创建侧车日志文件: {}", log_path.display());
  }

  let mut command = Command::new(binary_path);
  if let Some(file) = stderr_file {
    command.stderr(Stdio::from(file));
  } else {
    command.stderr(Stdio::null());
  }
  command
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .env("PYTHONUNBUFFERED", "1");

  match command.spawn() {
    Ok(mut child) => {
      std::thread::sleep(Duration::from_millis(250));
      if let Ok(Some(status)) = child.try_wait() {
        emit_sidecar_error(
          app,
          "Python 侧车启动后立即退出，请检查端口冲突或侧车文件完整性",
          &log_path,
        );
        eprintln!("[desktop] Python 侧车启动后立即退出: {status}");
        return None;
      }

      for _ in 0..60 {
        if is_sidecar_ready() {
          return Some(child);
        }
        std::thread::sleep(Duration::from_millis(500));
      }

      eprintln!(
        "[desktop] Python 侧车在 30 秒内未就绪，日志: {}",
        log_path.display()
      );
      emit_sidecar_error(
        app,
        "Python 侧车启动超时，可能是端口冲突或运行环境异常",
        &log_path,
      );
      let _ = child.kill();
      let _ = child.wait();
      None
    }
    Err(error) => {
      eprintln!("[desktop] 启动 Python 侧车失败: {error}");
      emit_sidecar_error(
        app,
        "启动 Python 侧车失败，请检查日志",
        &log_path,
      );
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

fn resolve_sidecar_log_path(app: &tauri::AppHandle) -> PathBuf {
  if let Ok(log_dir) = app.path().app_log_dir() {
    return log_dir.join("python-sidecar.stderr.log");
  }
  if let Ok(resource_dir) = app.path().resource_dir() {
    return resource_dir.join("python-sidecar.stderr.log");
  }
  PathBuf::from("python-sidecar.stderr.log")
}

fn open_sidecar_log_file(path: &Path) -> io::Result<std::fs::File> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  OpenOptions::new().create(true).append(true).open(path)
}

fn is_sidecar_ready() -> bool {
  let addr: SocketAddr = match "127.0.0.1:8001".parse() {
    Ok(addr) => addr,
    Err(_) => return false,
  };
  TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

#[derive(Serialize, Clone)]
struct SidecarErrorPayload {
  message: String,
  log_path: String,
}

fn emit_sidecar_error(app: &tauri::AppHandle, message: &str, log_path: &Path) {
  let payload = SidecarErrorPayload {
    message: message.to_string(),
    log_path: log_path.display().to_string(),
  };
  let _ = app.emit("sidecar-error", payload);
}
