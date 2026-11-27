use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub const TEMP_GUARD_MESSAGE: &str = "请先将软件解压到普通文件夹（例如 E:\\Games\\BetterEndfieldGacha\\）后再运行，切勿在压缩包预览窗口或系统临时目录直接启动，以免抽卡记录丢失。";
pub const READONLY_GUARD_MESSAGE: &str = "当前数据目录不可写（只读目录或受系统保护路径），请移动到普通可写文件夹后再启动。";

static PROBE_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GuardError {
    pub title: String,
    pub message: String,
}

#[cfg(windows)]
fn to_wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Show a native modal error MessageBox on Windows (falls back to stderr elsewhere).
pub fn show_error_dialog(title: &str, message: &str) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND, MB_TOPMOST,
        };
        let title_w = to_wide_null(title);
        let msg_w = to_wide_null(message);
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                msg_w.as_ptr(),
                title_w.as_ptr(),
                MB_OK | MB_ICONERROR | MB_SETFOREGROUND | MB_TOPMOST,
            );
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("[{title}] {message}");
    }
}

/// Show a native Yes/No warning MessageBox on Windows (returns false elsewhere).
pub fn show_yes_no_dialog(title: &str, message: &str) -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, IDYES, MB_ICONWARNING, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO,
        };
        let title_w = to_wide_null(title);
        let msg_w = to_wide_null(message);
        let res = unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                msg_w.as_ptr(),
                title_w.as_ptr(),
                MB_YESNO | MB_ICONWARNING | MB_SETFOREGROUND | MB_TOPMOST,
            )
        };
        res == IDYES
    }
    #[cfg(not(windows))]
    {
        let _ = (title, message);
        false
    }
}

/// Open an HTTPS URL in the default browser via ShellExecuteW on Windows.
pub fn open_external_url(url: &str) {
    if !url.starts_with("https://") {
        return;
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let op = to_wide_null("open");
        let target = to_wide_null(url);
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
        }
    }
}

/// Returns true only when `BEG_ALLOW_TEMP` is explicitly `"1"`.
pub fn is_allow_temp_enabled(env_val: Option<&str>) -> bool {
    env_val.map(str::trim) == Some("1")
}

/// Strip Win32 verbatim `\\?\` / `\\?\UNC\` extended-length prefixes from standard drive or UNC paths
/// while preserving device/volume GUID paths (e.g. `\\?\Volume{...}\`) and original casing.
/// Child processes such as Node.js v24 fail with `EISDIR: lstat '<drive>:'` in `fs.realpathSync`
/// when given verbatim `\\?\X:\...` paths from Tauri `resource_dir()` or `std::fs::canonicalize`.
pub fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        if !rest.is_empty() {
            return PathBuf::from(format!(r"\\{rest}"));
        }
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        let bytes = rest.as_bytes();
        if bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
        {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

/// Normalize a path for case-insensitive Windows prefix comparison.
/// Canonicalizes existing paths to resolve 8.3 short names and junctions,
/// strips `\\?\` verbatim prefixes, normalizes separators, and lowercases.
pub fn normalize_windows_path(path: &Path) -> String {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let without_verbatim = strip_verbatim_prefix(&resolved).to_string_lossy().into_owned();

    let replaced = without_verbatim.replace('/', "\\");
    let is_unc = replaced.starts_with(r"\\");
    let mut collapsed = String::with_capacity(replaced.len());
    let mut prev_slash = false;
    for (idx, ch) in replaced.chars().enumerate() {
        if ch == '\\' {
            if is_unc && idx < 2 {
                collapsed.push(ch);
            } else if !prev_slash {
                collapsed.push(ch);
            }
            prev_slash = true;
        } else {
            collapsed.push(ch);
            prev_slash = false;
        }
    }

    let trimmed = if collapsed.len() > 3 && collapsed.ends_with('\\') {
        collapsed.trim_end_matches('\\').to_string()
    } else if collapsed.starts_with(r"\\") && collapsed.len() > 2 && collapsed.ends_with('\\') {
        collapsed.trim_end_matches('\\').to_string()
    } else {
        collapsed
    };

    trimmed.to_lowercase()
}

fn is_normalized_prefix(candidate: &str, root: &str) -> bool {
    if root.is_empty() {
        return false;
    }
    if candidate == root {
        return true;
    }
    if root.ends_with('\\') {
        candidate.starts_with(root)
    } else {
        candidate
            .strip_prefix(root)
            .is_some_and(|rest| rest.starts_with('\\'))
    }
}

/// Collect candidate system temporary directories from environment and OS APIs.
pub fn collect_temp_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for key in ["TEMP", "TMP"] {
        if let Ok(val) = std::env::var(key) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                roots.push(PathBuf::from(trimmed));
            }
        }
    }
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let trimmed = local_app_data.trim();
        if !trimmed.is_empty() {
            roots.push(PathBuf::from(trimmed).join("Temp"));
        }
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let trimmed = user_profile.trim();
        if !trimmed.is_empty() {
            roots.push(
                PathBuf::from(trimmed)
                    .join("AppData")
                    .join("Local")
                    .join("Temp"),
            );
        }
    }
    roots.push(std::env::temp_dir());
    roots
}

/// Check whether `exe_dir` resides inside any temporary directory or `AppData\Local\Temp`.
pub fn is_path_in_temp_dirs(exe_dir: &Path, temp_roots: &[PathBuf]) -> bool {
    let norm_exe = normalize_windows_path(exe_dir);
    if norm_exe.is_empty() {
        return false;
    }

    if norm_exe.ends_with(r"\appdata\local\temp")
        || norm_exe.contains(r"\appdata\local\temp\")
    {
        return true;
    }

    temp_roots.iter().any(|root| {
        let norm_root = normalize_windows_path(root);
        is_normalized_prefix(&norm_exe, &norm_root)
    })
}

pub fn check_not_in_temp_with(
    exe_dir: &Path,
    temp_roots: &[PathBuf],
    allow_temp_env: Option<&str>,
) -> Result<(), GuardError> {
    if is_allow_temp_enabled(allow_temp_env) {
        return Ok(());
    }
    if is_path_in_temp_dirs(exe_dir, temp_roots) {
        return Err(GuardError {
            title: "启动位置受限".to_string(),
            message: TEMP_GUARD_MESSAGE.to_string(),
        });
    }
    Ok(())
}

/// Resolve `data_dir` from `BEG_DATA_DIR` (if non-empty) or default `<exe_dir>/data`,
/// normalizing away Win32 verbatim `\\?\` prefixes for child Node.js compatibility.
pub fn resolve_data_dir(exe_dir: &Path, env_data_dir: Option<&str>) -> PathBuf {
    let clean_exe = strip_verbatim_prefix(exe_dir);
    if let Some(raw) = env_data_dir {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let candidate = strip_verbatim_prefix(Path::new(trimmed));
            if candidate.is_absolute() {
                return candidate;
            }
            let base = std::env::current_dir()
                .map(|p| strip_verbatim_prefix(&p))
                .unwrap_or_else(|_| clean_exe.clone());
            return strip_verbatim_prefix(&base.join(candidate));
        }
    }
    clean_exe.join("data")
}

/// Probe real write+delete capability on `data_dir` (or nearest existing ancestor / `exe_dir`
/// if `data_dir` does not exist yet), without leaving probe files or creating `data_dir`.
pub fn probe_data_dir_writable(data_dir: &Path, exe_dir: &Path) -> Result<(), GuardError> {
    let probe_dir = if data_dir.exists() {
        if !data_dir.is_dir() {
            return Err(GuardError {
                title: "数据目录不可写".to_string(),
                message: READONLY_GUARD_MESSAGE.to_string(),
            });
        }
        data_dir.to_path_buf()
    } else {
        let mut found = None;
        for anc in data_dir.ancestors().skip(1) {
            if anc.exists() {
                found = Some(anc.to_path_buf());
                break;
            }
        }
        let target = found.unwrap_or_else(|| exe_dir.to_path_buf());
        if !target.exists() || !target.is_dir() {
            return Err(GuardError {
                title: "数据目录不可写".to_string(),
                message: READONLY_GUARD_MESSAGE.to_string(),
            });
        }
        target
    };

    let pid = std::process::id();
    for _ in 0..8 {
        let seq = PROBE_SEQ.fetch_add(1, Ordering::Relaxed);
        let probe_path = probe_dir.join(format!(".beg-write-probe-{pid}-{seq}.tmp"));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe_path)
        {
            Ok(mut file) => {
                let write_res = file.write_all(b"beg-probe").and_then(|_| file.flush());
                drop(file);
                let remove_res = std::fs::remove_file(&probe_path);
                if write_res.is_ok() && remove_res.is_ok() {
                    return Ok(());
                }
                return Err(GuardError {
                    title: "数据目录不可写".to_string(),
                    message: READONLY_GUARD_MESSAGE.to_string(),
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                return Err(GuardError {
                    title: "数据目录不可写".to_string(),
                    message: READONLY_GUARD_MESSAGE.to_string(),
                });
            }
        }
    }

    Err(GuardError {
        title: "数据目录不可写".to_string(),
        message: READONLY_GUARD_MESSAGE.to_string(),
    })
}

/// Run all startup filesystem guards before spawning Node or touching `data/`.
pub fn run_startup_guards(exe_dir: &Path) -> Result<PathBuf, GuardError> {
    let allow_temp = std::env::var("BEG_ALLOW_TEMP").ok();
    let temp_roots = collect_temp_roots();
    check_not_in_temp_with(exe_dir, &temp_roots, allow_temp.as_deref())?;

    let env_data = std::env::var("BEG_DATA_DIR").ok();
    let data_dir = resolve_data_dir(exe_dir, env_data.as_deref());
    probe_data_dir_writable(&data_dir, exe_dir)?;
    Ok(data_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempCleanup(PathBuf);
    impl Drop for TempCleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn mk_unique_test_dir(tag: &str) -> TempCleanup {
        let seq = PROBE_SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "beg-tauri-guard-test-{}-{tag}-{seq}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("create temp test dir");
        TempCleanup(dir)
    }

    #[test]
    fn detects_temp_dir_case_insensitively_without_false_prefix_match() {
        let temp_roots = vec![PathBuf::from(r"C:\Users\Tester\AppData\Local\Temp")];

        // Inside %TEMP% (case mismatch + forward slash + archive preview subfolder)
        assert!(is_path_in_temp_dirs(
            Path::new(r"c:/users/tester/appdata/local/temp/Rar$EXa123/BetterEndfieldGacha"),
            &temp_roots,
        ));
        assert!(is_path_in_temp_dirs(
            Path::new(r"C:\Users\Tester\AppData\Local\Temp"),
            &temp_roots,
        ));

        // Arbitrary user's AppData\Local\Temp even if temp_roots differs
        assert!(is_path_in_temp_dirs(
            Path::new(r"D:\Profiles\Player\AppData\Local\Temp\7zO123"),
            &[],
        ));

        // Sibling directory starting with "Temp2" must NOT false-positive
        assert!(!is_path_in_temp_dirs(
            Path::new(r"C:\Users\Tester\AppData\Local\Temp2\BetterEndfieldGacha"),
            &temp_roots,
        ));

        // Normal install directory is allowed
        assert!(!is_path_in_temp_dirs(
            Path::new(r"E:\Games\BetterEndfieldGacha"),
            &temp_roots,
        ));
    }

    #[test]
    fn allow_temp_env_bypass_requires_exact_1() {
        let temp_roots = vec![PathBuf::from(r"C:\Temp")];
        let exe_dir = Path::new(r"C:\Temp\preview");

        assert!(check_not_in_temp_with(exe_dir, &temp_roots, None).is_err());
        assert!(check_not_in_temp_with(exe_dir, &temp_roots, Some("0")).is_err());
        assert!(check_not_in_temp_with(exe_dir, &temp_roots, Some("true")).is_err());
        assert!(check_not_in_temp_with(exe_dir, &temp_roots, Some("1")).is_ok());
    }

    #[test]
    fn resolve_data_dir_prefers_non_empty_env_else_exe_data() {
        let exe_dir = Path::new(r"E:\Games\BEG");
        assert_eq!(resolve_data_dir(exe_dir, None), PathBuf::from(r"E:\Games\BEG\data"));
        assert_eq!(
            resolve_data_dir(exe_dir, Some("   ")),
            PathBuf::from(r"E:\Games\BEG\data")
        );
        assert_eq!(
            resolve_data_dir(exe_dir, Some(r"D:\CustomData")),
            PathBuf::from(r"D:\CustomData")
        );
    }

    #[test]
    fn probe_writable_succeeds_and_cleans_up_probe_file() {
        let tmp = mk_unique_test_dir("writable");
        let exe_dir = tmp.0.join("app");
        std::fs::create_dir_all(&exe_dir).unwrap();
        let data_dir = exe_dir.join("data");

        // When data/ does not exist yet, probe checks exe_dir and does NOT create data/
        assert!(probe_data_dir_writable(&data_dir, &exe_dir).is_ok());
        assert!(!data_dir.exists());
        assert_eq!(std::fs::read_dir(&exe_dir).unwrap().count(), 0);

        // When data/ exists, probe checks data/ and leaves no probe file behind
        std::fs::create_dir_all(&data_dir).unwrap();
        assert!(probe_data_dir_writable(&data_dir, &exe_dir).is_ok());
        assert_eq!(std::fs::read_dir(&data_dir).unwrap().count(), 0);
    }

    #[test]
    fn probe_writable_rejects_file_blocking_data_dir_or_parent() {
        let tmp = mk_unique_test_dir("readonly");
        let blocking_file = tmp.0.join("not-a-dir");
        std::fs::write(&blocking_file, b"lock").unwrap();

        // data_dir is actually a regular file
        assert!(probe_data_dir_writable(&blocking_file, &tmp.0).is_err());

        // data_dir's ancestor is a regular file (unwritable path)
        let nested_under_file = blocking_file.join("data");
        assert!(probe_data_dir_writable(&nested_under_file, &tmp.0).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn normalize_windows_path_strips_verbatim_and_trailing_slashes() {
        assert_eq!(
            normalize_windows_path(Path::new(r"\\?\E:\Games\BEG\")),
            r"e:\games\beg"
        );
        assert_eq!(
            normalize_windows_path(Path::new(r"\\?\UNC\server\Share\Folder\")),
            r"\\server\share\folder"
        );
        assert_eq!(normalize_windows_path(Path::new(r"C:\")), r"c:\");
    }

    #[test]
    fn strip_verbatim_prefix_preserves_casing_and_leaves_device_paths() {
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"\\?\D:\Games\BEG\resources\dist\cli\index.js")),
            PathBuf::from(r"D:\Games\BEG\resources\dist\cli\index.js")
        );
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"\\?\UNC\Server\Share\BEG")),
            PathBuf::from(r"\\Server\Share\BEG")
        );
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"\\?\Volume{12345678-1234-1234-1234-1234567890ab}\")),
            PathBuf::from(r"\\?\Volume{12345678-1234-1234-1234-1234567890ab}\")
        );
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"D:\Normal\Path")),
            PathBuf::from(r"D:\Normal\Path")
        );
    }
}
