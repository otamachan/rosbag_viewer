import { registerPlugins } from "../PluginRegistry.ts";
import { ImagePlugin } from "./ImagePlugin.tsx";
import { LaserScanPlugin } from "./LaserScanPlugin.ts";
import { OccupancyGridPlugin } from "./OccupancyGridPlugin.ts";
import { OdometryPlugin } from "./OdometryPlugin.ts";
import { PathPlugin } from "./PathPlugin.ts";
import { PoseArrayPlugin } from "./PoseArrayPlugin.ts";
import { PosePlugin } from "./PosePlugin.ts";
import { TFPlugin } from "./TFPlugin.ts";

registerPlugins([
  PosePlugin,
  PathPlugin,
  PoseArrayPlugin,
  OccupancyGridPlugin,
  OdometryPlugin,
  LaserScanPlugin,
  ImagePlugin,
  TFPlugin,
]);
