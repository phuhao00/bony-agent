use crate::clipboard::{read_clipboard_snapshot, ClipboardState};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct ForegroundInfo {
    pub app_id: Option<String>,
    pub title: Option<String>,
}

pub fn foreground_app() -> ForegroundInfo {
    match active_win_pos_rs::get_active_window() {
        Ok(win) => ForegroundInfo {
            app_id: Some(win.process_path.to_string_lossy().to_string()),
            title: Some(win.title),
        },
        Err(_) => ForegroundInfo {
            app_id: None,
            title: None,
        },
    }
}

pub fn idle_seconds() -> u64 {
    #[cfg(target_os = "macos")]
    {
        // FFI 边界：避免异常类型导致 catch_unwind 无效，仅捕获 panic
        return std::panic::catch_unwind(macos_idle_seconds).unwrap_or(0);
    }
    #[cfg(target_os = "windows")]
    {
        return windows_idle_seconds();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        0
    }
}

#[cfg(target_os = "macos")]
fn macos_idle_seconds() -> u64 {
    // CoreGraphics API — 勿用裸 C 字符串调 IORegistryEntryCreateCFProperty（会 SIGTRAP）
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: u64, event_type: u32) -> f64;
    }
    const KCG_EVENT_SOURCE_STATE_COMBINED_SESSION: u64 = 0;
    const KCG_ANY_INPUT_EVENT_TYPE: u32 = 0xFFFF_FFFF;

    let seconds = unsafe {
        CGEventSourceSecondsSinceLastEventType(
            KCG_EVENT_SOURCE_STATE_COMBINED_SESSION,
            KCG_ANY_INPUT_EVENT_TYPE,
        )
    };
    if seconds.is_finite() && seconds >= 0.0 {
        seconds as u64
    } else {
        0
    }
}

#[cfg(target_os = "windows")]
fn windows_idle_seconds() -> u64 {
    use std::mem::MaybeUninit;
    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
        fn GetTickCount() -> u32;
    }
    unsafe {
        let mut info = MaybeUninit::<LastInputInfo>::uninit();
        (*info.as_mut_ptr()).cb_size = std::mem::size_of::<LastInputInfo>() as u32;
        if GetLastInputInfo(info.as_mut_ptr()) == 0 {
            return 0;
        }
        let info = info.assume_init();
        let tick = GetTickCount();
        ((tick - info.dw_time) / 1000) as u64
    }
}

pub fn collect_perception(
    clipboard: &Arc<Mutex<ClipboardState>>,
    include_preview: bool,
) -> Value {
    let fg = foreground_app();
    let snap = read_clipboard_snapshot(clipboard, include_preview).unwrap_or_default();
    json!({
        "foreground_app": fg.app_id,
        "foreground_title": fg.title,
        "idle_seconds": idle_seconds(),
        "clipboard_preview": snap.preview,
        "clipboard_hash": snap.hash,
        "clipboard_len": snap.len,
        "local_hour": local_hour(),
    })
}

pub fn local_hour() -> u32 {
    #[cfg(unix)]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let t = now as i64;
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        unsafe {
            libc::localtime_r(&t, &mut tm);
            return tm.tm_hour.max(0) as u32;
        }
    }
    #[cfg(windows)]
    {
        use std::mem::MaybeUninit;
        #[repr(C)]
        struct SystemTime {
            w_year: u16,
            w_month: u16,
            w_day_of_week: u16,
            w_day: u16,
            w_hour: u16,
            w_minute: u16,
            w_second: u16,
            w_milliseconds: u16,
        }
        extern "system" {
            fn GetLocalTime(lpSystemTime: *mut SystemTime);
        }
        unsafe {
            let mut st = MaybeUninit::<SystemTime>::uninit();
            GetLocalTime(st.as_mut_ptr());
            return (*st.as_mut_ptr()).w_hour as u32;
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        ((now / 3600) % 24) as u32
    }
}
