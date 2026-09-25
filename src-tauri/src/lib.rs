// The native half of Glyph. The webview owns everything a person sees; this
// crate owns what has to outlive it or reach past it: the notes store, the
// Taptic Engine, and (later) the voice capture that runs without the webview.

// The notes themselves. `pub`, and free of Tauri types, so a caller with no
// Tauri in its process could reach it over JNI - DESIGN 6.1's capture service,
// which did not ship in that form (capture runs in the page; DESIGN 13). The
// first such caller that DID ship is the update-alert worker, for `ota`, below.
// See store.rs's header.
pub mod store;
/// The notes as a folder of Markdown files, and the index over them (docs/LIBRARY.md).
pub mod library;

// The webview's door to the store - four commands and no logic of its own.
mod commands;

// On-device transcription. `pub` and Tauri-free for the same reason as `store`,
// though today only the capture commands drive it. See whisper/mod.rs's header.
pub mod whisper;

// The webview's door to live dictation: the model download, a capture's
// start/push/stop, and the events that carry text back. See its header for the
// two ordering rules the page has to keep.
mod capture_commands;

// Formatting on the phone: llama.cpp, a verified model download, and a
// streamed rewrite. Tauri-free like `whisper`; see llm/mod.rs's header.
pub mod llm;

// The webview's door to the formatting model: the catalogue, a download, a
// run, a cancel, and the progress events. See its header.
mod ai_commands;
mod notion;
mod link_preview;

// Pictures in notes: `save_image` adopts one the Android shell picked, the
// `img` scheme draws it, and a deleted note takes its pictures with it. See its
// header for why every name is checked before it touches a path.
mod images;

// Starting over, from developer settings: notes, recordings, pictures, and on
// request the models. See its header.
mod reset;

// Over-the-air updates: the `ota` scheme that serves a downloaded frontend, the
// boot wager that rolls a bad one back, and the APK download for native
// changes. See its header, and index.html for the loader that drives it.
mod ota;

// Update alerts: the JNI door a WorkManager job walks through with the app
// closed - the first code in Glyph that runs with no Tauri in the process.
#[cfg(target_os = "android")]
mod update_alerts;

/// Makes the app's window the key window once the scene has attached it.
///
/// Under the scene lifecycle (UIApplicationSupportsMultipleScenes, which iOS
/// 26+ forces on this app), tao attaches its window to the scene but nothing
/// ever calls `makeKeyAndVisible` - and a window that is not KEY cannot host a
/// first responder. The visible symptom is exactly Apple's QA1813: taps land
/// (buttons work, focus rings draw) but the keyboard never rises, because the
/// text field's becomeFirstResponder is silently refused. For a notes app that
/// is the whole app not working. Asserted twice on a delay because the scene
/// connect that creates the window races setup, and re-asserting on an
/// already-key window is a no-op.
#[cfg(target_os = "ios")]
fn ensure_key_window(handle: &tauri::AppHandle) {
    let handle = handle.clone();
    std::thread::spawn(move || {
        for delay_ms in [600u64, 2200] {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            let _ = handle.run_on_main_thread(|| unsafe {
                use objc2::msg_send;
                use objc2::runtime::{AnyClass, AnyObject};
                let Some(app_class) = AnyClass::get(c"UIApplication") else {
                    return;
                };
                let shared: *mut AnyObject = msg_send![app_class, sharedApplication];
                if shared.is_null() {
                    return;
                }
                let key: *mut AnyObject = msg_send![shared, keyWindow];
                if !key.is_null() {
                    return;
                }
                let windows: *mut AnyObject = msg_send![shared, windows];
                if windows.is_null() {
                    return;
                }
                let first: *mut AnyObject = msg_send![windows, firstObject];
                if first.is_null() {
                    return;
                }
                let () = msg_send![first, makeKeyAndVisible];
            });
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // The Taptic Engine: the web layer's HapticsProvider fires through
        // this on the phone instead of the (WKWebView-less) web fallbacks.
        .plugin(tauri_plugin_haptics::init())
        // Registered on the builder, not in setup: a scheme has to exist before
        // the webview is created, and the webview is created before setup runs.
        .register_uri_scheme_protocol(ota::SCHEME, |ctx, request| ota::serve(ctx.app_handle(), &request))
        // A spoken note's kept recording, for its tape to play.
        .register_uri_scheme_protocol(capture_commands::RECORDINGS_SCHEME, |ctx, request| {
            capture_commands::serve_recording(ctx.app_handle(), &request)
        })
        // A picture in a note, `![](image/<name>)`, for the editor to draw.
        .register_uri_scheme_protocol(images::SCHEME, |ctx, request| images::serve(ctx.app_handle(), &request));

    // decorum positions the native macOS traffic lights. There are none to
    // position on a phone, and the plugin is not built for those targets.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_decorum::init());

    builder
        .setup(|app| {
            // Before anything else a person can touch: the list screen asks
            // for notes on its first paint, and a command answering "no
            // managed state" reads to the page as an empty library.
            commands::install(app)?;
            // No I/O and cannot fail: the model is looked for when the Record
            // screen asks, not at launch.
            capture_commands::install(app);
            // Nothing loaded until a note asks to be formatted.
            ai_commands::install(app);
            // Before the page loads: the loader's first IPC call is the claim.
            ota::install(app);

            #[cfg(target_os = "ios")]
            ensure_key_window(&app.handle());

            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                use tauri_plugin_decorum::WebviewWindowExt;
                // Center the native traffic lights in the taller custom title
                // bar; macOS re-lays them out on resize, so re-apply then.
                if let Some(main) = app.get_webview_window("main") {
                    const INSET: (f32, f32) = (16.0, 30.0);
                    let _ = main.set_traffic_lights_inset(INSET.0, INSET.1);
                    let win = main.clone();
                    main.on_window_event(move |event| {
                        if matches!(event, tauri::WindowEvent::Resized(_)) {
                            let _ = win.set_traffic_lights_inset(INSET.0, INSET.1);
                        }
                    });
                }
            }
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_notes,
            commands::get_note,
            commands::create_note,
            commands::update_note,
            commands::apply_command_mutation,
            commands::undo_command_mutation,
            commands::latest_command_mutation,
            commands::delete_note,
            commands::set_note_starred,
            commands::set_note_archived,
            commands::set_note_recording,
            commands::set_note_formatted,
            commands::store_apply,
            commands::sync_put_file,
            link_preview::link_preview,
            images::save_image,
            images::save_image_data,
            capture_commands::capture_model_status,
            capture_commands::capture_fetch_model,
            capture_commands::capture_refine_model_status,
            capture_commands::capture_fetch_refine_model,
            capture_commands::capture_refine,
            capture_commands::capture_start,
            capture_commands::capture_push,
            capture_commands::capture_stop,
            capture_commands::capture_reassign_recording,
            capture_commands::capture_discard_recording,
            capture_commands::capture_cancel,
            capture_commands::capture_rewind,
            capture_commands::transcribe_wav,
            ai_commands::ai_device,
            notion::notion_save_account,
            notion::notion_account,
            notion::notion_disconnect,
            notion::notion_request,
            ai_commands::ai_models,
            ai_commands::ai_fetch_model,
            ai_commands::ai_delete_model,
            ai_commands::ai_generate,
            ai_commands::ai_infer_command,
            ai_commands::ai_voice_step,
            ai_commands::ai_cancel,
            reset::reset_local_data,
            ota::ota_claim_boot,
            ota::ota_boot_ok,
            ota::ota_boot_failed,
            ota::ota_status,
            ota::ota_check,
            ota::ota_revert,
            ota::ota_fetch_apk,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // `build` + `run` rather than `run` alone for one event: a capture
        // still decoding when the app quits is cancelled and joined before
        // whisper.cpp's static destructors run. See capture_commands::shutdown.
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                capture_commands::shutdown(app);
                ai_commands::shutdown(app);
            }
        });
}
