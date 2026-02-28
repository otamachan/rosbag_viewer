import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface TimelineTopic {
  name: string;
  type: string;
  /** Offset times in seconds from global start. */
  times: number[];
}

interface TopicTimelineProps {
  topics: TimelineTopic[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  selectedTopicName: string | null;
  onSelectTopic: (name: string) => void;
  hiddenTopics: Set<string>;
  onToggleTopicVisibility: (name: string) => void;
  onSetAllTopicsVisible: (visible: boolean) => void;
  // Playback controls
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  /** Unix timestamp (seconds) of global start for local time display */
  startTime: number;
  /** Loop range [start, end] in seconds, or null if no loop range is set */
  loopRange: [number, number] | null;
  onLoopRangeChange: (range: [number, number] | null) => void;
}

const ROW_H = 18;
const RULER_H = 22;
const LABEL_W = 180;
const CHECK_W = 18;
const RIGHT_PAD = 16;
const NUM_BINS = 600;
const MIN_HEIGHT = 60;
const DEFAULT_HEIGHT = 250;
const SPEEDS = [0.1, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0];

function getTopicColor(type: string): string {
  if (type.includes("Image") || type.includes("CompressedImage")) return "#5cb85c";
  if (type.includes("Pose") || type.includes("Path") || type.includes("Odometry") || type.includes("Transform"))
    return "#2878c5";
  if (type.includes("PointCloud") || type.includes("LaserScan")) return "#9b79b9";
  if (type.includes("sensor_msgs") || type.includes("Imu")) return "#d9a44e";
  return "#888888";
}

/** Cached density bins for a single topic within the current view. */
interface TopicBins {
  bins: Uint16Array;
  maxBin: number;
}

export function TopicTimeline({
  topics,
  duration,
  currentTime,
  onSeek,
  selectedTopicName,
  onSelectTopic,
  hiddenTopics,
  onToggleTopicVisibility,
  onSetAllTopicsVisible,
  isPlaying,
  onPlay,
  onPause,
  speed,
  onSpeedChange,
  startTime,
  loopRange,
  onLoopRangeChange,
}: TopicTimelineProps) {
  // Static layer: topic rows, density bars, ruler
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  // Dynamic layer: playback head (overlaid on static)
  const dynamicCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Resizable height
  const [height, setHeight] = useState(DEFAULT_HEIGHT);

  // Zoom: 1.0 = fit all, >1 = zoomed in
  const [zoom, setZoom] = useState(1.0);
  // Scroll offset (0..1 range of how far scrolled)
  const [scrollX, setScrollX] = useState(0.5);

  const totalContentH = RULER_H + topics.length * ROW_H;

  // Container width — updated by ResizeObserver, triggers canvas redraw on resize
  const [containerWidth, setContainerWidth] = useState(0);

  // Visible time window (with overscroll padding so the cursor can reach edges)
  const visibleDuration = duration / zoom;
  const pad = visibleDuration * 0.3;
  const panRange = duration - visibleDuration + 2 * pad;
  const viewStart = -pad + scrollX * panRange;
  const viewEnd = viewStart + visibleDuration;

  // Convert x position to time
  const xToTime = useCallback(
    (x: number, canvasW: number) => {
      const barW = canvasW - LABEL_W - CHECK_W - RIGHT_PAD;
      if (barW <= 0) return 0;
      const frac = (x - LABEL_W - CHECK_W) / barW;
      const t = viewStart + frac * visibleDuration;
      return Math.max(-pad, Math.min(duration + pad, t));
    },
    [duration, viewStart, visibleDuration, pad],
  );

  // Are all topics visible? (for the master checkbox)
  const allVisible = topics.length > 0 && topics.every((t) => !hiddenTopics.has(t.name));

  // Drag range selection state
  const dragStartXRef = useRef<number | null>(null);
  const dragStartTimeRef = useRef<number | null>(null);
  const dragCurrentTimeRef = useRef<number | null>(null);
  const isDraggingRangeRef = useRef(false);

  // Force redraw of dynamic canvas during drag
  const [dragRedraw, setDragRedraw] = useState(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = staticCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Checkbox / label clicks — handle immediately
      if (y < RULER_H) {
        if (x < CHECK_W) {
          onSetAllTopicsVisible(!allVisible);
          return;
        }
      } else {
        const topicIdx = Math.floor((y - RULER_H) / ROW_H);
        if (topicIdx >= 0 && topicIdx < topics.length) {
          if (x < CHECK_W) {
            onToggleTopicVisibility(topics[topicIdx].name);
            return;
          }
          if (x < LABEL_W + CHECK_W) {
            onSelectTopic(topics[topicIdx].name);
            return;
          }
        }
      }

      // Bar area — start potential drag
      if (x >= LABEL_W + CHECK_W) {
        dragStartXRef.current = x;
        dragStartTimeRef.current = xToTime(x, rect.width);
        dragCurrentTimeRef.current = dragStartTimeRef.current;
        isDraggingRangeRef.current = false;
      }
    },
    [topics, onSelectTopic, onToggleTopicVisibility, onSetAllTopicsVisible, xToTime, allVisible],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragStartXRef.current === null) return;
      const canvas = staticCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Check if drag distance exceeds threshold
      if (!isDraggingRangeRef.current && Math.abs(x - dragStartXRef.current) >= 5) {
        isDraggingRangeRef.current = true;
      }

      if (isDraggingRangeRef.current) {
        dragCurrentTimeRef.current = xToTime(x, rect.width);
        setDragRedraw((v) => v + 1);
      }
    },
    [xToTime],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragStartXRef.current === null) return;
      const canvas = staticCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (isDraggingRangeRef.current && dragStartTimeRef.current !== null && dragCurrentTimeRef.current !== null) {
        // Drag completed — set loop range
        const t1 = dragStartTimeRef.current;
        const t2 = xToTime(x, rect.width);
        const start = Math.max(0, Math.min(t1, t2));
        const end = Math.min(duration, Math.max(t1, t2));
        if (end - start > 0) {
          onLoopRangeChange([start, end]);
        }
      } else {
        // Short click — seek
        onSeek(xToTime(x, rect.width));
      }

      // Reset drag state
      dragStartXRef.current = null;
      dragStartTimeRef.current = null;
      dragCurrentTimeRef.current = null;
      isDraggingRangeRef.current = false;
      setDragRedraw((v) => v + 1);
    },
    [xToTime, onSeek, onLoopRangeChange, duration],
  );

  const handleDoubleClick = useCallback(() => {
    onLoopRangeChange(null);
  }, [onLoopRangeChange]);

  // Wheel zoom — use refs for latest values to avoid re-registering listener
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const viewStartRef = useRef(viewStart);
  viewStartRef.current = viewStart;
  const visibleDurationRef = useRef(visibleDuration);
  visibleDurationRef.current = visibleDuration;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  // Native wheel listener with { passive: false }
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const barW = rect.width - LABEL_W - CHECK_W - RIGHT_PAD;
        if (barW <= 0) return;

        const frac = Math.max(0, Math.min(1, (x - LABEL_W - CHECK_W) / barW));
        const mouseTime = viewStartRef.current + frac * visibleDurationRef.current;

        const factor = e.deltaY > 0 ? 0.85 : 1.18;
        const newZoom = Math.max(0.1, Math.min(200, zoomRef.current * factor));
        const dur = durationRef.current;
        const newVisDur = dur / newZoom;
        const newPad = newVisDur * 0.3;
        const newPanRange = dur - newVisDur + 2 * newPad;

        const newViewStart = mouseTime - frac * newVisDur;
        const newScrollX = newPanRange > 0 ? (newViewStart + newPad) / newPanRange : 0;

        setZoom(newZoom);
        setScrollX(Math.max(0, Math.min(1, newScrollX)));
      } else if (e.shiftKey) {
        e.preventDefault();
        setScrollX((prev) => {
          const step = 0.05 / zoomRef.current;
          return Math.max(0, Math.min(1, prev + (e.deltaY > 0 ? step : -step)));
        });
      }
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Track container width via ResizeObserver — triggers canvas redraw on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    // Initialize
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // ---- Density bin cache (recomputed only when topics/view changes, NOT on currentTime) ----
  const densityCache = useMemo<Map<string, TopicBins>>(() => {
    const cache = new Map<string, TopicBins>();
    if (visibleDuration <= 0) return cache;

    for (const topic of topics) {
      if (topic.times.length === 0) continue;
      const bins = new Uint16Array(NUM_BINS);
      let maxBin = 0;
      for (const t of topic.times) {
        if (t < viewStart || t > viewEnd) continue;
        const bin = Math.min(NUM_BINS - 1, Math.floor(((t - viewStart) / visibleDuration) * NUM_BINS));
        bins[bin]++;
        if (bins[bin] > maxBin) maxBin = bins[bin];
      }
      cache.set(topic.name, { bins, maxBin });
    }
    return cache;
  }, [topics, viewStart, viewEnd, visibleDuration]);

  // ---- Draw static layer (everything except playhead) ----
  useEffect(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas || containerWidth <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = containerWidth;
    const h = totalContentH;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const barW = w - LABEL_W - CHECK_W - RIGHT_PAD;
    if (barW <= 0) return;

    // Clear
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.strokeStyle = "#c0c0c0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(w, RULER_H - 0.5);
    ctx.stroke();

    // Master checkbox in ruler row (same style as per-topic checkboxes)
    if (topics.length > 0) {
      const cx = 4;
      const cy = (RULER_H - 10) / 2;
      const cs = 10;
      ctx.strokeStyle = "#b0b0b0";
      ctx.lineWidth = 1;
      ctx.strokeRect(cx, cy, cs, cs);
      if (allVisible) {
        ctx.fillStyle = "#2878c5";
        ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + 2, cy + 5);
        ctx.lineTo(cx + 4, cy + 8);
        ctx.lineTo(cx + 8, cy + 2);
        ctx.stroke();
      } else if (topics.some((t) => !hiddenTopics.has(t.name))) {
        ctx.fillStyle = "#2878c5";
        ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + 2, cy + cs / 2);
        ctx.lineTo(cx + cs - 2, cy + cs / 2);
        ctx.stroke();
      }
    }

    // Time ticks
    if (visibleDuration > 0) {
      const tickCount = Math.max(2, Math.min(12, Math.floor(barW / 70)));
      ctx.fillStyle = "#555555";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.strokeStyle = "#c0c0c0";
      for (let i = 0; i <= tickCount; i++) {
        const t = viewStart + (i / tickCount) * visibleDuration;
        const x = LABEL_W + CHECK_W + (i / tickCount) * barW;
        ctx.beginPath();
        ctx.moveTo(x, RULER_H - 6);
        ctx.lineTo(x, RULER_H);
        ctx.stroke();
        ctx.fillText(formatTime(t), x, RULER_H - 8);
      }
    }

    // Zoom indicator
    if (zoom > 1) {
      ctx.fillStyle = "#888888";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${zoom.toFixed(1)}x`, 4, RULER_H - 8);
    }

    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const y = RULER_H + i * ROW_H;
      const isSelected = topic.name === selectedTopicName;
      const isHidden = hiddenTopics.has(topic.name);

      // Row background
      if (isSelected) {
        ctx.fillStyle = "#2878c518";
        ctx.fillRect(0, y, w, ROW_H);
      } else if (i % 2 === 1) {
        ctx.fillStyle = "#00000008";
        ctx.fillRect(0, y, w, ROW_H);
      }

      // Row bottom border
      ctx.strokeStyle = "#dcdcdc";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y + ROW_H - 0.5);
      ctx.lineTo(w, y + ROW_H - 0.5);
      ctx.stroke();

      // Checkbox
      const cx = 4;
      const cy = y + 4;
      const cs = 10;
      ctx.strokeStyle = "#b0b0b0";
      ctx.lineWidth = 1;
      ctx.strokeRect(cx, cy, cs, cs);
      if (!isHidden) {
        ctx.fillStyle = "#2878c5";
        ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + 2, cy + 5);
        ctx.lineTo(cx + 4, cy + 8);
        ctx.lineTo(cx + 8, cy + 2);
        ctx.stroke();
      }

      // Label
      const labelAlpha = isHidden ? 0.4 : 1.0;
      ctx.globalAlpha = labelAlpha;
      ctx.fillStyle = isSelected ? "#2878c5" : "#404040";
      ctx.font = isSelected ? "bold 10px sans-serif" : "10px sans-serif";
      ctx.textAlign = "left";
      const maxLabelChars = Math.floor((LABEL_W - 6) / 6);
      const label = topic.name.length > maxLabelChars ? `...${topic.name.slice(-(maxLabelChars - 3))}` : topic.name;
      ctx.fillText(label, CHECK_W + 4, y + ROW_H - 5);

      // Density bar (from cache)
      const cached = densityCache.get(topic.name);
      if (cached && cached.maxBin > 0) {
        const color = getTopicColor(topic.type);
        const barY = y + 2;
        const barH = ROW_H - 4;
        const binW = barW / NUM_BINS;
        const barAlpha = isHidden ? 0.15 : 1.0;
        ctx.globalAlpha = barAlpha;
        for (let b = 0; b < NUM_BINS; b++) {
          if (cached.bins[b] === 0) continue;
          const alpha = 0.25 + 0.75 * (cached.bins[b] / cached.maxBin);
          ctx.fillStyle = hexWithAlpha(color, alpha);
          ctx.fillRect(LABEL_W + CHECK_W + b * binW, barY, Math.max(1, binW), barH);
        }
      }
      ctx.globalAlpha = 1.0;
    }

    ctx.strokeStyle = "#c0c0c0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CHECK_W - 0.5, 0);
    ctx.lineTo(CHECK_W - 0.5, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(LABEL_W + CHECK_W - 0.5, 0);
    ctx.lineTo(LABEL_W + CHECK_W - 0.5, h);
    ctx.stroke();
  }, [
    topics,
    selectedTopicName,
    totalContentH,
    hiddenTopics,
    zoom,
    viewStart,
    visibleDuration,
    densityCache,
    allVisible,
    containerWidth,
  ]);

  // ---- Draw dynamic layer (loop range overlay + playhead) ----
  // biome-ignore lint/correctness/useExhaustiveDependencies: dragRedraw intentionally triggers redraw during drag
  useEffect(() => {
    const canvas = dynamicCanvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = containerWidth;
    if (w <= 0) return;
    const h = totalContentH;

    // Resize dynamic canvas to match static
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear entire dynamic layer
    ctx.clearRect(0, 0, w, h);

    const barW = w - LABEL_W - CHECK_W - RIGHT_PAD;
    if (barW <= 0 || visibleDuration <= 0) return;

    const timeToX = (t: number) => LABEL_W + CHECK_W + ((t - viewStart) / visibleDuration) * barW;

    // Draw confirmed loop range overlay
    if (loopRange) {
      const x1 = Math.max(LABEL_W + CHECK_W, timeToX(loopRange[0]));
      const x2 = Math.min(LABEL_W + CHECK_W + barW, timeToX(loopRange[1]));
      if (x2 > x1) {
        ctx.fillStyle = "rgba(40, 120, 197, 0.15)";
        ctx.fillRect(x1, 0, x2 - x1, h);
        // Draw range edges
        ctx.strokeStyle = "rgba(40, 120, 197, 0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, h);
        ctx.moveTo(x2, 0);
        ctx.lineTo(x2, h);
        ctx.stroke();
      }
    }

    // Draw drag-in-progress range overlay
    if (isDraggingRangeRef.current && dragStartTimeRef.current !== null && dragCurrentTimeRef.current !== null) {
      const t1 = dragStartTimeRef.current;
      const t2 = dragCurrentTimeRef.current;
      const x1 = Math.max(LABEL_W + CHECK_W, timeToX(Math.min(t1, t2)));
      const x2 = Math.min(LABEL_W + CHECK_W + barW, timeToX(Math.max(t1, t2)));
      if (x2 > x1) {
        ctx.fillStyle = "rgba(40, 120, 197, 0.10)";
        ctx.fillRect(x1, 0, x2 - x1, h);
      }
    }

    // Draw playhead
    if (currentTime >= viewStart && currentTime <= viewEnd) {
      const cx2 = timeToX(currentTime);
      ctx.strokeStyle = "#d9534f";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx2, 0);
      ctx.lineTo(cx2, h);
      ctx.stroke();
    }
  }, [currentTime, totalContentH, visibleDuration, viewStart, viewEnd, loopRange, dragRedraw, containerWidth]);

  // Height resize
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = height;
      const onMove = (ev: MouseEvent) => {
        setHeight(Math.max(MIN_HEIGHT, startH + ev.clientY - startY));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  // Horizontal scrollbar for zoom
  const handleHScroll = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setScrollX(parseFloat(e.target.value));
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      {/* Playback controls (top bar) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "3px 8px",
          background: "#e0e0e0",
          borderBottom: "1px solid #c0c0c0",
          fontSize: "11px",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          style={{
            background: "#ffffff",
            border: "1px solid #c0c0c0",
            borderRadius: "3px",
            color: "#303030",
            cursor: "pointer",
            padding: "1px 8px",
            fontSize: "12px",
            lineHeight: "18px",
          }}
          onClick={isPlaying ? onPause : onPlay}
        >
          {isPlaying ? "\u25A0" : "\u25B6"}
        </button>
        <select
          style={{
            background: "#ffffff",
            border: "1px solid #c0c0c0",
            borderRadius: "3px",
            color: "#303030",
            fontSize: "11px",
            padding: "1px 2px",
            cursor: "pointer",
          }}
          value={speed}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <span style={{ fontFamily: "monospace", fontSize: "11px", color: "#555555", textAlign: "center" }}>
          {formatLocalTime(startTime + currentTime)}
        </span>
      </div>

      {/* Scrollable canvas area — two layers stacked */}
      <div
        ref={scrollRef}
        style={{
          width: "100%",
          height: `${height}px`,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <div ref={containerRef} style={{ width: "100%", position: "relative" }}>
          {/* Static layer (topic rows, density bars, ruler) */}
          <canvas
            ref={staticCanvasRef}
            style={{ width: "100%", height: `${totalContentH}px`, cursor: "pointer", display: "block" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDoubleClick={handleDoubleClick}
          />
          {/* Dynamic layer (playhead) — overlaid with pointer-events: none */}
          <canvas
            ref={dynamicCanvasRef}
            style={{
              width: "100%",
              height: `${totalContentH}px`,
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>

      {/* Horizontal scroll bar + zoom info */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "2px 8px",
          background: "#e8e8e8",
          borderTop: "1px solid #c0c0c0",
          fontSize: "10px",
          color: "#666666",
        }}
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={scrollX}
          onChange={handleHScroll}
          style={{ flex: 1, height: "3px", accentColor: "#2878c5" }}
        />
        <span
          style={{ cursor: "pointer" }}
          onClick={() => {
            setZoom(1);
            setScrollX(0.5);
          }}
          title="Reset zoom"
        >
          1:1
        </span>
        {zoom !== 1 && <span style={{ color: "#888888" }}>{zoom.toFixed(1)}x</span>}
      </div>

      {/* Resize handle */}
      <div
        style={{
          height: "4px",
          cursor: "row-resize",
          background: "#c0c0c0",
          flexShrink: 0,
        }}
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}

function formatTime(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(0).padStart(2, "0")}`;
}

function formatLocalTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(Math.floor(d.getMilliseconds() / 100));
  return `${Y}/${M}/${D} ${hh}:${mm}:${ss}.${ms}`;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
