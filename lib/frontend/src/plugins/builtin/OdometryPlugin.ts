import { OdometryDisplay } from "../../three/OdometryDisplay.ts";
import type { DisplayPlugin } from "../DisplayPlugin.ts";

export const OdometryPlugin: DisplayPlugin = {
  id: "odometry",
  canHandle: (type) => type === "nav_msgs/Odometry",
  createDisplay: (settings) => {
    const d = new OdometryDisplay(
      parseInt(String(settings.color ?? "#888888").replace("#", ""), 16),
      (settings.poseShape as "arrow" | "axes") ?? "arrow",
    );
    d.setOpacity((settings.opacity as number) ?? 1.0);
    d.setLineWidth((settings.size as number) ?? 1.0);
    return {
      object: d.object,
      update: (msg) => d.updateOdometry(msg),
      applySettings: (s) => {
        if (s.color != null) d.setColor(parseInt(String(s.color).replace("#", ""), 16));
        if (s.size != null) d.setLineWidth(s.size as number);
        if (s.opacity != null) d.setOpacity(s.opacity as number);
        if (s.poseShape != null) d.setShape(s.poseShape as "arrow" | "axes");
      },
      setResolution: (w, h) => d.setResolution(w, h),
      dispose: () => d.dispose(),
    };
  },
  properties: [
    { key: "color", label: "Color", type: "color", defaultValue: "#888888" },
    { key: "size", label: "Size", type: "number", min: 0.1, max: 20, step: 0.1, defaultValue: 0.5 },
    { key: "opacity", label: "Alpha", type: "number", min: 0, max: 1, step: 0.1, defaultValue: 0.7 },
    {
      key: "poseShape",
      label: "Shape",
      type: "select",
      options: [
        { value: "arrow", label: "Arrow" },
        { value: "axes", label: "Axes" },
      ],
      defaultValue: "arrow",
    },
  ],
};
