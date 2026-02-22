import { useEffect, useRef } from "react";
import type { PanelProps } from "../PanelProps.ts";
import styles from "./ImagePanel.module.css";

/**
 * Render a sensor_msgs/Image message onto a canvas element.
 * Returns true on success, false if required data is missing.
 */
export function renderImageToCanvas(canvas: HTMLCanvasElement, msg: Record<string, unknown>): boolean {
  const width = (msg.width as number) ?? 0;
  const height = (msg.height as number) ?? 0;
  const encoding = (msg.encoding as string) ?? "";
  const step = (msg.step as number) ?? 0;
  const data = msg.data;

  if (!width || !height || !data) return false;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  // Get raw pixel bytes
  let bytes: Uint8Array;
  if (data instanceof Uint8Array) {
    bytes = data;
  } else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(
      (data as ArrayBufferView).buffer,
      (data as ArrayBufferView).byteOffset,
      (data as ArrayBufferView).byteLength,
    );
  } else {
    return false;
  }

  const imageData = ctx.createImageData(width, height);
  const out = imageData.data;

  const enc = encoding.toLowerCase();

  if (enc === "rgb8") {
    for (let row = 0; row < height; row++) {
      const rowStart = row * step;
      for (let col = 0; col < width; col++) {
        const si = rowStart + col * 3;
        const di = (row * width + col) * 4;
        out[di] = bytes[si];
        out[di + 1] = bytes[si + 1];
        out[di + 2] = bytes[si + 2];
        out[di + 3] = 255;
      }
    }
  } else if (enc === "bgr8") {
    for (let row = 0; row < height; row++) {
      const rowStart = row * step;
      for (let col = 0; col < width; col++) {
        const si = rowStart + col * 3;
        const di = (row * width + col) * 4;
        out[di] = bytes[si + 2];
        out[di + 1] = bytes[si + 1];
        out[di + 2] = bytes[si];
        out[di + 3] = 255;
      }
    }
  } else if (enc === "rgba8") {
    for (let row = 0; row < height; row++) {
      const rowStart = row * step;
      for (let col = 0; col < width; col++) {
        const si = rowStart + col * 4;
        const di = (row * width + col) * 4;
        out[di] = bytes[si];
        out[di + 1] = bytes[si + 1];
        out[di + 2] = bytes[si + 2];
        out[di + 3] = bytes[si + 3];
      }
    }
  } else if (enc === "bgra8") {
    for (let row = 0; row < height; row++) {
      const rowStart = row * step;
      for (let col = 0; col < width; col++) {
        const si = rowStart + col * 4;
        const di = (row * width + col) * 4;
        out[di] = bytes[si + 2];
        out[di + 1] = bytes[si + 1];
        out[di + 2] = bytes[si];
        out[di + 3] = bytes[si + 3];
      }
    }
  } else if (enc === "mono8" || enc === "8uc1") {
    for (let row = 0; row < height; row++) {
      const rowStart = row * step;
      for (let col = 0; col < width; col++) {
        const v = bytes[rowStart + col];
        const di = (row * width + col) * 4;
        out[di] = v;
        out[di + 1] = v;
        out[di + 2] = v;
        out[di + 3] = 255;
      }
    }
  } else if (enc === "16uc1" || enc === "mono16") {
    for (let row = 0; row < height; row++) {
      const rowStart = row * step;
      for (let col = 0; col < width; col++) {
        const si = rowStart + col * 2;
        const v = (bytes[si] | (bytes[si + 1] << 8)) >> 8;
        const di = (row * width + col) * 4;
        out[di] = v;
        out[di + 1] = v;
        out[di + 2] = v;
        out[di + 3] = 255;
      }
    }
  } else if (enc === "bayer_rggb8") {
    demosaicRGGB(bytes, out, width, height, step);
  } else {
    const bpp = step / width;
    for (let row = 0; row < height; row++) {
      const rowStart = row * step;
      for (let col = 0; col < width; col++) {
        const si = rowStart + col * bpp;
        const di = (row * width + col) * 4;
        out[di] = bytes[si] ?? 0;
        out[di + 1] = bytes[si + 1] ?? 0;
        out[di + 2] = bytes[si + 2] ?? 0;
        out[di + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return true;
}

export function ImagePanel({ message }: PanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const width = (message?.width as number) ?? 0;
  const height = (message?.height as number) ?? 0;
  const encoding = (message?.encoding as string) ?? "";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !message) return;
    renderImageToCanvas(canvas, message);
  }, [message]);

  if (!message || !width || !height) {
    return (
      <div className={styles.root}>
        <span className={styles.empty}>No image at current time</span>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.wrapper}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <div className={styles.info}>
          {width}x{height} {encoding}
        </div>
      </div>
    </div>
  );
}

/** Simple nearest-neighbor Bayer RGGB demosaic. */
function demosaicRGGB(src: Uint8Array, dst: Uint8ClampedArray, w: number, h: number, step: number): void {
  const get = (r: number, c: number) => src[Math.min(r, h - 1) * step + Math.min(c, w - 1)];

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const di = (row * w + col) * 4;
      const rr = row & 1;
      const cc = col & 1;

      if (rr === 0 && cc === 0) {
        // R pixel
        dst[di] = get(row, col);
        dst[di + 1] = (get(row - 1, col) + get(row + 1, col) + get(row, col - 1) + get(row, col + 1)) >> 2;
        dst[di + 2] =
          (get(row - 1, col - 1) + get(row - 1, col + 1) + get(row + 1, col - 1) + get(row + 1, col + 1)) >> 2;
      } else if (rr === 0 && cc === 1) {
        // G pixel (R row)
        dst[di] = (get(row, col - 1) + get(row, col + 1)) >> 1;
        dst[di + 1] = get(row, col);
        dst[di + 2] = (get(row - 1, col) + get(row + 1, col)) >> 1;
      } else if (rr === 1 && cc === 0) {
        // G pixel (B row)
        dst[di] = (get(row - 1, col) + get(row + 1, col)) >> 1;
        dst[di + 1] = get(row, col);
        dst[di + 2] = (get(row, col - 1) + get(row, col + 1)) >> 1;
      } else {
        // B pixel
        dst[di] = (get(row - 1, col - 1) + get(row - 1, col + 1) + get(row + 1, col - 1) + get(row + 1, col + 1)) >> 2;
        dst[di + 1] = (get(row - 1, col) + get(row + 1, col) + get(row, col - 1) + get(row, col + 1)) >> 2;
        dst[di + 2] = get(row, col);
      }
      dst[di + 3] = 255;
    }
  }
}
