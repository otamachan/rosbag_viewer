/**
 * Renders a nav_msgs/Path as a polyline.
 * All coordinates are in ROS frame (added to rosGroup).
 */

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const DEFAULT_COLOR = 0x00e676;

export class PathDisplay {
  readonly object: THREE.Group;

  private line: Line2 | null = null;
  private geom: LineGeometry | null = null;
  private mat: LineMaterial;

  constructor(color?: number) {
    this.object = new THREE.Group();
    this.mat = new LineMaterial({
      color: color ?? DEFAULT_COLOR,
      linewidth: 2,
      worldUnits: false,
    });
  }

  setColor(color: number): void {
    this.mat.color.set(color);
  }

  setLineWidth(width: number): void {
    this.mat.linewidth = width;
  }

  setResolution(width: number, height: number): void {
    this.mat.resolution.set(width, height);
  }

  setOpacity(opacity: number): void {
    this.mat.opacity = opacity;
    this.mat.transparent = opacity < 1;
  }

  /** Update from a decoded nav_msgs/Path message. */
  updatePath(msg: Record<string, unknown>): void {
    const poses = msg.poses as Record<string, unknown>[] | undefined;
    if (!poses || !Array.isArray(poses)) {
      this.clearLine();
      return;
    }

    const positions: number[] = [];
    for (const poseStamped of poses) {
      const pose = poseStamped.pose as Record<string, unknown> | undefined;
      if (!pose) continue;
      const pos = pose.position as Record<string, unknown> | undefined;
      if (!pos) continue;
      positions.push((pos.x as number) ?? 0, (pos.y as number) ?? 0, (pos.z as number) ?? 0);
    }

    const pointCount = positions.length / 3;
    if (pointCount < 2) {
      this.clearLine();
      return;
    }

    // Remove old line, create new one
    this.clearLine();
    this.geom = new LineGeometry();
    this.geom.setPositions(positions);
    this.line = new Line2(this.geom, this.mat);
    this.line.computeLineDistances();
    this.object.add(this.line);
  }

  private clearLine(): void {
    if (this.line) {
      this.object.remove(this.line);
      this.line = null;
    }
    if (this.geom) {
      this.geom.dispose();
      this.geom = null;
    }
  }

  dispose(): void {
    this.clearLine();
    this.mat.dispose();
  }
}
