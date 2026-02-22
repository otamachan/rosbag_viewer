use axum::extract::Path;
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use rust_embed::Embed;

use rosbag_viewer::{build_api_router, create_state, run_server};

#[derive(Embed)]
#[folder = "../../app/frontend/dist"]
struct Asset;

/// Parsed CLI arguments.
struct CliArgs {
    host: String,
    port: String,
    no_browser: bool,
}

/// Parse CLI arguments. Returns `None` if `--help` was requested (already printed).
fn parse_args(args: &[String]) -> Option<CliArgs> {
    let mut host = "0.0.0.0".to_string();
    let mut port = "8080".to_string();
    let mut no_browser = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--host" | "-H" => {
                if i + 1 < args.len() {
                    host = args[i + 1].clone();
                    i += 1;
                }
            }
            "--port" | "-p" => {
                if i + 1 < args.len() {
                    port = args[i + 1].clone();
                    i += 1;
                }
            }
            "--no-browser" => {
                no_browser = true;
            }
            "--help" | "-h" => {
                println!("rosbag-viewer-app");
                println!();
                println!("USAGE:");
                println!("    rosbag-viewer-app [OPTIONS]");
                println!();
                println!("OPTIONS:");
                println!("    -H, --host <HOST>  Bind address (default: 0.0.0.0)");
                println!("    -p, --port <PORT>  Listen port (default: 8080)");
                println!("    --no-browser        Don't open browser automatically");
                println!("    -h, --help         Show this help");
                return None;
            }
            _ => {}
        }
        i += 1;
    }

    Some(CliArgs {
        host,
        port,
        no_browser,
    })
}

async fn serve_index() -> impl IntoResponse {
    match Asset::get("index.html") {
        Some(content) => Html(
            std::str::from_utf8(content.data.as_ref())
                .unwrap_or("")
                .to_string(),
        )
        .into_response(),
        None => (StatusCode::NOT_FOUND, "index.html not found").into_response(),
    }
}

async fn serve_static(Path(path): Path<String>) -> impl IntoResponse {
    match Asset::get(&path) {
        Some(content) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            (
                [(header::CONTENT_TYPE, mime.as_ref().to_string())],
                content.data.to_vec(),
            )
                .into_response()
        }
        None => serve_index().await.into_response(),
    }
}

/// Build the full app router with embedded frontend assets.
fn build_app_router(api: axum::Router) -> axum::Router {
    api.route("/", get(serve_index))
        .route("/{*path}", get(serve_static))
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args: Vec<String> = std::env::args().collect();
    let cli = match parse_args(&args) {
        Some(c) => c,
        None => return, // --help was printed
    };

    let state = create_state();
    let api = build_api_router(state.clone());
    let app = build_app_router(api);

    let addr = format!("{}:{}", cli.host, cli.port);

    if !cli.no_browser {
        let browse_host = if cli.host == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &cli.host
        };
        let url = format!("http://{}:{}", browse_host, cli.port);
        if let Err(e) = open::that(&url) {
            log::warn!("Failed to open browser: {}", e);
        }
    }

    run_server(&addr, state, app).await;
}
