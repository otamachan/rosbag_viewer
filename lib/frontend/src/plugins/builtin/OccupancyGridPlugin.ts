import { OccupancyGridDisplay } from "../../three/OccupancyGridDisplay.ts";
import type { DisplayPlugin } from "../DisplayPlugin.ts";

export const OccupancyGridPlugin: DisplayPlugin = {
  id: "occupancygrid",
  canHandle: (type) => type === "nav_msgs/OccupancyGrid",
  createDisplay: (settings) => {
    const d = new OccupancyGridDisplay();
    d.setOpacity((settings.opacity as number) ?? 1.0);
    d.setZOffset((settings.zOffset as number) ?? 0);
    return {
      object: d.object,
      update: (msg) => d.updateOccupancyGrid(msg),
      applySettings: (s) => {
        if (s.opacity != null) d.setOpacity(s.opacity as number);
        if (s.zOffset != null) d.setZOffset(s.zOffset as number);
      },
      setResolution: () => {},
      dispose: () => d.dispose(),
    };
  },
  properties: [
    { key: "opacity", label: "Alpha", type: "number", min: 0, max: 1, step: 0.1, defaultValue: 0.7 },
    { key: "zOffset", label: "Z Offset", type: "number", min: -10, max: 10, step: 0.01, defaultValue: 0 },
  ],
};
