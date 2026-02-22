/**
 * Main-thread helper to communicate with the decode Web Worker.
 */

import type { Frame } from "../decoder/FrameParser.ts";
import type { DecodeRequest, DecodeResponse, WorkerFrame } from "./decode.worker.ts";

// Vite worker import — the `?worker` suffix bundles it as a separate file
import DecodeWorkerUrl from "./decode.worker.ts?worker&url";

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (frames: Frame[]) => void; reject: (err: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL(DecodeWorkerUrl, import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<DecodeResponse>) => {
      const { id, frames: workerFrames, buffer } = e.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);

      // Reconstruct Frame objects with DataView references into the transferred buffer
      const frames: Frame[] = workerFrames.map((wf: WorkerFrame) => ({
        topicId: wf.topicId,
        timestampNs: BigInt(Math.round(wf.timestampSec * 1e9)),
        timestampSec: wf.timestampSec,
        payload: new DataView(buffer, wf.payloadOffset, wf.payloadLength),
      }));

      entry.resolve(frames);
    };
    worker.onerror = (e) => {
      // Reject all pending
      for (const entry of pending.values()) {
        entry.reject(new Error(e.message));
      }
      pending.clear();
    };
  }
  return worker;
}

/**
 * Parse frames in the Web Worker (off main thread).
 * The ArrayBuffer is transferred (zero-copy) to the worker and back.
 */
export function parseFramesAsync(buffer: ArrayBuffer, bagIndex: number): Promise<Frame[]> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const msg: DecodeRequest = { id, buffer, bagIndex };
    getWorker().postMessage(msg, [buffer]);
  });
}

/** Terminate the worker (cleanup). */
export function terminateDecodeWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    for (const entry of pending.values()) {
      entry.reject(new Error("Worker terminated"));
    }
    pending.clear();
  }
}
