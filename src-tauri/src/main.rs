#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures_util::{SinkExt, StreamExt};
use std::{
    collections::HashMap,
    net::SocketAddr,
    process::Command,
    str::FromStr,
    sync::Mutex,
    thread,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};
use tokio::{
    net::{TcpListener, TcpStream},
    runtime::Runtime,
    sync::broadcast,
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

const BRIDGE_ADDR: &str = "127.0.0.1:4173";

#[derive(Default)]
struct ShortcutRegistry {
    shortcuts: Mutex<HashMap<String, String>>,
}

fn main() {
    start_bridge_server();

    tauri::Builder::default()
        .manage(ShortcutRegistry::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }

                    let key = shortcut.to_string();
                    let original = app
                        .state::<ShortcutRegistry>()
                        .shortcuts
                        .lock()
                        .ok()
                        .and_then(|shortcuts| shortcuts.get(&key).cloned())
                        .unwrap_or(key);
                    let _ = app.emit("global-shortcut", original);
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            open_external_url,
            update_global_shortcuts
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Auto Input");
}

#[tauri::command]
fn update_global_shortcuts(
    app: tauri::AppHandle,
    registry: State<'_, ShortcutRegistry>,
    shortcuts: Vec<String>,
) -> Result<(), String> {
    let manager = app.global_shortcut();
    manager.unregister_all().map_err(|error| error.to_string())?;

    let mut next_shortcuts = HashMap::new();
    for shortcut_text in shortcuts {
        let shortcut = parse_shortcut(&shortcut_text)?;
        manager
            .register(shortcut)
            .map_err(|error| format!("{shortcut_text}: {error}"))?;
        next_shortcuts.insert(shortcut.to_string(), shortcut_text);
    }

    *registry
        .shortcuts
        .lock()
        .map_err(|_| "failed to update shortcut registry".to_string())? = next_shortcuts;
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("External URL is not allowed".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
}

fn is_allowed_external_url(url: &str) -> bool {
    url.starts_with("https://auto-web-8f2de.web.app/desktop-login.html?session=")
        || url.starts_with("https://auto-web-8f2de.web.app/checkout?")
        || url == "https://auto-web-8f2de.web.app/payment-success.html"
        || url == "https://auto-web-8f2de.web.app/payment-fail.html"
}

fn parse_shortcut(value: &str) -> Result<Shortcut, String> {
    let mut modifiers = Modifiers::empty();
    let mut key: Option<Code> = None;

    for part in value.split('+').map(str::trim).filter(|part| !part.is_empty()) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "alt" | "option" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            "meta" | "super" | "cmd" | "command" => modifiers |= Modifiers::SUPER,
            other => {
                key = Some(parse_shortcut_key(other)?);
            }
        }
    }

    let key = key.ok_or_else(|| format!("shortcut key is missing: {value}"))?;
    Ok(Shortcut::new(Some(modifiers), key))
}

fn parse_shortcut_key(value: &str) -> Result<Code, String> {
    if let Some(number) = value.strip_prefix('f') {
        if let Ok(index) = number.parse::<u8>() {
            return match index {
                1 => Ok(Code::F1),
                2 => Ok(Code::F2),
                3 => Ok(Code::F3),
                4 => Ok(Code::F4),
                5 => Ok(Code::F5),
                6 => Ok(Code::F6),
                7 => Ok(Code::F7),
                8 => Ok(Code::F8),
                9 => Ok(Code::F9),
                10 => Ok(Code::F10),
                11 => Ok(Code::F11),
                12 => Ok(Code::F12),
                _ => Err(format!("unsupported function key: F{index}")),
            };
        }
    }

    match value {
        "0" => Ok(Code::Digit0),
        "1" => Ok(Code::Digit1),
        "2" => Ok(Code::Digit2),
        "3" => Ok(Code::Digit3),
        "4" => Ok(Code::Digit4),
        "5" => Ok(Code::Digit5),
        "6" => Ok(Code::Digit6),
        "7" => Ok(Code::Digit7),
        "8" => Ok(Code::Digit8),
        "9" => Ok(Code::Digit9),
        "a" => Ok(Code::KeyA),
        "b" => Ok(Code::KeyB),
        "c" => Ok(Code::KeyC),
        "d" => Ok(Code::KeyD),
        "e" => Ok(Code::KeyE),
        "f" => Ok(Code::KeyF),
        "g" => Ok(Code::KeyG),
        "h" => Ok(Code::KeyH),
        "i" => Ok(Code::KeyI),
        "j" => Ok(Code::KeyJ),
        "k" => Ok(Code::KeyK),
        "l" => Ok(Code::KeyL),
        "m" => Ok(Code::KeyM),
        "n" => Ok(Code::KeyN),
        "o" => Ok(Code::KeyO),
        "p" => Ok(Code::KeyP),
        "q" => Ok(Code::KeyQ),
        "r" => Ok(Code::KeyR),
        "s" => Ok(Code::KeyS),
        "t" => Ok(Code::KeyT),
        "u" => Ok(Code::KeyU),
        "v" => Ok(Code::KeyV),
        "w" => Ok(Code::KeyW),
        "x" => Ok(Code::KeyX),
        "y" => Ok(Code::KeyY),
        "z" => Ok(Code::KeyZ),
        "escape" => Ok(Code::Escape),
        "enter" => Ok(Code::Enter),
        "space" => Ok(Code::Space),
        "tab" => Ok(Code::Tab),
        "backspace" => Ok(Code::Backspace),
        "delete" => Ok(Code::Delete),
        "insert" => Ok(Code::Insert),
        "home" => Ok(Code::Home),
        "end" => Ok(Code::End),
        "pageup" => Ok(Code::PageUp),
        "pagedown" => Ok(Code::PageDown),
        "arrowup" | "up" => Ok(Code::ArrowUp),
        "arrowdown" | "down" => Ok(Code::ArrowDown),
        "arrowleft" | "left" => Ok(Code::ArrowLeft),
        "arrowright" | "right" => Ok(Code::ArrowRight),
        _ => Code::from_str(value).map_err(|_| format!("unsupported shortcut key: {value}")),
    }
}

fn start_bridge_server() {
    thread::spawn(|| {
        let runtime = Runtime::new().expect("failed to create bridge runtime");
        runtime.block_on(async {
            if let Err(error) = run_bridge_server().await {
                eprintln!("Auto Input bridge disabled: {error}");
            }
        });
    });
}

async fn run_bridge_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind(BRIDGE_ADDR).await?;
    let (tx, _) = broadcast::channel::<String>(256);

    loop {
        let (stream, addr) = listener.accept().await?;
        let tx = tx.clone();
        let rx = tx.subscribe();

        tokio::spawn(async move {
            if let Err(error) = handle_connection(stream, addr, tx, rx).await {
                eprintln!("Bridge client disconnected: {error}");
            }
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    _addr: SocketAddr,
    tx: broadcast::Sender<String>,
    mut rx: broadcast::Receiver<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let websocket = accept_async(stream).await?;
    let (mut writer, mut reader) = websocket.split();

    writer
        .send(Message::Text(
            serde_json::json!({
                "type": "bridge-ready",
                "source": "tauri"
            })
            .to_string(),
        ))
        .await?;

    loop {
        tokio::select! {
            inbound = reader.next() => {
                match inbound {
                    Some(Ok(Message::Text(text))) => {
                        let _ = tx.send(text);
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(Box::new(error)),
                }
            }
            outbound = rx.recv() => {
                match outbound {
                    Ok(text) => writer.send(Message::Text(text)).await?,
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    Ok(())
}
