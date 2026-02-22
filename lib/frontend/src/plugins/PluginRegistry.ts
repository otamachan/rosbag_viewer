import type { DisplayPlugin } from "./DisplayPlugin.ts";

const plugins: DisplayPlugin[] = [];

export function registerPlugins(list: DisplayPlugin[]): void {
  plugins.push(...list);
}

export function getPlugins(): DisplayPlugin[] {
  return plugins;
}

/** Find a plugin that matches the given topicType/topicName */
export function findPlugin(topicType: string, topicName: string): DisplayPlugin | null {
  return plugins.find((p) => p.canHandle(topicType, topicName)) ?? null;
}

/** Check if any plugin can provide 3D display for this topic */
export function canHandle3D(topicType: string, topicName: string): boolean {
  return plugins.some((p) => p.canHandle(topicType, topicName) && p.createDisplay);
}
