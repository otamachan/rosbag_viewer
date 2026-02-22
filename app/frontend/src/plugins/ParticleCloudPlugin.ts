import type { DisplayPlugin } from "@rosbag-viewer/plugins/DisplayPlugin.ts";
import { ParticleCloudDisplay } from "./ParticleCloudDisplay.ts";

export const ParticleCloudPlugin: DisplayPlugin = {
  id: "particlecloud",
  canHandle: (type) => type === "nav2_msgs/ParticleCloud",
  createDisplay: (settings) => {
    const d = new ParticleCloudDisplay(parseInt(String(settings.color ?? "#2196f3").replace("#", ""), 16));
    d.setOpacity((settings.opacity as number) ?? 0.7);
    d.setLineWidth((settings.size as number) ?? 0.3);
    return {
      object: d.object,
      update: (msg) => {
        console.log("[ParticleCloud] update", msg);
        d.updateParticleCloud(msg);
      },
      applySettings: (s) => {
        if (s.color != null) d.setColor(parseInt(String(s.color).replace("#", ""), 16));
        if (s.size != null) d.setLineWidth(s.size as number);
        if (s.opacity != null) d.setOpacity(s.opacity as number);
      },
      setResolution: () => {},
      dispose: () => d.dispose(),
    };
  },
  properties: [
    { key: "color", label: "Color", type: "color", defaultValue: "#2196f3" },
    { key: "size", label: "Size", type: "number", min: 0.1, max: 20, step: 0.1, defaultValue: 0.3 },
    { key: "opacity", label: "Alpha", type: "number", min: 0, max: 1, step: 0.1, defaultValue: 0.7 },
  ],
};
