import { useCallback, useEffect, useRef, useState } from "react";
import type { MsgSchema } from "../../decoder/RosDecoder.ts";
import type { PanelProps } from "../PanelProps.ts";
import styles from "./TimeSeriesPanel.module.css";

const COLORS = ["#2878c5", "#5cb85c", "#d9a44e", "#9b79b9", "#d9534f", "#e8c547", "#46b8a0"];

/** Collect plottable numeric field paths from a schema (recurses into sub-types). */
function getNumericFields(schema: MsgSchema, typeMap: Map<string, MsgSchema>, prefix = "", depth = 0): string[] {
  if (depth > 4) return [];
  const paths: string[] = [];
  for (const f of schema.fields) {
    if (f.isConstant) continue;
    if (f.isArray) continue; // skip arrays for simplicity
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    if (!f.isComplex && isNumeric(f.type)) {
      paths.push(path);
    } else if (f.isComplex) {
      const sub = typeMap.get(f.type);
      if (sub) {
        paths.push(...getNumericFields(sub, typeMap, path, depth + 1));
      }
    }
  }
  return paths;
}

function isNumeric(t: string): boolean {
  return [
    "float32",
    "float64",
    "int8",
    "int16",
    "int32",
    "int64",
    "uint8",
    "uint16",
    "uint32",
    "uint64",
    "bool",
  ].includes(t);
}

/** Resolve a dotted path like "pose.position.x" from a message object. */
function resolvePath(obj: Record<string, unknown>, path: string): number | null {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur === "number") return cur;
  if (typeof cur === "bigint") return Number(cur);
  if (typeof cur === "boolean") return cur ? 1 : 0;
  return null;
}

export function TimeSeriesPanel({ messageHistory, schema, timestamp, typeMap }: PanelProps) {
  const fields = getNumericFields(schema, typeMap);
  const [selected, setSelected] = useState<string[]>(() => (fields.length > 0 ? [fields[0]] : []));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFieldToggle = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const opts = e.target.selectedOptions;
    const values: string[] = [];
    for (let i = 0; i < opts.length; i++) values.push(opts[i].value);
    if (values.length > 0) setSelected(values);
  }, []);

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = "#303030";
    ctx.fillRect(0, 0, w, h);

    if (messageHistory.length === 0 || selected.length === 0) {
      ctx.fillStyle = "#666666";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No data", w / 2, h / 2);
      return;
    }

    const MARGIN = { top: 20, right: 16, bottom: 30, left: 60 };
    const plotW = w - MARGIN.left - MARGIN.right;
    const plotH = h - MARGIN.top - MARGIN.bottom;

    if (plotW <= 0 || plotH <= 0) return;

    // Extract data series
    const series: { path: string; points: { t: number; v: number }[] }[] = [];
    for (const path of selected) {
      const points: { t: number; v: number }[] = [];
      for (const m of messageHistory) {
        const v = resolvePath(m.msg, path);
        if (v !== null) points.push({ t: m.time, v });
      }
      series.push({ path, points });
    }

    // Compute ranges
    const allPoints = series.flatMap((s) => s.points);
    if (allPoints.length === 0) return;

    const tMin = allPoints[0].t;
    const tMax = allPoints[allPoints.length - 1].t;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of allPoints) {
      if (p.v < vMin) vMin = p.v;
      if (p.v > vMax) vMax = p.v;
    }
    if (vMin === vMax) {
      vMin -= 1;
      vMax += 1;
    }
    const vPad = (vMax - vMin) * 0.05;
    vMin -= vPad;
    vMax += vPad;

    const tRange = tMax - tMin || 1;
    const vRange = vMax - vMin;

    const toX = (t: number) => MARGIN.left + ((t - tMin) / tRange) * plotW;
    const toY = (v: number) => MARGIN.top + (1 - (v - vMin) / vRange) * plotH;

    // Grid lines
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 1;
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = MARGIN.top + (i / yTicks) * plotH;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, y);
      ctx.lineTo(MARGIN.left + plotW, y);
      ctx.stroke();
    }

    // Y axis labels
    ctx.fillStyle = "#777777";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    for (let i = 0; i <= yTicks; i++) {
      const v = vMax - (i / yTicks) * vRange;
      const y = MARGIN.top + (i / yTicks) * plotH;
      ctx.fillText(formatAxisValue(v), MARGIN.left - 6, y + 3);
    }

    // X axis labels (time)
    ctx.textAlign = "center";
    const xTicks = Math.min(6, Math.floor(plotW / 80));
    for (let i = 0; i <= xTicks; i++) {
      const t = tMin + (i / xTicks) * tRange;
      const x = toX(t);
      ctx.fillText(`${t.toFixed(1)}s`, x, h - MARGIN.bottom + 16);
    }

    // Draw series
    for (let si = 0; si < series.length; si++) {
      const { points } = series[si];
      if (points.length === 0) continue;

      ctx.strokeStyle = COLORS[si % COLORS.length];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toX(points[0].t), toY(points[0].v));
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(toX(points[i].t), toY(points[i].v));
      }
      ctx.stroke();
    }

    // Current time cursor
    if (timestamp >= tMin && timestamp <= tMax) {
      const cx = toX(timestamp);
      ctx.strokeStyle = "#d9534f";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, MARGIN.top);
      ctx.lineTo(cx, MARGIN.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Legend
    if (series.length > 0) {
      ctx.font = "11px monospace";
      let lx = MARGIN.left + 8;
      const ly = MARGIN.top + 14;
      for (let si = 0; si < series.length; si++) {
        const color = COLORS[si % COLORS.length];
        ctx.fillStyle = color;
        ctx.fillRect(lx, ly - 8, 10, 3);
        lx += 14;
        ctx.fillText(series[si].path, lx, ly);
        lx += ctx.measureText(series[si].path).width + 16;
      }
    }
  }, [messageHistory, selected, timestamp]);

  if (fields.length === 0) {
    return <div className={styles.empty}>No numeric fields to plot</div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.fieldsLabel}>Fields:</span>
        <select className={styles.select} multiple value={selected} onChange={handleFieldToggle} size={1}>
          {fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <span className={styles.ptsCount}>{messageHistory.length} pts</span>
      </div>
      <div ref={containerRef} className={styles.chartContainer}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
    </div>
  );
}

function formatAxisValue(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  if (Math.abs(v) >= 0.001) return v.toFixed(4);
  return v.toExponential(2);
}
