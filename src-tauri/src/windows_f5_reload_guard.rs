const VK_F5: u32 = 0x74;
const KEY_EVENT_KIND_KEY_DOWN: i32 = 0;
const KEY_EVENT_KIND_SYSTEM_KEY_DOWN: i32 = 2;

pub(crate) fn is_windows_f5_reload_key(virtual_key: u32, key_event_kind: i32) -> bool {
    virtual_key == VK_F5
        && (key_event_kind == KEY_EVENT_KIND_KEY_DOWN
            || key_event_kind == KEY_EVENT_KIND_SYSTEM_KEY_DOWN)
}

/// WebView2 handles F5 before page JavaScript. Attach only to the product main
/// window; failure is diagnostic-only so this guard can never become a startup
/// gate. Semantic port of upstream `add5ba06c`.
#[cfg(target_os = "windows")]
pub(crate) fn install_on_main_window(window: &tauri::WebviewWindow) {
    if let Err(error) = window.with_webview(|platform| {
        if let Err(error) = install_accelerator_guard(platform.controller()) {
            log::warn!("failed to install Windows F5 reload guard: {error}");
        }
    }) {
        log::warn!("failed to access Windows webview for F5 reload guard: {error}");
    }
}

#[cfg(target_os = "windows")]
fn install_accelerator_guard(
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) -> Result<(), String> {
    use webview2_com::{
        AcceleratorKeyPressedEventHandler,
        Microsoft::Web::WebView2::Win32::COREWEBVIEW2_KEY_EVENT_KIND,
    };

    let mut token = 0i64;
    unsafe {
        controller
            .add_AcceleratorKeyPressed(
                &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                    let mut virtual_key = 0u32;
                    args.KeyEventKind(&mut kind)?;
                    args.VirtualKey(&mut virtual_key)?;
                    if is_windows_f5_reload_key(virtual_key, kind.0) {
                        args.SetHandled(true)?;
                    }
                    Ok(())
                })),
                &mut token,
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_only_f5_keydown_variants() {
        assert!(is_windows_f5_reload_key(VK_F5, KEY_EVENT_KIND_KEY_DOWN));
        assert!(is_windows_f5_reload_key(
            VK_F5,
            KEY_EVENT_KIND_SYSTEM_KEY_DOWN
        ));
        assert!(!is_windows_f5_reload_key(VK_F5, 1));
        assert!(!is_windows_f5_reload_key(0x52, KEY_EVENT_KIND_KEY_DOWN));
    }
}
