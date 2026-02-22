# rosbag-viewer API

Base URL: `http://localhost:8080`

## CLI

```
rosbag-viewer [OPTIONS]

OPTIONS:
    -H, --host <HOST>  Bind address (default: 0.0.0.0)
    -p, --port <PORT>  Listen port (default: 8080)
    --no-browser       Don't open browser automatically
    -h, --help         Show this help
```

## Endpoints

### GET /api/cwd

Returns the server's current working directory.

**Response:**
```json
{ "path": "/home/user/data" }
```

### GET /api/files?dir=/path/to/dir

List `.bag` files and directories. Hidden directories (starting with `.`) are excluded.

**Query params:**
- `dir` (optional) — directory path, defaults to server CWD

**Response:**
```json
{
  "files": [
    { "path": "/data/nav", "name": "nav", "size": 0, "modified": "", "kind": "directory" },
    { "path": "/data/test.bag", "name": "test.bag", "size": 1234567, "modified": "2026-01-14T21:37:36Z", "kind": "file" }
  ]
}
```

### GET /api/bag/info?path=/path/to/file.bag

Get metadata for a bag file. Results are LRU-cached (capacity: 16).

**Response:**
```json
{
  "path": "/path/to/file.bag",
  "duration": 60.0,
  "start_time": 1700000000.0,
  "end_time": 1700000060.0,
  "message_count": 12345,
  "topics": [
    { "id": 0, "name": "/map", "type": "nav_msgs/OccupancyGrid", "message_count": 5, "frequency": 0.1 },
    { "id": 1, "name": "/path", "type": "nav_msgs/Path", "message_count": 300, "frequency": 5.0 }
  ],
  "schemas": {
    "nav_msgs/Path": [
      { "name": "nav_msgs/Path", "fields": [{ "name": "header", "type": "std_msgs/Header", "isArray": false, "isComplex": true }] }
    ]
  }
}
```

### GET /api/bag/timeline?path=/path/to/file.bag

Per-topic timestamp offsets (seconds from bag start) for timeline visualization.

**Response:**
```json
{
  "duration": 60.0,
  "topics": [
    { "id": 0, "name": "/map", "type": "nav_msgs/OccupancyGrid", "times": [0.0, 10.0, 20.0] },
    { "id": 1, "name": "/path", "type": "nav_msgs/Path", "times": [0.1, 0.3, 0.5] }
  ]
}
```

### GET /api/bag/messages?path=...&topics=...&start=...&end=...

Returns raw message data as binary frames (`application/octet-stream`).

**Query params:**
- `path` (required) — bag file path
- `topics` (optional) — comma-separated topic IDs (e.g. `0,1,3`)
- `start` (optional) — offset from bag start in seconds
- `end` (optional) — offset from bag start in seconds

**Binary frame format:**

| Offset | Size | Type    | Description              |
|--------|------|---------|--------------------------|
| 0      | 2    | u16 LE  | topic_id                 |
| 2      | 8    | u64 LE  | timestamp (nanoseconds)  |
| 10     | 4    | u32 LE  | payload_length           |
| 14     | N    | [u8]    | payload                  |

### POST /api/bag/upload

Upload `.bag` files via multipart form data. Files are saved to a temp directory and cleaned up on server shutdown. Max upload size: 10 GB.

**Request:** `multipart/form-data` with field name `file`

**Response:**
```json
{
  "uploaded": [
    { "original_name": "recording.bag", "path": "/tmp/1700000000000_recording.bag", "size": 1234567 }
  ]
}
```
