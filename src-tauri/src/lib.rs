pub mod guards;
pub mod sidecar;
pub mod webview2;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::webview::NewWindowResponse;
use tauri::{Manager, RunEvent, WebviewWindowBuilder};

use crate::guards::{run_startup_guards, show_error_dialog, strip_verbatim_prefix};
use crate::sidecar::{is_allowed_navigation_url, resolve_runtime_paths, SidecarHandle};
use crate::webview2::ensure_webview2_or_exit;

fn resolve_exe_dir() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("无法获取当前程序路径：{e}"))?;
    exe_path
        .parent()
        .map(strip_verbatim_prefix)
        .ok_or_else(|| "无法解析程序所在目录".to_string())
}

pub fn run() {
    let exe_dir = match resolve_exe_dir() {
        Ok(dir) => dir,
        Err(msg) => {
            show_error_dialog("Better Endfield Gacha - 启动失败", &msg);
            std::process::exit(1);
        }
    };

    // 1. Guard against running directly inside %TEMP% / archive preview or read-only directories
    let data_dir = match run_startup_guards(&exe_dir) {
        Ok(dir) => dir,
        Err(err) => {
            show_error_dialog(&err.title, &err.message);
            std::process::exit(1);
        }
    };

    // 2. Ensure WebView2 Runtime is installed before initializing Tauri window
    ensure_webview2_or_exit();

    let setup_exe_dir = exe_dir.clone();
    let setup_data_dir = data_dir.clone();

    let app = match tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(move |app| {
            let resource_dir = app.path().resource_dir().ok();
            let cwd = std::env::current_dir().ok();
            let path_env = std::env::var_os("PATH");

            let runtime_paths = match resolve_runtime_paths(
                resource_dir.as_deref(),
                &setup_exe_dir,
                cwd.as_deref(),
                path_env.as_deref(),
                cfg!(debug_assertions),
            ) {
                Ok(p) => p,
                Err(msg) => {
                    show_error_dialog("Better Endfield Gacha - 缺少组件", &msg);
                    return Err(msg.into());
                }
            };

            let (sidecar, ready_url, port) = match SidecarHandle::start(&runtime_paths, &setup_data_dir) {
                Ok(res) => res,
                Err(msg) => {
                    show_error_dialog("Better Endfield Gacha - 服务启动失败", &msg);
                    return Err(msg.into());
                }
            };

            let sidecar_arc = Arc::new(sidecar);
            app.manage(sidecar_arc.clone());

            let win_cfg = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or_else(|| "缺少主窗口配置".to_string())?;

            let window = WebviewWindowBuilder::from_config(app.handle(), &win_cfg)?
                .on_navigation(move |url| is_allowed_navigation_url(url, port))
                .on_new_window(|_url, _features| NewWindowResponse::Deny)
                .build()?;

            let parsed_url = tauri::Url::parse(&ready_url)
                .map_err(|e| format!("解析本地服务地址失败：{e}"))?;
            window.navigate(parsed_url)?;

            Ok(())
        })
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(err) => {
            show_error_dialog(
                "Better Endfield Gacha - 启动失败",
                &crate::sidecar::scrub_secrets(&format!("初始化桌面窗口失败：{err}")),
            );
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(sidecar) = app_handle.try_state::<Arc<SidecarHandle>>() {
                sidecar.shutdown();
            }
        }
    });
}
