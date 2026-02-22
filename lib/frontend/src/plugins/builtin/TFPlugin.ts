import type { DisplayPlugin } from "../DisplayPlugin.ts";

/** TF plugin — no 3D display (handled by shared TFDisplay), properties only for sidebar UI. */
export const TFPlugin: DisplayPlugin = {
  id: "tf",
  canHandle: (type) => type === "tf2_msgs/TFMessage" || type === "tf/tfMessage",
  // No createDisplay — TF is managed by ThreeViewerPanel's shared TFDisplay
  properties: [
    { key: "size", label: "Size", type: "number", min: 0.1, max: 20, step: 0.1, defaultValue: 0.5 },
    { key: "opacity", label: "Alpha", type: "number", min: 0, max: 1, step: 0.1, defaultValue: 0.7 },
  ],
};
