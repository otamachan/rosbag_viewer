/**
 * Binary frame parser.
 *
 * Frame layout (14-byte header + payload):
 *   0   u16le topic_id
 *   2   u64le timestamp (nanoseconds)
 *  10   u32le payload_length
 *  14   [u8]  payload
 */

const HEADER_SIZE = 14;

export interface Frame {
  topicId: number;
  /** Absolute timestamp in nanoseconds (bigint). */
  timestampNs: bigint;
  /** Absolute timestamp in seconds (f64, for convenience). */
  timestampSec: number;
  /** Raw payload bytes. For Data frames this is the ROS1 serialized message. */
  payload: DataView;
}

/**
 * Parse all frames from a binary response buffer.
 * Frames are expected to be contiguous with no gaps.
 */
export function parseFrames(buffer: ArrayBuffer): Frame[] {
  const view = new DataView(buffer);
  const frames: Frame[] = [];
  let offset = 0;

  while (offset + HEADER_SIZE <= buffer.byteLength) {
    const topicId = view.getUint16(offset, true);
    const timestampNs = view.getBigUint64(offset + 2, true);
    const payloadLength = view.getUint32(offset + 10, true);

    const payloadStart = offset + HEADER_SIZE;
    if (payloadStart + payloadLength > buffer.byteLength) {
      throw new Error(
        `Frame at offset ${offset} truncated: need ${payloadLength} bytes but only ${buffer.byteLength - payloadStart} available`,
      );
    }

    const payload = new DataView(buffer, payloadStart, payloadLength);
    const timestampSec = Number(timestampNs) / 1e9;

    frames.push({ topicId, timestampNs, timestampSec, payload });
    offset = payloadStart + payloadLength;
  }

  return frames;
}
