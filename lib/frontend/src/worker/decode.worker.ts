/**
 * Web Worker for off-main-thread binary frame parsing.
 *
 * Receives an ArrayBuffer, parses it into frames, and sends back
 * the parsed frame metadata + the original buffer as Transferable.
 */

const HEADER_SIZE = 14;

export interface WorkerFrame {
  topicId: number;
  timestampSec: number;
  /** Byte offset of payload within the original buffer. */
  payloadOffset: number;
  /** Byte length of payload. */
  payloadLength: number;
}

export interface DecodeRequest {
  id: number;
  buffer: ArrayBuffer;
  bagIndex: number;
}

export interface DecodeResponse {
  id: number;
  frames: WorkerFrame[];
  buffer: ArrayBuffer;
  bagIndex: number;
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
  const { id, buffer, bagIndex } = e.data;

  const view = new DataView(buffer);
  const frames: WorkerFrame[] = [];
  let offset = 0;

  while (offset + HEADER_SIZE <= buffer.byteLength) {
    const topicId = view.getUint16(offset, true);
    const timestampNs = view.getBigUint64(offset + 2, true);
    const payloadLength = view.getUint32(offset + 10, true);

    const payloadStart = offset + HEADER_SIZE;
    if (payloadStart + payloadLength > buffer.byteLength) break;

    frames.push({
      topicId,
      timestampSec: Number(timestampNs) / 1e9,
      payloadOffset: payloadStart,
      payloadLength,
    });

    offset = payloadStart + payloadLength;
  }

  const response: DecodeResponse = { id, frames, buffer, bagIndex };
  // Transfer the buffer back (zero-copy)
  (self as unknown as Worker).postMessage(response, [buffer]);
};
