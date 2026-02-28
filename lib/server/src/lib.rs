pub mod api;
pub mod app;
pub mod bag_service;
pub mod frame;
pub mod msg_parser;
pub mod schema;

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;

/// Create the shared application state.
pub fn create_state() -> api::AppState {
    Arc::new(api::SharedState {
        bag_service: bag_service::BagService::new(16),
        temp_tracker: Default::default(),
    })
}

/// Build the API router (without static file serving).
/// The caller can merge this with their own static asset serving.
pub fn build_api_router(state: api::AppState) -> Router {
    let upload_route = Router::new()
        .route("/api/bag/upload", post(api::upload_bag))
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024 * 1024)); // 10 GB

    Router::new()
        .merge(upload_route)
        .route("/api/cwd", get(api::get_cwd))
        .route("/api/files", get(api::get_files))
        .route("/api/bag/info", get(api::get_bag_info))
        .route("/api/bag/messages", get(api::get_bag_messages))
        .route("/api/bag/timeline", get(api::get_bag_timeline))
        .with_state(state)
        .layer(CorsLayer::permissive())
}

/// Run the server on the given address.
pub async fn run_server(addr: &str, state: api::AppState, app: Router) {
    log::info!("rosbag-viewer starting at http://{}", addr);

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("Failed to bind {}: {}", addr, e);
            std::process::exit(1);
        }
    };

    let shutdown_state = state.clone();
    let server = axum::serve(listener, app).with_graceful_shutdown(async move {
        tokio::signal::ctrl_c().await.ok();
        log::info!("Shutting down, cleaning up temp files...");
        shutdown_state.temp_tracker.cleanup();
    });

    if let Err(e) = server.await {
        log::error!("Server error: {}", e);
        state.temp_tracker.cleanup();
        std::process::exit(1);
    }
}
