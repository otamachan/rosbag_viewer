import { LaserScanDisplay } from "../../three/LaserScanDisplay.ts";
import type { DisplayPlugin } from "../DisplayPlugin.ts";

export const LaserScanPlugin: DisplayPlugin = {
  id: "laserscan",
  canHandle: (type) => type === "sensor_msgs/LaserScan",
  createDisplay: (settings) => {
    const d = new LaserScanDisplay(parseInt(String(settings.color ?? "#888888").replace("#", ""), 16));
    d.setOpacity((settings.opacity as number) ?? 1.0);
    d.setLineWidth((settings.size as number) ?? 1.0);
    return {
      object: d.object,
      update: (msg) => d.updateLaserScan(msg),
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
    { key: "color", label: "Color", type: "color", defaultValue: "#888888" },
    { key: "size", label: "Size", type: "number", min: 0.1, max: 20, step: 0.1, defaultValue: 1.0 },
    { key: "opacity", label: "Alpha", type: "number", min: 0, max: 1, step: 0.1, defaultValue: 0.7 },
  ],
};
