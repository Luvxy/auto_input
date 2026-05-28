use futures_util::{SinkExt, StreamExt};
use std::{net::SocketAddr, process::Command, thread};
use tokio::{
    net::{TcpListener, TcpStream},
    runtime::Runtime,
    sync::broadcast,
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

const BRIDGE_ADDR: &str = "127.0.0.1:4173";

fn main() {
    start_bridge_server();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_external_url])
        .run(tauri::generate_context!())
        .expect("failed to run Auto Input");
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
