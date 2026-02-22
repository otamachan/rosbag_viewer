use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Multipart, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::bag_service::{BagInfo, BagService, TopicTimeline};

/// Tracks uploaded temp files for cleanup on shutdown.
#[derive(Default)]
pub struct TempTracker {
    paths: Mutex<HashSet<PathBuf>>,
}

impl TempTracker {
    pub fn add(&self, path: PathBuf) {
        self.paths.lock().unwrap().insert(path);
    }

    pub fn cleanup(&self) {
        let paths = self.paths.lock().unwrap();
        for path in paths.iter() {
            if let Err(e) = std::fs::remove_file(path) {
                log::warn!("Failed to remove temp file {}: {}", path.display(), e);
            } else {
                log::info!("Removed temp file: {}", path.display());
            }
        }
    }
}

pub struct SharedState {
    pub bag_service: BagService,
    pub temp_tracker: TempTracker,
}

pub type AppState = Arc<SharedState>;

pub async fn get_cwd() -> Result<Json<CwdResponse>, (StatusCode, String)> {
    let cwd =
        std::env::current_dir().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(CwdResponse {
        path: cwd.to_string_lossy().to_string(),
    }))
}

#[derive(Serialize)]
pub struct CwdResponse {
    path: String,
}

#[derive(Deserialize)]
pub struct FilesQuery {
    dir: Option<String>,
}

#[derive(Serialize)]
pub struct FileEntry {
    path: String,
    name: String,
    size: u64,
    modified: String,
    kind: String, // "file" or "directory"
}

#[derive(Serialize)]
pub struct FilesResponse {
    files: Vec<FileEntry>,
}

pub async fn get_files(
    Query(q): Query<FilesQuery>,
) -> Result<Json<FilesResponse>, (StatusCode, String)> {
    let dir = q.dir.unwrap_or_else(|| ".".to_string());
    let path = std::path::Path::new(&dir);

    if !path.is_dir() {
        return Err((StatusCode::BAD_REQUEST, format!("Not a directory: {}", dir)));
    }

    let mut files = Vec::new();

    let entries =
        std::fs::read_dir(path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    for entry in entries {
        let entry = entry.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let file_path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if name.starts_with('.') {
            continue;
        }

        if metadata.is_dir() {
            files.push(FileEntry {
                path: file_path.to_string_lossy().to_string(),
                name,
                size: 0,
                modified: String::new(),
                kind: "directory".to_string(),
            });
        } else if file_path.extension().is_some_and(|ext| ext == "bag") {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| {
                    let duration = t.duration_since(std::time::UNIX_EPOCH).ok()?;
                    Some(format_timestamp(duration.as_secs()))
                })
                .unwrap_or_default();

            files.push(FileEntry {
                path: file_path.to_string_lossy().to_string(),
                name,
                size: metadata.len(),
                modified,
                kind: "file".to_string(),
            });
        }
    }

    files.sort_by(|a, b| match (a.kind.as_str(), b.kind.as_str()) {
        ("directory", "file") => std::cmp::Ordering::Less,
        ("file", "directory") => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(Json(FilesResponse { files }))
}

#[derive(Deserialize)]
pub struct BagInfoQuery {
    path: String,
}

pub async fn get_bag_info(
    State(state): State<AppState>,
    Query(q): Query<BagInfoQuery>,
) -> Result<Json<BagInfo>, (StatusCode, String)> {
    let info = state
        .bag_service
        .get_info(&q.path)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(info))
}

pub async fn get_bag_timeline(
    State(state): State<AppState>,
    Query(q): Query<BagInfoQuery>,
) -> Result<Json<TopicTimeline>, (StatusCode, String)> {
    let timeline = state
        .bag_service
        .get_timeline(&q.path)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(timeline))
}

#[derive(Deserialize)]
pub struct MessagesQuery {
    path: String,
    topics: Option<String>, // comma-separated topic IDs (e.g. "0,1,3")
    start: Option<f64>,     // offset from bag start in seconds
    end: Option<f64>,       // offset from bag start in seconds
}

pub async fn get_bag_messages(
    State(state): State<AppState>,
    Query(q): Query<MessagesQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let topic_ids: Option<Vec<u16>> = q
        .topics
        .map(|t| t.split(',').filter_map(|s| s.trim().parse().ok()).collect());

    let data = state
        .bag_service
        .get_messages(&q.path, topic_ids.as_deref(), q.start, q.end)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], data))
}

#[derive(Serialize)]
pub struct UploadResponse {
    uploaded: Vec<UploadedFile>,
}

#[derive(Serialize)]
pub struct UploadedFile {
    original_name: String,
    path: String,
    size: u64,
}

pub async fn upload_bag(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, (StatusCode, String)> {
    let mut uploaded = Vec::new();
    let temp_dir = std::env::temp_dir();

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Multipart error: {e}")))?
    {
        let filename = field
            .file_name()
            .ok_or((StatusCode::BAD_REQUEST, "Missing filename".to_string()))?
            .to_string();

        if !filename.ends_with(".bag") {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Only .bag files are accepted: {filename}"),
            ));
        }

        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let dest = temp_dir.join(format!("{millis}_{filename}"));

        let mut file = tokio::fs::File::create(&dest)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let mut size: u64 = 0;
        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        {
            size += chunk.len() as u64;
            file.write_all(&chunk)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        file.flush()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        state.temp_tracker.add(dest.clone());
        uploaded.push(UploadedFile {
            original_name: filename,
            path: dest.to_string_lossy().to_string(),
            size,
        });
    }

    if uploaded.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "No file uploaded".to_string()));
    }

    Ok(Json(UploadResponse { uploaded }))
}

fn format_timestamp(secs: u64) -> String {
    chrono::DateTime::from_timestamp(secs as i64, 0)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_default()
}
