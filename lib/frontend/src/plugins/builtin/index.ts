import { registerPlugins } from "../PluginRegistry.ts";
import { ImagePlugin } from "./ImagePlugin.tsx";
import { LaserScanPlugin } from "./LaserScanPlugin.ts";
import { MarkerArrayPlugin } from "./MarkerArrayPlugin.ts";
import { OccupancyGridPlugin } from "./OccupancyGridPlugin.ts";
import { OdometryPlugin } from "./OdometryPlugin.ts";
import { PathPlugin } from "./PathPlugin.ts";
import { PolygonPlugin } from "./PolygonPlugin.ts";
import { PoseArrayPlugin } from "./PoseArrayPlugin.ts";
import { PosePlugin } from "./PosePlugin.ts";
import { TFPlugin } from "./TFPlugin.ts";

registerPlugins([
  PosePlugin,
  PathPlugin,
  PolygonPlugin,
  PoseArrayPlugin,
  OccupancyGridPlugin,
  OdometryPlugin,
  LaserScanPlugin,
  MarkerArrayPlugin,
  ImagePlugin,
  TFPlugin,
]);
