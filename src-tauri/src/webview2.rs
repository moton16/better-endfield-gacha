use crate::guards::{open_external_url, show_yes_no_dialog};

pub const WEBVIEW2_DOWNLOAD_URL: &str =
    "https://developer.microsoft.com/en-us/microsoft-edge/webview2/";
pub const WEBVIEW2_CLIENT_GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

/// Validate that a WebView2 `pv` registry string represents a real installed version.
/// EdgeUpdate leaves empty strings or `"0.0.0.0"` when WebView2 is absent or uninstalled.
pub fn is_valid_webview2_version(raw: &str) -> bool {
    let trimmed = raw.trim_matches(|c: char| c.is_ascii_whitespace() || c == '\0');
    if trimmed.is_empty() {
        return false;
    }

    let parts: Vec<&str> = trimmed.split('.').collect();
    if parts.is_empty() || parts.len() > 4 {
        return false;
    }

    let mut any_nonzero = false;
    for part in parts {
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
        if let Ok(num) = part.parse::<u64>() {
            if num > 0 {
                any_nonzero = true;
            }
        } else {
            return false;
        }
    }

    any_nonzero
}

/// Decode a Windows Registry `REG_SZ` / `REG_EXPAND_SZ` UTF-16LE buffer.
pub fn parse_reg_sz_wide(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 2 {
        return None;
    }
    let mut u16s = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        let unit = u16::from_le_bytes([chunk[0], chunk[1]]);
        if unit == 0 {
            break;
        }
        u16s.push(unit);
    }
    String::from_utf16(&u16s).ok()
}

#[cfg(windows)]
fn query_reg_pv(root: windows_sys::Win32::System::Registry::HKEY, subkey: &str, flags: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, REG_EXPAND_SZ, REG_SZ,
    };

    struct RegKeyGuard(HKEY);
    impl Drop for RegKeyGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    RegCloseKey(self.0);
                }
            }
        }
    }

    let subkey_w: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
    let val_w: Vec<u16> = "pv".encode_utf16().chain(std::iter::once(0)).collect();
    let mut hkey: HKEY = std::ptr::null_mut();

    let open_rc = unsafe { RegOpenKeyExW(root, subkey_w.as_ptr(), 0, flags, &mut hkey) };
    if open_rc != ERROR_SUCCESS || hkey.is_null() {
        return None;
    }
    let _guard = RegKeyGuard(hkey);

    let mut reg_type: u32 = 0;
    let mut size: u32 = 0;
    let query_len_rc = unsafe {
        RegQueryValueExW(
            hkey,
            val_w.as_ptr(),
            std::ptr::null(),
            &mut reg_type,
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if query_len_rc != ERROR_SUCCESS || size == 0 || size > 4096 {
        return None;
    }
    if reg_type != REG_SZ && reg_type != REG_EXPAND_SZ {
        return None;
    }

    let mut buf = vec![0u8; size as usize];
    let query_val_rc = unsafe {
        RegQueryValueExW(
            hkey,
            val_w.as_ptr(),
            std::ptr::null(),
            &mut reg_type,
            buf.as_mut_ptr(),
            &mut size,
        )
    };
    if query_val_rc != ERROR_SUCCESS {
        return None;
    }
    let parsed = parse_reg_sz_wide(&buf[..size as usize])?;
    if is_valid_webview2_version(&parsed) {
        Some(parsed)
    } else {
        None
    }
}

/// Detect installed Microsoft Edge WebView2 Runtime version from Windows Registry.
pub fn detect_webview2_version() -> Option<String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::{
            HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY,
        };

        let wow64_path = format!(
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_GUID}"
        );
        let native_path = format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_GUID}");

        let candidates = [
            (HKEY_LOCAL_MACHINE, wow64_path.as_str(), KEY_READ),
            (HKEY_LOCAL_MACHINE, native_path.as_str(), KEY_READ | KEY_WOW64_64KEY),
            (HKEY_CURRENT_USER, native_path.as_str(), KEY_READ),
        ];

        for (root, subkey, flags) in candidates {
            if let Some(ver) = query_reg_pv(root, subkey, flags) {
                return Some(ver);
            }
        }

        if let Ok(fixed_dir) = std::env::var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER") {
            let trimmed = fixed_dir.trim();
            if !trimmed.is_empty() && std::path::Path::new(trimmed).is_dir() {
                return Some("fixed-runtime".to_string());
            }
        }
        None
    }
    #[cfg(not(windows))]
    {
        Some("non-windows".to_string())
    }
}

/// Check WebView2 availability before launching Tauri; guide user and exit cleanly if missing.
pub fn ensure_webview2_or_exit() {
    if detect_webview2_version().is_none() {
        let should_open = show_yes_no_dialog(
            "Better Endfield Gacha - 缺少 WebView2 运行时",
            "未检测到 Microsoft Edge WebView2 运行时，桌面窗口无法启动。\n\n是否立即前往微软官方页面下载安装 WebView2 Runtime？\n（安装完成后重新启动本程序即可）",
        );
        if should_open {
            open_external_url(WEBVIEW2_DOWNLOAD_URL);
        }
        std::process::exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_webview2_version_strings() {
        assert!(is_valid_webview2_version("130.0.2849.68"));
        assert!(is_valid_webview2_version("130.0.2849.68\0"));
        assert!(is_valid_webview2_version("  1.0.0.0  "));
        assert!(is_valid_webview2_version("120.1"));

        assert!(!is_valid_webview2_version(""));
        assert!(!is_valid_webview2_version("   \0"));
        assert!(!is_valid_webview2_version("0.0.0.0"));
        assert!(!is_valid_webview2_version("0.0.0.0\0"));
        assert!(!is_valid_webview2_version("0"));
        assert!(!is_valid_webview2_version("130.0.2849.beta"));
        assert!(!is_valid_webview2_version("1.2.3.4.5"));
        assert!(!is_valid_webview2_version("1..3.4"));
    }

    #[test]
    fn decodes_utf16le_registry_sz_with_null_terminator() {
        let units: Vec<u16> = "131.0.2903.51\0garbage".encode_utf16().collect();
        let bytes: Vec<u8> = units.iter().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(
            parse_reg_sz_wide(&bytes),
            Some("131.0.2903.51".to_string())
        );
        assert_eq!(parse_reg_sz_wide(&[0]), None);
    }
}
