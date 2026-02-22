/** API client for rosbag-web-viewer server. */

import type { MsgSchema } from "../decoder/RosDecoder.ts";

export type { MsgSchema };

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  modified: string;
  kind: "file" | "directory";
}

export interface TopicInfo {
  id: number;
  name: string;
  type: string;
  message_count: number;
  frequency: number;
}

export interface BagInfo {
  path: string;
  duration: number;
  start_time: number;
  end_time: number;
  message_count: number;
  topics: TopicInfo[];
  schemas: Record<string, MsgSchema[]>;
}

export async function getCwd(): Promise<string> {
  const res = await fetch("/api/cwd");
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.path;
}

export async function getFiles(dir: string): Promise<FileEntry[]> {
  const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.files;
}

export async function getBagInfo(path: string): Promise<BagInfo> {
  const res = await fetch(`/api/bag/info?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface TopicTimelineEntry {
  id: number;
  name: string;
  type: string;
  times: number[];
}

export interface TopicTimeline {
  duration: number;
  topics: TopicTimelineEntry[];
}

export async function getBagTimeline(path: string): Promise<TopicTimeline> {
  const res = await fetch(`/api/bag/timeline?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface UploadedFile {
  original_name: string;
  path: string;
  size: number;
}

export interface UploadResponse {
  uploaded: UploadedFile[];
}

export async function uploadBagFiles(files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("file", file);
  }
  const res = await fetch("/api/bag/upload", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface MessagesOptions {
  topics?: number[];
  start?: number;
  end?: number;
}

export async function getBagMessages(path: string, opts?: MessagesOptions): Promise<ArrayBuffer> {
  const params = new URLSearchParams({ path });
  if (opts?.topics) params.set("topics", opts.topics.join(","));
  if (opts?.start != null) params.set("start", String(opts.start));
  if (opts?.end != null) params.set("end", String(opts.end));

  const res = await fetch(`/api/bag/messages?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.arrayBuffer();
}
