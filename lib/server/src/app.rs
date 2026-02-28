use axum::extract::Path;
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use rust_embed::Embed;

use crate::{build_api_router, create_state, run_server};

/// Parsed CLI arguments.
pub struct CliArgs {
    pub host: String,
    pub port: String,
    pub no_browser: bool,
}

/// Parse CLI arguments. Returns `None` if `--help` was requested (already printed).
pub fn parse_args(name: &str, args: &[String]) -> Option<CliArgs> {
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
                println!("{name}");
                println!();
                println!("USAGE:");
                println!("    {name} [OPTIONS]");
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

async fn serve_index<T: Embed + 'static>() -> impl IntoResponse {
    match T::get("index.html") {
        Some(content) => Html(
            std::str::from_utf8(content.data.as_ref())
                .unwrap_or("")
                .to_string(),
        )
        .into_response(),
        None => (StatusCode::NOT_FOUND, "index.html not found").into_response(),
    }
}

async fn serve_static<T: Embed + 'static>(Path(path): Path<String>) -> impl IntoResponse {
    match T::get(&path) {
        Some(content) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            (
                [(header::CONTENT_TYPE, mime.as_ref().to_string())],
                content.data.to_vec(),
            )
                .into_response()
        }
        None => serve_index::<T>().await.into_response(),
    }
}

/// Build the full app router: API routes + embedded frontend assets.
pub fn build_full_router<T: Embed + 'static>(api: axum::Router) -> axum::Router {
    api.route("/", get(serve_index::<T>))
        .route("/{*path}", get(serve_static::<T>))
}

/// Run the viewer application.
///
/// Initialises logging, parses CLI arguments, starts the HTTP server,
/// and optionally opens a browser.  This is the standard entry-point
/// shared by all downstream binaries — the caller only needs to
/// supply the `#[derive(Embed)]` asset type and the binary name.
pub fn run<T: Embed + 'static>(name: &str) {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args: Vec<String> = std::env::args().collect();
    let cli = match parse_args(name, &args) {
        Some(c) => c,
        None => return, // --help was printed
    };

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to create tokio runtime");

    rt.block_on(async {
        let state = create_state();
        let api = build_api_router(state.clone());
        let app = build_full_router::<T>(api);

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
    });
}
