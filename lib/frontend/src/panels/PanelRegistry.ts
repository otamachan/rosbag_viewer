import type { ComponentType } from "react";
import { lazy } from "react";
import type { MsgSchema } from "../decoder/RosDecoder.ts";

export interface PanelDefinition {
  id: string;
  name: string;
  /** Return true if this panel can render the given topic type. */
  canHandle: (topicType: string, schema: MsgSchema, typeMap: Map<string, MsgSchema>) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
}

const SPATIAL_TYPES = new Set([
  "geometry_msgs/PoseStamped",
  "geometry_msgs/PoseWithCovarianceStamped",
  "nav_msgs/Path",
  "geometry_msgs/PoseArray",
  "nav_msgs/OccupancyGrid",
  "nav_msgs/Odometry",
  "sensor_msgs/LaserScan",
  "visualization_msgs/MarkerArray",
  "tf2_msgs/TFMessage",
  "tf/tfMessage",
]);

// Lazy-loaded panel components (split into separate chunks)
const LazyThreeViewerPanel = lazy(() =>
  import("./builtin/ThreeViewerPanel.tsx").then((m) => ({ default: m.ThreeViewerPanel })),
);
const LazyImagePanel = lazy(() => import("./builtin/ImagePanel.tsx").then((m) => ({ default: m.ImagePanel })));
const LazyTimeSeriesPanel = lazy(() =>
  import("./builtin/TimeSeriesPanel.tsx").then((m) => ({ default: m.TimeSeriesPanel })),
);

// JsonTreePanel is tiny, keep it eager
import { JsonTreePanel } from "./builtin/JsonTreePanel.tsx";

const panels: PanelDefinition[] = [
  {
    id: "3d",
    name: "3D Viewer",
    canHandle: (type) => SPATIAL_TYPES.has(type),
    component: LazyThreeViewerPanel,
  },
  {
    id: "image",
    name: "Image",
    canHandle: (type) => type === "sensor_msgs/Image" || type === "sensor_msgs/CompressedImage",
    component: LazyImagePanel,
  },
  {
    id: "timeseries",
    name: "Time Series",
    canHandle: (_type, schema, typeMap) => hasNumericField(schema, typeMap, 3),
    component: LazyTimeSeriesPanel,
  },
  {
    id: "json",
    name: "JSON Tree",
    canHandle: () => true,
    component: JsonTreePanel,
  },
];

const NUMERIC_TYPES = new Set([
  "float32",
  "float64",
  "int8",
  "int16",
  "int32",
  "int64",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "bool",
]);

/** Recursively check if a schema has any non-array numeric field (up to maxDepth). */
function hasNumericField(schema: MsgSchema, typeMap: Map<string, MsgSchema>, maxDepth: number): boolean {
  if (maxDepth <= 0) return false;
  for (const f of schema.fields) {
    if (f.isConstant || f.isArray) continue;
    if (!f.isComplex && NUMERIC_TYPES.has(f.type)) return true;
    if (f.isComplex) {
      const sub = typeMap.get(f.type);
      if (sub && hasNumericField(sub, typeMap, maxDepth - 1)) return true;
    }
  }
  return false;
}

/** Get all panels that can handle the given topic type. */
export function getMatchingPanels(
  topicType: string,
  schema: MsgSchema,
  typeMap: Map<string, MsgSchema>,
): PanelDefinition[] {
  return panels.filter((p) => p.canHandle(topicType, schema, typeMap));
}

/** Get the best auto-selected panel for the topic type. */
export function getDefaultPanel(
  topicType: string,
  schema: MsgSchema,
  typeMap: Map<string, MsgSchema>,
): PanelDefinition {
  return panels.find((p) => p.id !== "json" && p.canHandle(topicType, schema, typeMap)) ?? panels[panels.length - 1];
}
