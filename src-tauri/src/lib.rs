use std::fs::{self, OpenOptions};
use std::io;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};
use serde::Serialize;
use tauri::Emitter;
use tauri::Manager;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const SIDECAR_STARTUP_MAX_ATTEMPTS: usize = 3;
const SIDECAR_STARTUP_READY_TIMEOUT_SECS: u64 = 20;

static SIDECAR_BASE_URL: OnceLock<Mutex<String>> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![get_desktop_diagnostics, read_sidecar_log, open_app_log_dir])
    .setup(|app| {
      configure_runtime_paths(app.handle());
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
        graceful_stop_sidecar(child);
      }
    }
  });
}

#[derive(Serialize)]
struct DesktopDiagnostics {
  app_log_dir: String,
  sidecar_log_path: String,
  sidecar_base_url: String,
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
    sidecar_base_url: current_sidecar_base_url(),
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
    let msg = "未找到 Python 侧车可执行文件，请重新安装桌面应用或检查构建产物";
    eprintln!("[desktop] {msg}");
    let log_path = resolve_sidecar_log_path(app);
    emit_sidecar_error(app, msg, &log_path);
    return None;
  };

  let log_path = resolve_sidecar_log_path(app);
  if open_sidecar_log_file(&log_path).is_err() {
    eprintln!("[desktop] 无法创建侧车日志文件: {}", log_path.display());
  }

  emit_sidecar_status(app, "starting", "正在准备本地推理引擎", 0, SIDECAR_STARTUP_MAX_ATTEMPTS, None);
  for attempt in 1..=SIDECAR_STARTUP_MAX_ATTEMPTS {
    let port = match pick_available_local_port() {
      Some(port) => port,
      None => {
        emit_sidecar_error(app, "无法分配可用端口，请重启应用后重试", &log_path);
        return None;
      }
    };
    let base_url = format!("http://127.0.0.1:{port}");
    set_sidecar_base_url(base_url.clone());
    unsafe {
      std::env::set_var("PYTHON_DASHSCOPE_SERVICE_URL", &base_url);
    }
    emit_sidecar_status(
      app,
      "starting",
      &format!("正在启动本地引擎（第 {attempt}/{SIDECAR_STARTUP_MAX_ATTEMPTS} 次）"),
      attempt,
      SIDECAR_STARTUP_MAX_ATTEMPTS,
      Some(&base_url),
    );
    let stderr_file = open_sidecar_log_file(&log_path).ok();
    let mut command = Command::new(&binary_path);
    if let Some(file) = stderr_file {
      command.stderr(Stdio::from(file));
    } else {
      command.stderr(Stdio::null());
    }
    command
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .env("PYTHONUNBUFFERED", "1")
      .env("COMMENT_LAB_SIDECAR_PORT", port.to_string());

    match command.spawn() {
      Ok(mut child) => {
        std::thread::sleep(Duration::from_millis(250));
        if let Ok(Some(status)) = child.try_wait() {
          eprintln!("[desktop] Python 侧车启动后立即退出: {status}");
          if attempt < SIDECAR_STARTUP_MAX_ATTEMPTS {
            emit_sidecar_status(
              app,
              "retrying",
              "侧车启动失败，正在重试",
              attempt,
              SIDECAR_STARTUP_MAX_ATTEMPTS,
              Some(&base_url),
            );
            continue;
          }
          emit_sidecar_error(
            app,
            "Python 侧车启动后立即退出，请检查侧车文件完整性",
            &log_path,
          );
          return None;
        }

        let deadline = Instant::now() + Duration::from_secs(SIDECAR_STARTUP_READY_TIMEOUT_SECS);
        while Instant::now() < deadline {
          if is_sidecar_ready(port) {
            emit_sidecar_status(app, "ready", "本地引擎已就绪", attempt, SIDECAR_STARTUP_MAX_ATTEMPTS, Some(&base_url));
            return Some(child);
          }
          std::thread::sleep(Duration::from_millis(300));
        }

        eprintln!("[desktop] Python 侧车超时未就绪，attempt={attempt}, port={port}");
        let _ = child.kill();
        let _ = child.wait();
        if attempt < SIDECAR_STARTUP_MAX_ATTEMPTS {
          emit_sidecar_status(app, "retrying", "本地引擎启动超时，正在重试", attempt, SIDECAR_STARTUP_MAX_ATTEMPTS, Some(&base_url));
          std::thread::sleep(Duration::from_millis(600));
          continue;
        }
        emit_sidecar_error(
          app,
          "Python 侧车启动超时，请在设置中查看日志并重试",
          &log_path,
        );
        return None;
      }
      Err(error) => {
        eprintln!("[desktop] 启动 Python 侧车失败: {error}");
        if attempt < SIDECAR_STARTUP_MAX_ATTEMPTS {
          emit_sidecar_status(app, "retrying", "侧车进程拉起失败，正在重试", attempt, SIDECAR_STARTUP_MAX_ATTEMPTS, Some(&base_url));
          std::thread::sleep(Duration::from_millis(600));
          continue;
        }
        emit_sidecar_error(
          app,
          "启动 Python 侧车失败，请检查日志",
          &log_path,
        );
        return None;
      }
    }
  }
  None
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

fn is_sidecar_ready(port: u16) -> bool {
  let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
    Ok(addr) => addr,
    Err(_) => return false,
  };
  TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

fn pick_available_local_port() -> Option<u16> {
  let listener = TcpListener::bind("127.0.0.1:0").ok()?;
  let port = listener.local_addr().ok()?.port();
  Some(port)
}

fn sidecar_base_url_cell() -> &'static Mutex<String> {
  SIDECAR_BASE_URL.get_or_init(|| Mutex::new("http://127.0.0.1:8001".to_string()))
}

fn set_sidecar_base_url(value: String) {
  match sidecar_base_url_cell().lock() {
    Ok(mut current) => {
      *current = value;
    }
    Err(poisoned) => {
      eprintln!("[desktop] sidecar base url lock poisoned while setting; recovering");
      *poisoned.into_inner() = value;
    }
  }
}

fn current_sidecar_base_url() -> String {
  match sidecar_base_url_cell().lock() {
    Ok(current) => current.clone(),
    Err(poisoned) => {
      eprintln!("[desktop] sidecar base url lock poisoned while reading; recovering");
      poisoned.into_inner().clone()
    }
  }
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

#[derive(Serialize, Clone)]
struct SidecarStatusPayload {
  phase: String,
  message: String,
  attempt: usize,
  max_attempts: usize,
  base_url: Option<String>,
}

fn emit_sidecar_status(
  app: &tauri::AppHandle,
  phase: &str,
  message: &str,
  attempt: usize,
  max_attempts: usize,
  base_url: Option<&str>,
) {
  let payload = SidecarStatusPayload {
    phase: phase.to_string(),
    message: message.to_string(),
    attempt,
    max_attempts,
    base_url: base_url.map(|v| v.to_string()),
  };
  let _ = app.emit("sidecar-status", payload);
}


fn graceful_stop_sidecar(child: &mut std::process::Child) {
  if child.try_wait().ok().flatten().is_some() {
    return;
  }

  #[cfg(target_family = "unix")]
  {
    let _ = std::process::Command::new("kill")
      .arg("-TERM")
      .arg(child.id().to_string())
      .status();
  }

  #[cfg(target_os = "windows")]
  {
    let _ = std::process::Command::new("taskkill")
      .args(["/PID", &child.id().to_string()])
      .status();
  }

  let deadline = Instant::now() + Duration::from_secs(3);
  while Instant::now() < deadline {
    if child.try_wait().ok().flatten().is_some() {
      return;
    }
    std::thread::sleep(Duration::from_millis(100));
  }

  let _ = child.kill();
  let _ = child.wait();
}

fn configure_runtime_paths(app: &tauri::AppHandle) {
  let app_home = app.path().app_data_dir().ok();
  let config_dir = app.path().app_config_dir().ok();
  let log_dir = app.path().app_log_dir().ok();

  unsafe {
    if let Some(path) = app_home.as_ref() {
      std::env::set_var("COMMENT_LAB_APP_HOME", path.as_os_str());
      std::env::set_var("COMMENT_LAB_APP_DATA_DIR", path.as_os_str());
      std::env::set_var("TEMP_VIDEO_DIR", path.join("temp-video").as_os_str());
    }
    if let Some(path) = config_dir.as_ref() {
      std::env::set_var("COMMENT_LAB_CONFIG_DIR", path.as_os_str());
    }
    if let Some(path) = log_dir.as_ref() {
      std::env::set_var("COMMENT_LAB_LOG_DIR", path.as_os_str());
    }
  }
}
