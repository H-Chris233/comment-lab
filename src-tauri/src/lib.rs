use serde::Serialize;
use serde::Deserialize;
use std::fs::{self, OpenOptions};
use std::io;
use std::io::Write;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;
use tauri::Url;

const SIDECAR_STARTUP_MAX_ATTEMPTS: usize = 3;
const SIDECAR_STARTUP_READY_TIMEOUT_SECS: u64 = 20;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static SIDECAR_BASE_URL: OnceLock<Mutex<String>> = OnceLock::new();
static ENV_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Serialize, Deserialize, Clone)]
struct SidecarRegistry {
    node_port: u16,
    python_base_url: String,
    node_pid: u32,
    python_pid: u32,
    active_instances: u32,
}

struct RegistryLock {
    path: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_desktop_diagnostics,
            read_sidecar_log,
            open_app_log_dir
        ])
        .setup(|app| {
            configure_runtime_paths(app.handle());
            configure_sidecar_binary_envs(app.handle());
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

    let node_port_for_window = std::sync::Arc::new(std::sync::Mutex::new(None::<u16>));
    let node_port_for_window_setup = node_port_for_window.clone();

    let mut release_on_exit = false;
    if !cfg!(debug_assertions) {
        let Some(_lock) = acquire_registry_lock(app.handle()) else {
            eprintln!("[desktop] sidecar registry lock unavailable, skip shared-sidecar lifecycle");
            if let Some((node_child, node_port)) = spawn_standalone_sidecars(app.handle()) {
                if let Ok(mut slot) = node_port_for_window_setup.lock() {
                    *slot = Some(node_port);
                }
                let _local_node_sidecar = node_child;
            }
            app.run(move |app_handle, event| match event {
                tauri::RunEvent::Ready => {
                    if let Ok(slot) = node_port_for_window.lock() {
                        if let Some(port) = *slot {
                            update_main_window_url(app_handle, port);
                        }
                    }
                }
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::CloseRequested { .. },
                    ..
                } if label == "main" => {
                    app_handle.exit(0);
                }
                _ => {}
            });
            return;
        };
        if let Some(existing) = load_reusable_sidecar_registry(app.handle()) {
          set_sidecar_base_url(existing.python_base_url.clone());
          set_process_env_var("PYTHON_DASHSCOPE_SERVICE_URL", &existing.python_base_url);
          if let Ok(mut slot) = node_port_for_window_setup.lock() {
              *slot = Some(existing.node_port);
          }
          release_on_exit = register_sidecar_instance(app.handle());
        } else {
          match spawn_standalone_sidecars(app.handle()) {
              Some((node_child, node_port)) => {
                  if let Ok(mut slot) = node_port_for_window_setup.lock() {
                      *slot = Some(node_port);
                  }
                  release_on_exit = persist_sidecar_registry(
                      app.handle(),
                      node_port,
                      &current_sidecar_base_url(),
                      node_child.id(),
                      read_python_pid_from_lock(app.handle()).unwrap_or_default(),
                  );
                  let _owned_node_sidecar = node_child;
              }
              None => {}
          }
        }
    }

    app.run(move |app_handle, event| match event {
        tauri::RunEvent::Ready => {
            if let Ok(slot) = node_port_for_window.lock() {
                if let Some(port) = *slot {
                    update_main_window_url(app_handle, port);
                }
            }
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { .. },
            ..
        } if label == "main" => {
            app_handle.exit(0);
        }
        tauri::RunEvent::Exit => {
            if release_on_exit {
                release_sidecar_instance(app_handle);
            }
        }
        _ => {}
    });
}

fn load_reusable_sidecar_registry(app: &tauri::AppHandle) -> Option<SidecarRegistry> {
    let path = resolve_sidecar_registry_path(app);
    let content = fs::read_to_string(path).ok()?;
    let registry: SidecarRegistry = serde_json::from_str(&content).ok()?;
    let python_port = parse_local_port_from_base_url(&registry.python_base_url)?;
    if !is_sidecar_ready(registry.node_port) || !is_sidecar_ready(python_port) {
        return None;
    }
    Some(registry)
}

fn register_sidecar_instance(app: &tauri::AppHandle) -> bool {
    let path = resolve_sidecar_registry_path(app);
    let Ok(content) = fs::read_to_string(&path) else {
        return false;
    };
    let Ok(mut registry) = serde_json::from_str::<SidecarRegistry>(&content) else {
        return false;
    };
    registry.active_instances = registry.active_instances.saturating_add(1);
    if let Ok(json) = serde_json::to_string(&registry) {
        return fs::write(path, json).is_ok();
    }
    false
}

fn release_sidecar_instance(app: &tauri::AppHandle) {
    let _lock = acquire_registry_lock(app);
    let path = resolve_sidecar_registry_path(app);
    let Ok(content) = fs::read_to_string(&path) else {
        return;
    };
    let Ok(mut registry) = serde_json::from_str::<SidecarRegistry>(&content) else {
        return;
    };

    registry.active_instances = registry.active_instances.saturating_sub(1);
    if registry.active_instances > 0 {
        if let Ok(json) = serde_json::to_string(&registry) {
            let _ = fs::write(path, json);
        }
        return;
    }

    stop_sidecar_pid(registry.node_pid, "comment-lab-node-server");
    stop_sidecar_pid(registry.python_pid, "comment-lab-python-sidecar");
    let _ = fs::remove_file(path);
}

fn persist_sidecar_registry(
    app: &tauri::AppHandle,
    node_port: u16,
    python_base_url: &str,
    node_pid: u32,
    python_pid: u32,
) -> bool {
    let path = resolve_sidecar_registry_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let payload = SidecarRegistry {
        node_port,
        python_base_url: python_base_url.to_string(),
        node_pid,
        python_pid,
        active_instances: 1,
    };
    if let Ok(json) = serde_json::to_string(&payload) {
        return fs::write(path, json).is_ok();
    }
    false
}

fn resolve_sidecar_registry_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_app_log_dir(app)
        .map(|dir| dir.join("sidecar-registry.json"))
        .unwrap_or_else(|_| PathBuf::from("sidecar-registry.json"))
}

fn parse_local_port_from_base_url(base_url: &str) -> Option<u16> {
    let value = base_url.trim().trim_end_matches('/');
    let port_text = value.rsplit(':').next()?;
    let port = port_text.parse::<u16>().ok()?;
    Some(port)
}

fn stop_sidecar_pid(pid: u32, expected_name: &str) {
    if pid == 0 {
        return;
    }
    if !matches_expected_process(pid, expected_name) {
        eprintln!("[desktop] skip stop pid={pid}, expected={expected_name}, identity mismatch");
        return;
    }
    #[cfg(target_os = "windows")]
    {
        if !matches_expected_process(pid, expected_name) {
            eprintln!("[desktop] skip stop pid={pid}, expected={expected_name}, identity mismatch");
            return;
        }
    }
    #[cfg(target_family = "unix")]
    {
        // SAFETY: best-effort terminate by known PID.
        unsafe {
            let _ = libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("taskkill");
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.args(["/PID", &pid.to_string(), "/T", "/F"]).status();
    }
}

fn matches_expected_process(pid: u32, expected_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("tasklist");
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = cmd
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .ok();
        let text = output
            .as_ref()
            .map(|v| String::from_utf8_lossy(&v.stdout).to_string())
            .unwrap_or_default()
            .to_lowercase();
        text.contains(&expected_name.to_lowercase())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (pid, expected_name);
        true
    }
}

fn acquire_registry_lock(app: &tauri::AppHandle) -> Option<RegistryLock> {
    let path = resolve_registry_lock_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    for _ in 0..80 {
        let file = OpenOptions::new().write(true).create_new(true).open(&path);
        if let Ok(mut f) = file {
            let _ = writeln!(f, "{}", std::process::id());
            return Some(RegistryLock { path });
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    eprintln!("[desktop] failed to acquire sidecar registry lock");
    None
}

fn spawn_standalone_sidecars(app: &tauri::AppHandle) -> Option<(std::process::Child, u16)> {
    let python_sidecar = spawn_python_sidecar(app);
    let python_base_url = current_sidecar_base_url();
    match (python_sidecar, spawn_node_sidecar(app, &python_base_url)) {
        (Some(python_child), Some((node_child, node_port))) => {
            write_python_pid_lock(app, python_child.id());
            Some((node_child, node_port))
        }
        (Some(mut python_child), None) => {
            let _ = python_child.kill();
            let _ = python_child.wait();
            None
        }
        _ => None
    }
}

fn resolve_python_pid_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_app_log_dir(app)
        .map(|dir| dir.join("python-sidecar.pid"))
        .unwrap_or_else(|_| PathBuf::from("python-sidecar.pid"))
}

fn write_python_pid_lock(app: &tauri::AppHandle, pid: u32) {
    let path = resolve_python_pid_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, pid.to_string());
}

fn read_python_pid_from_lock(app: &tauri::AppHandle) -> Option<u32> {
    let path = resolve_python_pid_path(app);
    let content = fs::read_to_string(path).ok()?;
    content.trim().parse::<u32>().ok()
}

fn resolve_registry_lock_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_app_log_dir(app)
        .map(|dir| dir.join("sidecar-registry.lock"))
        .unwrap_or_else(|_| PathBuf::from("sidecar-registry.lock"))
}

impl Drop for RegistryLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn spawn_node_sidecar(
    app: &tauri::AppHandle,
    python_base_url: &str,
) -> Option<(std::process::Child, u16)> {
    use std::process::{Command, Stdio};
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!("[desktop] 无法读取资源目录: {error}");
            return None;
        }
    };

    let node_port = match pick_available_local_port() {
        Some(port) => port,
        None => {
            let msg = "无法分配 Node 本地服务端口，请重启应用后重试";
            eprintln!("[desktop] {msg}");
            let log_path = resolve_sidecar_log_path(app);
            emit_sidecar_error(app, msg, &log_path);
            return None;
        }
    };
    let mut command = if cfg!(target_os = "windows") {
        let sidecar_path = find_named_sidecar_binary(&resource_dir, "comment-lab-node-server")
            .or_else(|| {
                find_named_sidecar_binary(&resource_dir.join("_up_"), "comment-lab-node-server")
            })
            .or_else(|| {
                find_named_sidecar_binary(&resource_dir.join("bin"), "comment-lab-node-server")
            })
            .or_else(|| {
                find_named_sidecar_binary(&resource_dir.join("binaries"), "comment-lab-node-server")
            });
        let Some(sidecar_path) = sidecar_path else {
            let msg = "未找到 Node 侧车可执行文件，请重新安装桌面应用";
            eprintln!("[desktop] {msg}");
            let log_path = resolve_sidecar_log_path(app);
            emit_sidecar_error(app, msg, &log_path);
            return None;
        };
        if resolve_server_entry_path(&resource_dir).is_none() {
            let msg = "未找到 Node 服务入口 server/index.mjs，请重新安装桌面应用";
            eprintln!("[desktop] {msg}");
            let log_path = resolve_sidecar_log_path(app);
            emit_sidecar_error(app, msg, &log_path);
            return None;
        }
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new(&sidecar_path);
            cmd.current_dir(&resource_dir);
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut cmd = Command::new(&sidecar_path);
            cmd.current_dir(&resource_dir);
            cmd
        }
    } else {
        let sidecar_path = find_named_sidecar_binary(&resource_dir, "comment-lab-node-server")
            .or_else(|| {
                find_named_sidecar_binary(&resource_dir.join("_up_"), "comment-lab-node-server")
            })
            .or_else(|| {
                find_named_sidecar_binary(&resource_dir.join("bin"), "comment-lab-node-server")
            });
        let Some(binary_path) = sidecar_path else {
            let msg = "未找到 Node 本地服务侧车可执行文件，请重新安装桌面应用";
            eprintln!("[desktop] {msg}");
            let log_path = resolve_sidecar_log_path(app);
            emit_sidecar_error(app, msg, &log_path);
            return None;
        };
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new(&binary_path);
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new(&binary_path)
        }
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(open_node_log_file(app).map_or(Stdio::null(), Stdio::from))
        .env("HOST", "127.0.0.1")
        .env("PORT", node_port.to_string())
        .env("NITRO_HOST", "127.0.0.1")
        .env("NITRO_PORT", node_port.to_string())
        .env("PYTHON_DASHSCOPE_SERVICE_URL", python_base_url);

    match command.spawn() {
        Ok(mut child) => {
            std::thread::sleep(Duration::from_millis(300));
            if let Ok(Some(status)) = child.try_wait() {
                eprintln!("[desktop] Node 本地服务启动后立即退出: {status}");
                let msg = "Node 本地服务启动失败，请检查安装包完整性";
                let log_path = resolve_sidecar_log_path(app);
                emit_sidecar_error(app, msg, &log_path);
                return None;
            }

            let deadline = Instant::now() + Duration::from_secs(15);
            while Instant::now() < deadline {
                if is_sidecar_ready(node_port) {
                    return Some((child, node_port));
                }
                std::thread::sleep(Duration::from_millis(200));
            }

            eprintln!("[desktop] Node 本地服务超时未就绪，port={node_port}");
            let _ = child.kill();
            let _ = child.wait();
            let msg = "Node 本地服务启动超时，请重启应用";
            let log_path = resolve_sidecar_log_path(app);
            emit_sidecar_error(app, msg, &log_path);
            None
        }
        Err(error) => {
            eprintln!("[desktop] 启动 Node 本地服务失败: {error}");
            let msg = "启动 Node 本地服务失败，请检查安装包权限";
            let log_path = resolve_sidecar_log_path(app);
            emit_sidecar_error(app, msg, &log_path);
            None
        }
    }
}

fn resolve_server_entry_path(resource_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        resource_dir.join("server").join("index.mjs"),
        resource_dir.join("_up_").join("server").join("index.mjs"),
        resource_dir
            .join("_up_")
            .join(".output")
            .join("server")
            .join("index.mjs"),
        resource_dir.join("bin").join("server").join("index.mjs"),
        resource_dir
            .join("binaries")
            .join("server")
            .join("index.mjs"),
    ];
    candidates.into_iter().find(|path| path.is_file())
}

#[derive(Serialize)]
struct DesktopDiagnostics {
    app_log_dir: String,
    sidecar_log_path: String,
    sidecar_base_url: String,
}

#[tauri::command]
fn get_desktop_diagnostics(app: tauri::AppHandle) -> Result<DesktopDiagnostics, String> {
    let app_log_dir = resolve_app_log_dir(&app).map_err(|e| format!("无法读取应用目录: {e}"))?;
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
    let dir = resolve_app_log_dir(&app).map_err(|e| format!("无法读取应用目录: {e}"))?;
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
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

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

    emit_sidecar_status(
        app,
        "starting",
        "正在准备本地推理引擎",
        0,
        SIDECAR_STARTUP_MAX_ATTEMPTS,
        None,
    );
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
        set_process_env_var("PYTHON_DASHSCOPE_SERVICE_URL", &base_url);
        emit_sidecar_status(
            app,
            "starting",
            &format!("正在启动本地引擎（第 {attempt}/{SIDECAR_STARTUP_MAX_ATTEMPTS} 次）"),
            attempt,
            SIDECAR_STARTUP_MAX_ATTEMPTS,
            Some(&base_url),
        );
        let stderr_file = open_sidecar_log_file(&log_path).ok();
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = Command::new(&binary_path);
            command.creation_flags(CREATE_NO_WINDOW);
            command
        };
        #[cfg(not(target_os = "windows"))]
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
                        &build_python_sidecar_exit_message(&log_path),
                        &log_path,
                    );
                    return None;
                }

                let deadline =
                    Instant::now() + Duration::from_secs(SIDECAR_STARTUP_READY_TIMEOUT_SECS);
                while Instant::now() < deadline {
                    if is_sidecar_ready(port) {
                        emit_sidecar_status(
                            app,
                            "ready",
                            "本地引擎已就绪",
                            attempt,
                            SIDECAR_STARTUP_MAX_ATTEMPTS,
                            Some(&base_url),
                        );
                        return Some(child);
                    }
                    std::thread::sleep(Duration::from_millis(300));
                }

                eprintln!("[desktop] Python 侧车超时未就绪，attempt={attempt}, port={port}");
                let _ = child.kill();
                let _ = child.wait();
                if attempt < SIDECAR_STARTUP_MAX_ATTEMPTS {
                    emit_sidecar_status(
                        app,
                        "retrying",
                        "本地引擎启动超时，正在重试",
                        attempt,
                        SIDECAR_STARTUP_MAX_ATTEMPTS,
                        Some(&base_url),
                    );
                    std::thread::sleep(Duration::from_millis(600));
                    continue;
                }
                emit_sidecar_error(
                    app,
                    &build_python_sidecar_exit_message(&log_path),
                    &log_path,
                );
                return None;
            }
            Err(error) => {
                eprintln!("[desktop] 启动 Python 侧车失败: {error}");
                if attempt < SIDECAR_STARTUP_MAX_ATTEMPTS {
                    emit_sidecar_status(
                        app,
                        "retrying",
                        "侧车进程拉起失败，正在重试",
                        attempt,
                        SIDECAR_STARTUP_MAX_ATTEMPTS,
                        Some(&base_url),
                    );
                    std::thread::sleep(Duration::from_millis(600));
                    continue;
                }
                emit_sidecar_error(
                    app,
                    &build_python_sidecar_exit_message(&log_path),
                    &log_path,
                );
                return None;
            }
        }
    }
    None
}

fn find_sidecar_binary(dir: &std::path::Path) -> Option<PathBuf> {
    find_named_sidecar_binary(dir, "comment-lab-python-sidecar")
}

fn find_named_sidecar_binary(dir: &std::path::Path, base_name: &str) -> Option<PathBuf> {
    let direct = dir.join(base_name);
    if direct.is_file() {
        return Some(direct);
    }

    let direct_exe = dir.join(format!("{base_name}.exe"));
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
            if file_name.starts_with(base_name) {
                return Some(path);
            }
        }
    }

    None
}

fn resolve_sidecar_log_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_app_log_dir(app)
        .map(|dir| dir.join("python-sidecar.stderr.log"))
        .unwrap_or_else(|_| PathBuf::from("python-sidecar.stderr.log"))
}

fn open_sidecar_log_file(path: &Path) -> io::Result<std::fs::File> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    OpenOptions::new().create(true).append(true).open(path)
}

fn open_node_log_file(app: &tauri::AppHandle) -> io::Result<std::fs::File> {
    let path = resolve_node_log_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    OpenOptions::new().create(true).append(true).open(path)
}

fn resolve_node_log_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_app_log_dir(app)
        .map(|dir| dir.join("node-sidecar.stderr.log"))
        .unwrap_or_else(|_| PathBuf::from("node-sidecar.stderr.log"))
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

fn update_main_window_url(app: &tauri::AppHandle, node_port: u16) {
    let url = format!("http://127.0.0.1:{node_port}");
    if let Some(main_window) = app.get_webview_window("main") {
        match Url::parse(&url) {
            Ok(parsed) => {
                if let Err(error) = main_window.navigate(parsed) {
                    eprintln!("[desktop] main window navigate 失败: {error}, target={url}");
                    if let Err(eval_error) =
                        main_window.eval(&format!("window.location.replace({url:?});"))
                    {
                        eprintln!(
                            "[desktop] main window eval 回退也失败: {eval_error}, target={url}"
                        );
                    }
                }
            }
            Err(parse_error) => {
                eprintln!("[desktop] main window URL 解析失败: {parse_error}, raw={url}");
                if let Err(error) = main_window.eval(&format!("window.location.replace({url:?});"))
                {
                    eprintln!("[desktop] main window eval 回退失败: {error}, target={url}");
                }
            }
        }
    } else {
        eprintln!("[desktop] 未找到 main window，无法切换到 Node 动态端口: {url}");
    }
}

fn build_python_sidecar_exit_message(log_path: &Path) -> String {
    let tail = read_log_tail(log_path, 40);
    if tail.contains("GLIBC_") || tail.contains("version `GLIBC_") || tail.contains("not found") {
        return "Python 侧车启动失败：检测到 glibc/动态链接不兼容（构建机与目标机系统版本不匹配）"
            .to_string();
    }
    "Python 侧车启动失败，请在日志中查看详细错误".to_string()
}

fn resolve_app_log_dir(app: &tauri::AppHandle) -> Result<PathBuf, tauri::Error> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        return Ok(resource_dir);
    }
    app.path().app_log_dir()
}

fn read_log_tail(path: &Path, max_lines: usize) -> String {
    let Ok(content) = fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
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

fn configure_runtime_paths(app: &tauri::AppHandle) {
    let app_home = app.path().app_data_dir().ok();
    let config_dir = app.path().app_config_dir().ok();
    let log_dir = app.path().app_log_dir().ok();

    if let Some(path) = app_home.as_ref() {
        set_process_env_var("COMMENT_LAB_APP_HOME", path.as_os_str());
        set_process_env_var("COMMENT_LAB_APP_DATA_DIR", path.as_os_str());
        set_process_env_var("TEMP_VIDEO_DIR", path.join("temp-video").as_os_str());
    }
    if let Some(path) = config_dir.as_ref() {
        set_process_env_var("COMMENT_LAB_CONFIG_DIR", path.as_os_str());
    }
    if let Some(path) = log_dir.as_ref() {
        set_process_env_var("COMMENT_LAB_LOG_DIR", path.as_os_str());
    }
}

fn configure_sidecar_binary_envs(app: &tauri::AppHandle) {
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(_) => return,
    };
    let ffmpeg_path = find_named_sidecar_binary(&resource_dir, "comment-lab-ffmpeg")
        .or_else(|| find_named_sidecar_binary(&resource_dir.join("_up_"), "comment-lab-ffmpeg"))
        .or_else(|| find_named_sidecar_binary(&resource_dir.join("bin"), "comment-lab-ffmpeg"));
    if let Some(path) = ffmpeg_path {
        set_process_env_var("FFMPEG_BINARY", path.as_os_str());
    }
}

fn env_write_lock() -> &'static Mutex<()> {
    ENV_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

fn set_process_env_var<K, V>(key: K, value: V)
where
    K: AsRef<std::ffi::OsStr>,
    V: AsRef<std::ffi::OsStr>,
{
    let _guard = env_write_lock().lock().unwrap_or_else(|poisoned| {
        eprintln!("[desktop] env write lock poisoned; recovering");
        poisoned.into_inner()
    });
    // SAFETY: process-global env writes are serialized through ENV_WRITE_LOCK.
    unsafe {
        std::env::set_var(key, value);
    }
}
