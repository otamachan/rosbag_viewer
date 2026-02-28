/**
 * Renders a geometry_msgs/PolygonStamped as a closed polyline.
 */

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const DEFAULT_COLOR = 0x00e676;

export class PolygonDisplay {
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

  setZOffset(z: number): void {
    this.object.position.z = z;
  }

  /** Update from a decoded geometry_msgs/PolygonStamped message. */
  updatePolygon(msg: Record<string, unknown>): void {
    const polygon = msg.polygon as Record<string, unknown> | undefined;
    if (!polygon) {
      this.clearLine();
      return;
    }

    const points = polygon.points as Record<string, unknown>[] | undefined;
    if (!points || !Array.isArray(points) || points.length < 2) {
      this.clearLine();
      return;
    }

    const positions: number[] = [];
    for (const pt of points) {
      positions.push((pt.x as number) ?? 0, (pt.y as number) ?? 0, (pt.z as number) ?? 0);
    }

    // Close the polygon by connecting last point back to first
    positions.push(positions[0], positions[1], positions[2]);

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
