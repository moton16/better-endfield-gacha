use std::ffi::OsStr;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use crate::guards::strip_verbatim_prefix;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimePaths {
    pub node_exe: PathBuf,
    pub cli_entry: PathBuf,
    pub web_dir: PathBuf,
}

struct SidecarInner {
    child: Child,
    stdin: Option<ChildStdin>,
}

/// Manages the Node.js local HTTP server child process lifetime.
pub struct SidecarHandle {
    inner: Mutex<Option<SidecarInner>>,
    pub port: u16,
}

impl Drop for SidecarHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn has_bundled_files(base: &Path) -> Option<RuntimePaths> {
    let clean_base = strip_verbatim_prefix(base);
    let node_exe = clean_base.join("node").join(if cfg!(windows) { "node.exe" } else { "node" });
    let cli_entry = clean_base.join("dist").join("cli").join("index.js");
    let web_dir = clean_base.join("dist-web");
    if node_exe.is_file() && cli_entry.is_file() && web_dir.join("index.html").is_file() {
        Some(RuntimePaths {
            node_exe,
            cli_entry,
            web_dir,
        })
    } else {
        None
    }
}

fn find_node_on_path(path_env: Option<&OsStr>) -> Option<PathBuf> {
    let raw = path_env?;
    let bin_name = if cfg!(windows) { "node.exe" } else { "node" };
    for dir in std::env::split_paths(raw) {
        let candidate = strip_verbatim_prefix(&dir).join(bin_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn find_repo_root_dev_paths(
    start_dirs: &[&Path],
    path_env: Option<&OsStr>,
) -> Option<RuntimePaths> {
    for start in start_dirs {
        let clean_start = strip_verbatim_prefix(start);
        for anc in clean_start.ancestors() {
            let cli_entry = anc.join("dist").join("cli").join("index.js");
            let web_dir = anc.join("dist-web");
            if cli_entry.is_file() && web_dir.join("index.html").is_file() {
                let bundled_node = anc
                    .join("src-tauri")
                    .join("resources")
                    .join("node")
                    .join(if cfg!(windows) { "node.exe" } else { "node" });
                let node_exe = if bundled_node.is_file() {
                    Some(bundled_node)
                } else {
                    find_node_on_path(path_env)
                };
                if let Some(node_exe) = node_exe {
                    return Some(RuntimePaths {
                        node_exe: strip_verbatim_prefix(&node_exe),
                        cli_entry: strip_verbatim_prefix(&cli_entry),
                        web_dir: strip_verbatim_prefix(&web_dir),
                    });
                }
            }
        }
    }
    None
}

/// Locate bundled runtime assets (`node/node.exe`, `dist/cli/index.js`, `dist-web/`)
/// inside `resource_dir` / `exe_dir`, with dev-mode repo root fallback.
pub fn resolve_runtime_paths(
    resource_dir: Option<&Path>,
    exe_dir: &Path,
    cwd: Option<&Path>,
    path_env: Option<&OsStr>,
    allow_dev_fallback: bool,
) -> Result<RuntimePaths, String> {
    let clean_exe = strip_verbatim_prefix(exe_dir);
    let clean_cwd = cwd.map(strip_verbatim_prefix);
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Some(res) = resource_dir {
        let clean_res = strip_verbatim_prefix(res);
        bases.push(clean_res.join("resources"));
        bases.push(clean_res);
    }
    bases.push(clean_exe.join("resources"));
    bases.push(clean_exe.clone());

    for base in &bases {
        if let Some(found) = has_bundled_files(base) {
            return Ok(RuntimePaths {
                node_exe: strip_verbatim_prefix(&found.node_exe),
                cli_entry: strip_verbatim_prefix(&found.cli_entry),
                web_dir: strip_verbatim_prefix(&found.web_dir),
            });
        }
    }

    if allow_dev_fallback {
        let mut starts: Vec<&Path> = vec![clean_exe.as_path()];
        if let Some(ref c) = clean_cwd {
            starts.push(c.as_path());
        }
        if let Some(dev_paths) = find_repo_root_dev_paths(&starts, path_env) {
            return Ok(dev_paths);
        }
    }

    Err(
        "启动失败：未找到内置运行组件（resources/node/node.exe、dist/cli/index.js 或 dist-web/index.html），请重新解压或重新安装软件。"
            .to_string(),
    )
}

fn is_secret_delim(b: u8) -> bool {
    b.is_ascii_whitespace() || matches!(b, b'"' | b'\'' | b'<' | b'>' | b')' | b']')
}

/// Scrub `#k=<key>`, `token=<...>`, and `u8_token=<...>` secrets from diagnostic strings.
pub fn scrub_secrets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        // Check `#k=`
        if bytes[i..].starts_with(b"#k=") {
            out.push_str("#k=<redacted>");
            i += 3;
            while i < bytes.len() && !is_secret_delim(bytes[i]) {
                i += 1;
            }
            continue;
        }

        // Check case-insensitive `u8_token=` or `token=` at query/boundary position
        let at_boundary = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
        if at_boundary {
            let matched_len = if bytes[i..].len() >= 9
                && bytes[i..i + 9].eq_ignore_ascii_case(b"u8_token=")
            {
                Some(9)
            } else if bytes[i..].len() >= 6 && bytes[i..i + 6].eq_ignore_ascii_case(b"token=") {
                Some(6)
            } else {
                None
            };

            if let Some(prefix_len) = matched_len {
                out.push_str(&input[i..i + prefix_len]);
                out.push_str("<redacted>");
                i += prefix_len;
                while i < bytes.len() && bytes[i] != b'&' && !is_secret_delim(bytes[i]) {
                    i += 1;
                }
                continue;
            }
        }

        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }

    out
}

/// Extract and validate `http://127.0.0.1:<port>/#k=<key>` from a stdout line in memory.
/// Rejects non-loopback hosts, missing/zero ports, empty keys, and non-token fragments (e.g. `#k=<隐藏>`).
pub fn parse_ready_url_from_line(line: &str) -> Option<(String, u16)> {
    const PREFIX: &str = "http://127.0.0.1:";
    let mut search_from = 0;

    while let Some(rel_idx) = line[search_from..].find("http://") {
        let start = search_from + rel_idx;
        let rest = &line[start..];
        let end = rest
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | ')'))
            .unwrap_or(rest.len());
        let candidate = &rest[..end];

        if let Some(after_host) = candidate.strip_prefix(PREFIX) {
            if let Some(slash_idx) = after_host.find('/') {
                let port_str = &after_host[..slash_idx];
                let path_and_frag = &after_host[slash_idx..];
                if !port_str.is_empty() && port_str.bytes().all(|b| b.is_ascii_digit()) {
                    if let Ok(port) = port_str.parse::<u16>() {
                        if port > 0 {
                            if let Some(key) = path_and_frag.strip_prefix("/#k=") {
                                if !key.is_empty()
                                    && key
                                        .bytes()
                                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                                {
                                    return Some((candidate.to_string(), port));
                                }
                            }
                        }
                    }
                }
            }
        }

        search_from = start + 7;
    }

    None
}

/// Strictly permit navigation ONLY to `about:blank` or `http://127.0.0.1:<port>/...` / `http://localhost:<port>/...`.
pub fn is_allowed_navigation_url(url: &tauri::Url, allowed_port: u16) -> bool {
    if url.scheme() == "about" {
        return url.as_str() == "about:blank";
    }
    if url.scheme() != "http" {
        return false;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if url.port() != Some(allowed_port) {
        return false;
    }
    matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
}

pub fn is_allowed_navigation_str(raw: &str, allowed_port: u16) -> bool {
    match tauri::Url::parse(raw) {
        Ok(url) => is_allowed_navigation_url(&url, allowed_port),
        Err(_) => false,
    }
}

fn append_bounded_scrubbed(buf: &Arc<Mutex<String>>, line: &str) {
    const MAX_DIAG_BYTES: usize = 8192;
    let clean = scrub_secrets(line);
    if let Ok(mut guard) = buf.lock() {
        guard.push_str(&clean);
        if !clean.ends_with('\n') {
            guard.push('\n');
        }
        if guard.len() > MAX_DIAG_BYTES {
            let cut = guard.len() - MAX_DIAG_BYTES;
            let mut safe_cut = cut;
            while safe_cut < guard.len() && !guard.is_char_boundary(safe_cut) {
                safe_cut += 1;
            }
            guard.drain(..safe_cut);
        }
    }
}

impl SidecarHandle {
    /// Spawn Node sidecar, wait up to 15s for loopback `#k=` ready URL in RAM,
    /// and retain stdin handle so closing stdin triggers clean SQLite WAL checkpoint exit.
    pub fn start(paths: &RuntimePaths, data_dir: &Path) -> Result<(Self, String, u16), String> {
        let node_exe = strip_verbatim_prefix(&paths.node_exe);
        let cli_entry = strip_verbatim_prefix(&paths.cli_entry);
        let web_dir = strip_verbatim_prefix(&paths.web_dir);
        let clean_data_dir = strip_verbatim_prefix(data_dir);

        let mut cmd = Command::new(&node_exe);
        cmd.arg(&cli_entry)
            .args([
                "serve",
                "--port",
                "0",
                "--no-open",
                "--parent-pid",
                &std::process::id().to_string(),
                "--watch-stdin",
                "--data-dir",
            ])
            .arg(&clean_data_dir)
            .env("BEG_WEB_DIR", &web_dir)
            .env("BEG_DATA_DIR", &clean_data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("启动后台服务进程失败：{}", scrub_secrets(&e.to_string())))?;

        let stdin = child.stdin.take();
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "后台服务 stdout 管道不可用".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "后台服务 stderr 管道不可用".to_string())?;

        let diag_buf = Arc::new(Mutex::new(String::new()));
        let diag_err = diag_buf.clone();
        std::thread::Builder::new()
            .name("beg-sidecar-stderr".to_string())
            .spawn(move || {
                let mut reader = BufReader::new(stderr);
                let mut line_bytes = Vec::new();
                loop {
                    line_bytes.clear();
                    match reader.read_until(b'\n', &mut line_bytes) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let line = String::from_utf8_lossy(&line_bytes);
                            append_bounded_scrubbed(&diag_err, &line);
                        }
                    }
                }
            })
            .ok();

        let (tx, rx) = mpsc::sync_channel::<Result<(String, u16), String>>(1);
        let diag_out = diag_buf.clone();
        std::thread::Builder::new()
            .name("beg-sidecar-stdout".to_string())
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                let mut line_bytes = Vec::new();
                let mut ready_sent = false;
                loop {
                    line_bytes.clear();
                    match reader.read_until(b'\n', &mut line_bytes) {
                        Ok(0) => {
                            if !ready_sent {
                                let _ = tx.send(Err("后台服务在输出监听地址前意外退出".to_string()));
                            }
                            break;
                        }
                        Err(e) => {
                            if !ready_sent {
                                let _ = tx.send(Err(format!(
                                    "读取后台服务输出失败：{}",
                                    scrub_secrets(&e.to_string())
                                )));
                            }
                            break;
                        }
                        Ok(_) => {
                            let line = String::from_utf8_lossy(&line_bytes);
                            if !ready_sent {
                                if let Some(parsed) = parse_ready_url_from_line(&line) {
                                    ready_sent = true;
                                    let _ = tx.send(Ok(parsed));
                                    continue;
                                }
                            }
                            append_bounded_scrubbed(&diag_out, &line);
                        }
                    }
                }
            })
            .ok();

        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(Ok((ready_url, port))) => Ok((
                Self {
                    inner: Mutex::new(Some(SidecarInner { child, stdin })),
                    port,
                },
                ready_url,
                port,
            )),
            Ok(Err(msg)) => {
                drop(stdin);
                let _ = child.kill();
                let _ = child.wait();
                let diag = diag_buf.lock().map(|g| g.trim().to_string()).unwrap_or_default();
                if diag.is_empty() {
                    Err(msg)
                } else {
                    Err(format!("{msg}\n\n详情：{diag}"))
                }
            }
            Err(_) => {
                drop(stdin);
                let _ = child.kill();
                let _ = child.wait();
                let diag = diag_buf.lock().map(|g| g.trim().to_string()).unwrap_or_default();
                if diag.is_empty() {
                    Err("等待后台服务启动超时（15 秒）".to_string())
                } else {
                    Err(format!("等待后台服务启动超时（15 秒）\n\n详情：{diag}"))
                }
            }
        }
    }

    /// Gracefully stop Node sidecar: close stdin first so `--watch-stdin` triggers
    /// `app.close()` + `store.close()` WAL checkpoint, wait up to 1500ms, then force kill.
    pub fn shutdown(&self) {
        let mut inner = match self.inner.lock() {
            Ok(mut guard) => match guard.take() {
                Some(inner) => inner,
                None => return,
            },
            Err(poisoned) => match poisoned.into_inner().take() {
                Some(inner) => inner,
                None => return,
            },
        };

        // Close stdin first to trigger graceful EOF shutdown via --watch-stdin
        drop(inner.stdin.take());

        let deadline = Instant::now() + Duration::from_millis(1500);
        loop {
            match inner.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(_) => break,
            }
        }

        let _ = inner.child.kill();
        let _ = inner.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDirGuard(PathBuf);
    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn mk_temp_dir(name: &str) -> TempDirGuard {
        let dir = std::env::temp_dir().join(format!(
            "beg-tauri-sidecar-test-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        TempDirGuard(dir)
    }

    #[test]
    fn parses_valid_loopback_ready_url_and_ignores_redacted_line() {
        let line1 = "本地服务已启动：http://127.0.0.1:54321/#k=<隐藏>";
        assert_eq!(parse_ready_url_from_line(line1), None);

        let line2 = "（--no-open）完整地址（含密钥，勿分享）：http://127.0.0.1:54321/#k=AbCdEf012345_6789-xyZ";
        assert_eq!(
            parse_ready_url_from_line(line2),
            Some((
                "http://127.0.0.1:54321/#k=AbCdEf012345_6789-xyZ".to_string(),
                54321
            ))
        );
    }

    #[test]
    fn rejects_non_loopback_or_malformed_ready_urls() {
        assert_eq!(
            parse_ready_url_from_line("http://0.0.0.0:54321/#k=AbCdEf012345"),
            None
        );
        assert_eq!(
            parse_ready_url_from_line("http://192.168.1.10:54321/#k=AbCdEf012345"),
            None
        );
        assert_eq!(
            parse_ready_url_from_line("https://127.0.0.1:54321/#k=AbCdEf012345"),
            None
        );
        assert_eq!(
            parse_ready_url_from_line("http://127.0.0.1:0/#k=AbCdEf012345"),
            None
        );
        assert_eq!(
            parse_ready_url_from_line("http://127.0.0.1:54321/#k="),
            None
        );
        assert_eq!(
            parse_ready_url_from_line("http://127.0.0.1:54321/api/#k=AbCdEf012345"),
            None
        );
        assert_eq!(
            parse_ready_url_from_line("http://127.0.0.1:54321/#k=abc?extra=1"),
            None
        );
    }

    #[test]
    fn scrubs_keys_and_tokens_from_error_text() {
        let raw = "failed opening http://127.0.0.1:51234/#k=TopSecretKey_123 and https://ef.example/?u8_token=SECRET+ABC&token=OTHER123#k=SecondKey";
        let clean = scrub_secrets(raw);
        assert!(!clean.contains("TopSecretKey_123"));
        assert!(!clean.contains("SECRET+ABC"));
        assert!(!clean.contains("OTHER123"));
        assert!(!clean.contains("SecondKey"));
        assert!(clean.contains("#k=<redacted>"));
        assert!(clean.contains("u8_token=<redacted>"));
        assert!(clean.contains("token=<redacted>"));
        assert_eq!(scrub_secrets("broken=value stays"), "broken=value stays");
        assert_eq!(scrub_secrets("plain error message"), "plain error message");
    }

    #[test]
    fn resolves_flat_resource_dir_layout() {
        let tmp = mk_temp_dir("flat");
        let res_dir = tmp.0.join("res");
        let exe_dir = tmp.0.join("bin");
        let node_name = if cfg!(windows) { "node.exe" } else { "node" };

        std::fs::create_dir_all(res_dir.join("node")).unwrap();
        std::fs::create_dir_all(res_dir.join("dist").join("cli")).unwrap();
        std::fs::create_dir_all(res_dir.join("dist-web")).unwrap();
        std::fs::create_dir_all(&exe_dir).unwrap();
        std::fs::write(res_dir.join("node").join(node_name), b"").unwrap();
        std::fs::write(res_dir.join("dist").join("cli").join("index.js"), b"").unwrap();
        std::fs::write(res_dir.join("dist-web").join("index.html"), b"").unwrap();

        let paths = resolve_runtime_paths(Some(&res_dir), &exe_dir, None, None, false).unwrap();
        assert_eq!(paths.node_exe, res_dir.join("node").join(node_name));
        assert_eq!(paths.cli_entry, res_dir.join("dist").join("cli").join("index.js"));
        assert_eq!(paths.web_dir, res_dir.join("dist-web"));
    }

    #[test]
    fn navigation_guard_enforces_about_blank_and_exact_loopback_port() {
        let port = 43210;
        assert!(is_allowed_navigation_str("about:blank", port));
        assert!(is_allowed_navigation_str("http://127.0.0.1:43210/", port));
        assert!(is_allowed_navigation_str(
            "http://127.0.0.1:43210/#k=secret",
            port
        ));
        assert!(is_allowed_navigation_str(
            "http://localhost:43210/assets/app.js",
            port
        ));

        // Disallowed ports, schemes, hosts, or userinfo spoofing
        assert!(!is_allowed_navigation_str("http://127.0.0.1:43211/", port));
        assert!(!is_allowed_navigation_str("http://localhost:80/", port));
        assert!(!is_allowed_navigation_str("https://127.0.0.1:43210/", port));
        assert!(!is_allowed_navigation_str("https://example.com/", port));
        assert!(!is_allowed_navigation_str("http://127.0.0.1@evil.com:43210/", port));
        assert!(!is_allowed_navigation_str("file:///C:/Windows/win.ini", port));
        assert!(!is_allowed_navigation_str("javascript:alert(1)", port));
        assert!(!is_allowed_navigation_str("about:config", port));
    }

    #[test]
    fn resolves_bundled_resources_layout_and_dev_fallback() {
        let tmp = mk_temp_dir("resolve");
        let res_root = tmp.0.join("install").join("resources");
        let exe_dir = tmp.0.join("install");
        let node_name = if cfg!(windows) { "node.exe" } else { "node" };

        std::fs::create_dir_all(res_root.join("node")).unwrap();
        std::fs::create_dir_all(res_root.join("dist").join("cli")).unwrap();
        std::fs::create_dir_all(res_root.join("dist-web")).unwrap();
        std::fs::write(res_root.join("node").join(node_name), b"").unwrap();
        std::fs::write(res_root.join("dist").join("cli").join("index.js"), b"").unwrap();
        std::fs::write(res_root.join("dist-web").join("index.html"), b"").unwrap();

        let paths = resolve_runtime_paths(Some(&exe_dir), &exe_dir, None, None, false).unwrap();
        assert_eq!(paths.node_exe, res_root.join("node").join(node_name));
        assert_eq!(
            paths.cli_entry,
            res_root.join("dist").join("cli").join("index.js")
        );
        assert_eq!(paths.web_dir, res_root.join("dist-web"));

        // Dev fallback locates repo-root dist/ + dist-web/ + node on PATH
        let repo = tmp.0.join("repo");
        let target_debug = repo.join("src-tauri").join("target").join("debug");
        let path_bin = tmp.0.join("bin");
        std::fs::create_dir_all(&target_debug).unwrap();
        std::fs::create_dir_all(repo.join("dist").join("cli")).unwrap();
        std::fs::create_dir_all(repo.join("dist-web")).unwrap();
        std::fs::create_dir_all(&path_bin).unwrap();
        std::fs::write(repo.join("dist").join("cli").join("index.js"), b"").unwrap();
        std::fs::write(repo.join("dist-web").join("index.html"), b"").unwrap();
        std::fs::write(path_bin.join(node_name), b"").unwrap();

        let dev_paths = resolve_runtime_paths(
            None,
            &target_debug,
            None,
            Some(path_bin.as_os_str()),
            true,
        )
        .unwrap();
        assert_eq!(dev_paths.node_exe, path_bin.join(node_name));
        assert_eq!(
            dev_paths.cli_entry,
            repo.join("dist").join("cli").join("index.js")
        );
        assert_eq!(dev_paths.web_dir, repo.join("dist-web"));

        // Without dev fallback, missing bundled resources returns Err
        assert!(resolve_runtime_paths(None, &target_debug, None, Some(path_bin.as_os_str()), false).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn strips_verbatim_prefix_from_canonical_windows_resource_dir() {
        let tmp = mk_temp_dir("verbatim");
        let res_root = tmp.0.join("resources");
        std::fs::create_dir_all(res_root.join("node")).unwrap();
        std::fs::create_dir_all(res_root.join("dist").join("cli")).unwrap();
        std::fs::create_dir_all(res_root.join("dist-web")).unwrap();
        std::fs::write(res_root.join("node").join("node.exe"), b"").unwrap();
        std::fs::write(res_root.join("dist").join("cli").join("index.js"), b"").unwrap();
        std::fs::write(res_root.join("dist-web").join("index.html"), b"").unwrap();

        // std::fs::canonicalize returns \\?\<drive>:\... just like Tauri's app.path().resource_dir() on Windows
        let verbatim_root = std::fs::canonicalize(&tmp.0).unwrap();
        assert!(verbatim_root.to_string_lossy().starts_with(r"\\?\"));

        let resolved =
            resolve_runtime_paths(Some(&verbatim_root), &tmp.0, None, None, false).unwrap();
        for p in [&resolved.node_exe, &resolved.cli_entry, &resolved.web_dir] {
            let s = p.to_string_lossy();
            assert!(!s.starts_with(r"\\?\"), "unexpected verbatim prefix in {s}");
        }
    }
}
