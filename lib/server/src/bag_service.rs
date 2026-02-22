use std::collections::{HashMap, HashSet};
use std::num::NonZeroUsize;
use std::path::Path;
use std::sync::{Arc, Mutex};

use lru::LruCache;
use rosbag::{ChunkRecord, MessageRecord, RosBag};
use serde::Serialize;

use crate::frame;
use crate::msg_parser::parse_msg_definition;
use crate::schema::MsgSchema;

/// Bag metadata returned by GET /api/bag/info.
#[derive(Debug, Clone, Serialize)]
pub struct BagInfo {
    pub path: String,
    pub duration: f64,
    pub start_time: f64,
    pub end_time: f64,
    pub message_count: u32,
    pub topics: Vec<TopicInfo>,
    pub schemas: HashMap<String, Vec<MsgSchema>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopicInfo {
    pub id: u16,
    pub name: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub message_count: u32,
    pub frequency: f64,
}

/// Per-topic timestamps for timeline visualization.
#[derive(Debug, Clone, Serialize)]
pub struct TopicTimeline {
    pub duration: f64,
    pub topics: Vec<TopicTimelineEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopicTimelineEntry {
    pub id: u16,
    pub name: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub times: Vec<f32>,
}

struct CachedBag {
    info: BagInfo,
    start_time_ns: u64,
    /// Message index sorted by timestamp (ascending).
    indices: Vec<MessageIndex>,
    /// Decompressed chunk data. Each entry is one bag chunk's concatenated message bytes.
    chunks: Vec<Vec<u8>>,
}

#[derive(Debug)]
struct MessageIndex {
    time_ns: u64,
    topic_id: u16,
    chunk_idx: usize,
    offset: usize,
    len: usize,
}

pub struct BagService {
    cache: Mutex<LruCache<String, Arc<CachedBag>>>,
}

impl BagService {
    pub fn new(capacity: usize) -> Self {
        Self {
            cache: Mutex::new(LruCache::new(NonZeroUsize::new(capacity).unwrap())),
        }
    }

    fn get_cached(&self, path: &str) -> Result<Arc<CachedBag>, String> {
        {
            let mut cache = self.cache.lock().unwrap();
            if let Some(cached) = cache.get(path) {
                return Ok(Arc::clone(cached));
            }
        }

        let cached = Arc::new(scan_bag(path)?);

        {
            let mut cache = self.cache.lock().unwrap();
            cache.put(path.to_string(), Arc::clone(&cached));
        }

        Ok(cached)
    }

    pub fn get_info(&self, path: &str) -> Result<BagInfo, String> {
        Ok(self.get_cached(path)?.info.clone())
    }

    /// Return per-topic timestamp offsets (seconds from bag start).
    pub fn get_timeline(&self, path: &str) -> Result<TopicTimeline, String> {
        let cached = self.get_cached(path)?;
        let mut topic_times: HashMap<u16, Vec<f32>> = HashMap::new();
        for idx in &cached.indices {
            let offset = (idx.time_ns - cached.start_time_ns) as f64 / 1e9;
            topic_times
                .entry(idx.topic_id)
                .or_default()
                .push(offset as f32);
        }
        let topics = cached
            .info
            .topics
            .iter()
            .map(|t| {
                let times = topic_times.remove(&t.id).unwrap_or_default();
                TopicTimelineEntry {
                    id: t.id,
                    name: t.name.clone(),
                    msg_type: t.msg_type.clone(),
                    times,
                }
            })
            .collect();
        Ok(TopicTimeline {
            duration: cached.info.duration,
            topics,
        })
    }

    /// Build binary frame data for the requested topics and time range.
    /// `topic_ids`: if None, include all topics.
    /// `start`/`end`: offsets from bag start in seconds. None = from beginning / to end.
    pub fn get_messages(
        &self,
        path: &str,
        topic_ids: Option<&[u16]>,
        start: Option<f64>,
        end: Option<f64>,
    ) -> Result<Vec<u8>, String> {
        let cached = self.get_cached(path)?;

        let start_ns = match start {
            Some(s) => cached.start_time_ns + (s * 1e9) as u64,
            None => 0,
        };
        let end_ns = match end {
            Some(e) => cached.start_time_ns + (e * 1e9) as u64,
            None => u64::MAX,
        };

        let topic_set: Option<HashSet<u16>> = topic_ids.map(|ids| ids.iter().copied().collect());

        // Binary search for time range
        let lo = cached.indices.partition_point(|m| m.time_ns < start_ns);
        let hi = cached.indices.partition_point(|m| m.time_ns <= end_ns);

        let mut buf = Vec::new();
        for idx in &cached.indices[lo..hi] {
            if let Some(ref set) = topic_set {
                if !set.contains(&idx.topic_id) {
                    continue;
                }
            }
            let payload = &cached.chunks[idx.chunk_idx][idx.offset..idx.offset + idx.len];
            frame::write_data_frame(&mut buf, idx.topic_id, idx.time_ns, payload);
        }

        Ok(buf)
    }
}

/// Temporary entry collected during the single-pass scan.
struct RawEntry {
    conn_id: u32,
    time_ns: u64,
    chunk_idx: usize,
    offset: usize,
    len: usize,
}

fn scan_bag(path: &str) -> Result<CachedBag, String> {
    let bag = RosBag::new(Path::new(path)).map_err(|e| format!("Failed to open bag: {}", e))?;

    // conn_id -> (topic, msg_type, message_definition)
    let mut conn_map: HashMap<u32, (String, String, String)> = HashMap::new();
    let mut raw_entries: Vec<RawEntry> = Vec::new();
    let mut chunks: Vec<Vec<u8>> = Vec::new();

    for record in bag.chunk_records() {
        match record {
            Ok(ChunkRecord::Chunk(chunk)) => {
                let mut chunk_bytes: Vec<u8> = Vec::new();
                let mut msg_entries: Vec<(u32, u64, usize, usize)> = Vec::new();

                for msg_record in chunk.messages() {
                    match msg_record {
                        Ok(MessageRecord::Connection(conn)) => {
                            conn_map.entry(conn.id).or_insert_with(|| {
                                (
                                    conn.topic.to_string(),
                                    conn.tp.to_string(),
                                    conn.message_definition.to_string(),
                                )
                            });
                        }
                        Ok(MessageRecord::MessageData(msg_data)) => {
                            let offset = chunk_bytes.len();
                            let data = msg_data.data;
                            chunk_bytes.extend_from_slice(data);
                            msg_entries.push((msg_data.conn_id, msg_data.time, offset, data.len()));
                        }
                        Err(e) => {
                            log::warn!("Error reading message record: {}", e);
                        }
                    }
                }

                let chunk_idx = chunks.len();
                chunks.push(chunk_bytes);

                for (conn_id, time_ns, offset, len) in msg_entries {
                    raw_entries.push(RawEntry {
                        conn_id,
                        time_ns,
                        chunk_idx,
                        offset,
                        len,
                    });
                }
            }
            Ok(ChunkRecord::IndexData(_)) => {}
            Err(e) => {
                log::warn!("Error reading chunk record: {}", e);
            }
        }
    }

    // Build topic -> (msg_type, msg_def) and conn_id -> topic mappings
    let mut topic_type_map: HashMap<String, String> = HashMap::new();
    let mut msg_defs: HashMap<String, String> = HashMap::new();
    let mut conn_to_topic: HashMap<u32, String> = HashMap::new();

    for (&conn_id, (topic, msg_type, msg_def)) in &conn_map {
        topic_type_map
            .entry(topic.clone())
            .or_insert_with(|| msg_type.clone());
        msg_defs
            .entry(msg_type.clone())
            .or_insert_with(|| msg_def.clone());
        conn_to_topic.insert(conn_id, topic.clone());
    }

    // Sort topics alphabetically and assign sequential IDs
    let mut sorted_topics: Vec<(String, String)> = topic_type_map.into_iter().collect();
    sorted_topics.sort_by(|a, b| a.0.cmp(&b.0));

    let topic_to_id: HashMap<&str, u16> = sorted_topics
        .iter()
        .enumerate()
        .map(|(i, (topic, _))| (topic.as_str(), i as u16))
        .collect();

    // Build message index with topic_ids
    let mut indices: Vec<MessageIndex> = Vec::with_capacity(raw_entries.len());
    let mut topic_counts: HashMap<u16, u32> = HashMap::new();

    for entry in &raw_entries {
        if let Some(topic) = conn_to_topic.get(&entry.conn_id) {
            if let Some(&topic_id) = topic_to_id.get(topic.as_str()) {
                indices.push(MessageIndex {
                    time_ns: entry.time_ns,
                    topic_id,
                    chunk_idx: entry.chunk_idx,
                    offset: entry.offset,
                    len: entry.len,
                });
                *topic_counts.entry(topic_id).or_insert(0) += 1;
            }
        }
    }

    indices.sort_by_key(|m| m.time_ns);

    // Compute time range
    let start_time_ns = indices.first().map(|m| m.time_ns).unwrap_or(0);
    let end_time_ns = indices.last().map(|m| m.time_ns).unwrap_or(0);
    let start_time = start_time_ns as f64 / 1e9;
    let end_time = end_time_ns as f64 / 1e9;
    let duration = end_time - start_time;

    // Build TopicInfo list
    let topics: Vec<TopicInfo> = sorted_topics
        .iter()
        .enumerate()
        .map(|(id, (name, msg_type))| {
            let count = *topic_counts.get(&(id as u16)).unwrap_or(&0);
            let frequency = if duration > 0.0 {
                (count as f64 / duration * 10.0).round() / 10.0
            } else {
                0.0
            };
            TopicInfo {
                id: id as u16,
                name: name.clone(),
                msg_type: msg_type.clone(),
                message_count: count,
                frequency,
            }
        })
        .collect();

    // Parse schemas
    let mut schemas: HashMap<String, Vec<MsgSchema>> = HashMap::new();
    for (msg_type, definition) in &msg_defs {
        schemas.insert(msg_type.clone(), parse_msg_definition(definition));
    }

    let info = BagInfo {
        path: path.to_string(),
        duration,
        start_time,
        end_time,
        message_count: indices.len() as u32,
        topics,
        schemas,
    };

    Ok(CachedBag {
        info,
        start_time_ns,
        indices,
        chunks,
    })
}
