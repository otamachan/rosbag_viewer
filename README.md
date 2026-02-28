# rosbag-viewer

[![CI](https://github.com/otamachan/rosbag_viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/otamachan/rosbag_viewer/actions/workflows/ci.yml)

A web-based ROS1 bag file viewer built with Rust and React. Browse, visualize, and play back `.bag` files entirely in the browser.

<!-- TODO: demo video / screenshot -->

## Features

- **File Browser** -- Navigate and select `.bag` files on the server, or drag & drop to upload
- **Timeline** -- Per-topic message density bars with playback controls, drag-to-select loop range, and zoom/pan
- **3D Viewer** -- Visualize Pose, PoseArray, Path, Odometry, PointCloud2, LaserScan, OccupancyGrid, and TF transforms in a Three.js scene
- **Image Panel** -- Display `sensor_msgs/Image` and `sensor_msgs/CompressedImage` topics
- **Data Inspector** -- JSON tree view for raw message inspection
- **Multi-bag Support** -- Load multiple bag files simultaneously with merged timelines
- **Display Profiles** -- Save and switch between sets of topic visibility / display settings
- **Plugin System** -- Register custom visualization plugins for application-specific message types

## Architecture

```
 Browser                          Server
+------------------------------+  +---------------------------+
|  React + Three.js SPA        |  |  Rust (axum) HTTP server  |
|                               |  |                           |
|  TopicTimeline  ThreeViewer   |  |  /api/bag/info            |
|  ImagePanel     JsonTree      |  |  /api/bag/timeline        |
|  Sidebar        ProfileMgr   |  |  /api/bag/messages (bin)  |
|                               |  |  /api/files               |
|  PluginRegistry               |  |  /api/bag/upload          |
|  MessageBuffer  RosDecoder    |  |                           |
+------------------------------+  |  BagService (rosbag crate) |
        |    REST / binary         |  LRU cache                 |
        +------------------------->+---------------------------+
```

The backend reads `.bag` files using the [`rosbag`](https://crates.io/crates/rosbag) crate and serves message data as compact binary frames over HTTP. The frontend decodes ROS messages client-side, enabling real-time playback and 3D rendering without server-side decompression overhead.

See [API.md](API.md) for the full REST API specification.

## Project Structure

```
lib/
  server/         Rust library crate -- bag parsing, REST API handlers
  frontend/       React component library -- panels, plugins, timeline, decoder
app/
  server/         Binary crate -- embeds frontend assets, launches browser
  frontend/       Vite application -- wires lib components into a full app
```

- **lib/** -- Reusable libraries. Can be imported by other projects as dependencies.
- **app/** -- Standalone application that wires everything together.

## Getting Started

### Prerequisites

- Rust 1.70+
- Node.js 18+

### Build & Run

```bash
# Install frontend dependencies and build
cd app/frontend
npm install
npm run build

# Build and run server (from project root)
cd ../..
cargo run --release -p rosbag-viewer-app
```

The server starts at `http://localhost:8080` and opens the browser automatically.

### Development

```bash
# Terminal 1: Start frontend dev server (with HMR + proxy to backend)
cd app/frontend
npm run dev

# Terminal 2: Start backend
cargo run -p rosbag-viewer-app -- --no-browser
```

### CLI Options

```
rosbag-viewer-app [OPTIONS]

OPTIONS:
    -H, --host <HOST>    Bind address (default: 0.0.0.0)
    -p, --port <PORT>    Listen port (default: 8080)
        --no-browser     Don't open browser automatically
    -h, --help           Show help
```

### Lint & Type Check

```bash
# Rust
cargo clippy --workspace
cargo check -p rosbag-viewer

# Frontend library
cd lib/frontend && npm run check && npm run lint

# Frontend app
cd app/frontend && npm run lint
```

## License

Apache-2.0
