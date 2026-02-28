import { MarkerArrayDisplay } from "../../three/MarkerArrayDisplay.ts";
import type { DisplayPlugin } from "../DisplayPlugin.ts";

export const MarkerArrayPlugin: DisplayPlugin = {
  id: "markerarray",
  canHandle: (type) => type === "visualization_msgs/MarkerArray",
  createDisplay: (settings) => {
    const d = new MarkerArrayDisplay();
    d.applySettings(settings);
    return {
      object: d.object,
      update: (msg) => d.update(msg),
      applySettings: (s) => d.applySettings(s),
      setResolution: (w, h) => d.setResolution(w, h),
      dispose: () => d.dispose(),
    };
  },
  extractGroups: (msg) => {
    const markers = msg.markers as Record<string, unknown>[] | undefined;
    if (!Array.isArray(markers)) return [];
    const nsSet = new Set<string>();
    for (const m of markers) {
      nsSet.add((m.ns as string) ?? "");
    }
    return Array.from(nsSet).sort();
  },
};
