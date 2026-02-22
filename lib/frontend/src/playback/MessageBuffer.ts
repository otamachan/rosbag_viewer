import type { Frame } from "../decoder/FrameParser.ts";
import type { TopicSource } from "../state/MultiBagState.ts";
import { compositeKey } from "../state/MultiBagState.ts";

export interface BufferedMessage {
  /** Offset from global start in seconds. */
  offsetSec: number;
  /** Raw ROS1 payload. */
  payload: DataView;
}

/**
 * Stores decoded frames indexed by composite key (bagIndex << 16 | topicId),
 * allowing efficient time-based lookup via binary search.
 * Supports both single-bag and multi-bag workflows.
 */
export class MessageBuffer {
  private byTopic: Map<number, BufferedMessage[]> = new Map();
  /** Reverse index: bagIndex → set of composite keys belonging to that bag. */
  private bagKeys: Map<number, Set<number>> = new Map();

  /**
   * Add frames for a specific bag.
   * `globalStartTimeSec` is the earliest start_time across all loaded bags.
   *
   * Frames from a single bag are already in timestamp order, so we append
   * and only sort if the new data isn't already ordered relative to existing entries.
   */
  loadForBag(frames: Frame[], bagIndex: number, globalStartTimeSec: number): void {
    // Track which keys belong to this bag
    let keySet = this.bagKeys.get(bagIndex);
    if (!keySet) {
      keySet = new Set();
      this.bagKeys.set(bagIndex, keySet);
    }

    for (const frame of frames) {
      const key = compositeKey(bagIndex, frame.topicId);
      keySet.add(key);
      let arr = this.byTopic.get(key);
      if (!arr) {
        arr = [];
        this.byTopic.set(key, arr);
      }
      arr.push({
        offsetSec: frame.timestampSec - globalStartTimeSec,
        payload: frame.payload,
      });
    }

    // Only sort arrays that actually received new data and might be out of order.
    // Frames from a single fetch are already timestamp-ordered, so we only need
    // to sort if we appended to an existing array (multi-load scenario).
    for (const frame of frames) {
      const key = compositeKey(bagIndex, frame.topicId);
      const arr = this.byTopic.get(key);
      if (!arr || arr.length < 2) continue;
      // Check if already sorted (fast path: just verify last two)
      if (arr[arr.length - 2].offsetSec > arr[arr.length - 1].offsetSec) {
        arr.sort((a, b) => a.offsetSec - b.offsetSec);
      }
    }
  }

  /** Get the most recent message payload at or before `offsetSec` for a single key. */
  getAt(key: number, offsetSec: number): DataView | null {
    const arr = this.byTopic.get(key);
    if (!arr || arr.length === 0) return null;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].offsetSec <= offsetSec) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 ? arr[lo - 1].payload : null;
  }

  /** Get the most recent message across multiple source topics. */
  getAtMerged(sources: TopicSource[], offsetSec: number): DataView | null {
    if (sources.length === 1) {
      return this.getAt(compositeKey(sources[0].bagIndex, sources[0].topicId), offsetSec);
    }
    let bestOffset = -Infinity;
    let bestPayload: DataView | null = null;
    for (const src of sources) {
      const key = compositeKey(src.bagIndex, src.topicId);
      const arr = this.byTopic.get(key);
      if (!arr || arr.length === 0) continue;
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].offsetSec <= offsetSec) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && arr[lo - 1].offsetSec > bestOffset) {
        bestOffset = arr[lo - 1].offsetSec;
        bestPayload = arr[lo - 1].payload;
      }
    }
    return bestPayload;
  }

  /**
   * Get all messages for merged sources, sorted by time.
   * Uses O(n) k-way merge for sorted arrays instead of concat+sort.
   */
  getAllMerged(sources: TopicSource[]): BufferedMessage[] {
    if (sources.length === 1) {
      const key = compositeKey(sources[0].bagIndex, sources[0].topicId);
      return this.byTopic.get(key) ?? [];
    }

    // Collect non-empty arrays
    const arrays: BufferedMessage[][] = [];
    for (const src of sources) {
      const key = compositeKey(src.bagIndex, src.topicId);
      const msgs = this.byTopic.get(key);
      if (msgs && msgs.length > 0) arrays.push(msgs);
    }
    if (arrays.length === 0) return [];
    if (arrays.length === 1) return arrays[0];

    // K-way merge (each array is already sorted)
    const indices = new Int32Array(arrays.length);
    let totalLen = 0;
    for (const a of arrays) totalLen += a.length;
    const result: BufferedMessage[] = new Array(totalLen);

    for (let out = 0; out < totalLen; out++) {
      let bestIdx = -1;
      let bestTime = Infinity;
      for (let k = 0; k < arrays.length; k++) {
        if (indices[k] < arrays[k].length) {
          const t = arrays[k][indices[k]].offsetSec;
          if (t < bestTime) {
            bestTime = t;
            bestIdx = k;
          }
        }
      }
      result[out] = arrays[bestIdx][indices[bestIdx]];
      indices[bestIdx]++;
    }

    return result;
  }

  /** Check if a composite key has loaded messages. */
  has(key: number): boolean {
    return (this.byTopic.get(key)?.length ?? 0) > 0;
  }

  /** Check if any source in a merged topic has been loaded. */
  hasMerged(sources: TopicSource[]): boolean {
    return sources.some((s) => this.has(compositeKey(s.bagIndex, s.topicId)));
  }

  /** Get the number of messages for a composite key. */
  count(key: number): number {
    return this.byTopic.get(key)?.length ?? 0;
  }

  /** Count total messages across merged sources. */
  countMerged(sources: TopicSource[]): number {
    let total = 0;
    for (const src of sources) {
      total += this.count(compositeKey(src.bagIndex, src.topicId));
    }
    return total;
  }

  /** Clear entries for a specific bag using reverse index (no full scan). */
  clearBag(bagIndex: number): void {
    const keySet = this.bagKeys.get(bagIndex);
    if (keySet) {
      for (const key of keySet) {
        this.byTopic.delete(key);
      }
      this.bagKeys.delete(bagIndex);
    }
  }

  clear(): void {
    this.byTopic.clear();
    this.bagKeys.clear();
  }
}
