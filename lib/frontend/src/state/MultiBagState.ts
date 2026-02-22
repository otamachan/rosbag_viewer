import type { BagInfo } from "../api/client.ts";
import type { MsgSchema } from "../decoder/RosDecoder.ts";
import { buildTypeMap, RosDecoder } from "../decoder/RosDecoder.ts";

/** Represents one loaded bag file. */
export interface LoadedBag {
  index: number;
  path: string;
  info: BagInfo;
  decoder: RosDecoder;
  typeMap: Map<string, MsgSchema>;
}

/** Source info for a topic within a specific bag. */
export interface TopicSource {
  bagIndex: number;
  topicId: number;
  messageCount: number;
}

/** A merged topic entry combining info from potentially multiple bags. */
export interface MergedTopic {
  name: string;
  type: string;
  sources: TopicSource[];
  totalMessageCount: number;
}

/** Create a composite key from bagIndex and topicId. */
export function compositeKey(bagIndex: number, topicId: number): number {
  return (bagIndex << 16) | topicId;
}

/** Compute the union time range across all loaded bags. */
export function computeTimeRange(bags: LoadedBag[]): {
  startTime: number;
  endTime: number;
  duration: number;
} {
  if (bags.length === 0) return { startTime: 0, endTime: 0, duration: 0 };
  const startTime = Math.min(...bags.map((b) => b.info.start_time));
  const endTime = Math.max(...bags.map((b) => b.info.end_time));
  return { startTime, endTime, duration: endTime - startTime };
}

/** Merge topic lists from multiple bags (grouped by topic name). */
export function mergeTopics(bags: LoadedBag[]): MergedTopic[] {
  const byName = new Map<string, MergedTopic>();
  for (const bag of bags) {
    for (const topic of bag.info.topics) {
      const existing = byName.get(topic.name);
      if (existing) {
        existing.sources.push({
          bagIndex: bag.index,
          topicId: topic.id,
          messageCount: topic.message_count,
        });
        existing.totalMessageCount += topic.message_count;
      } else {
        byName.set(topic.name, {
          name: topic.name,
          type: topic.type,
          sources: [
            {
              bagIndex: bag.index,
              topicId: topic.id,
              messageCount: topic.message_count,
            },
          ],
          totalMessageCount: topic.message_count,
        });
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Build a merged type map from all loaded bags. */
export function buildMergedTypeMap(bags: LoadedBag[]): Map<string, MsgSchema> {
  const merged = new Map<string, MsgSchema>();
  for (const bag of bags) {
    for (const [name, schema] of bag.typeMap) {
      if (!merged.has(name)) merged.set(name, schema);
    }
  }
  return merged;
}

/** Create a LoadedBag from a BagInfo. */
export function createLoadedBag(index: number, path: string, info: BagInfo): LoadedBag {
  const typeMap = buildTypeMap(info.schemas);
  const decoder = new RosDecoder(typeMap);
  return { index, path, info, decoder, typeMap };
}
