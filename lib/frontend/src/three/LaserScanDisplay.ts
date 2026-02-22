/**
 * Renders a sensor_msgs/LaserScan as a 2D point cloud.
 *
 * Each range value is converted to an (x, y) point using the scan angles:
 *   x = range * cos(angle)
 *   y = range * sin(angle)
 *
 * Uses THREE.Points with a BufferGeometry for performance.
 * Points are rendered in ROS frame (added to rosGroup).
 *
 * Message structure:
 *   { header, angle_min, angle_max, angle_increment,
 *     range_min, range_max, ranges: number[], intensities: number[] }
 */

import * as THREE from "three";

const DEFAULT_COLOR = 0xff0000;
const INITIAL_CAPACITY = 1024;

export class LaserScanDisplay {
  readonly object: THREE.Group;

  private points: THREE.Points | null = null;
  private geom: THREE.BufferGeometry | null = null;
  private mat: THREE.PointsMaterial;
  private capacity = 0;
  private posArray: Float32Array | null = null;

  constructor(color?: number) {
    this.object = new THREE.Group();
    this.mat = new THREE.PointsMaterial({
      color: color ?? DEFAULT_COLOR,
      size: 3,
      sizeAttenuation: false,
    });
    this.ensureCapacity(INITIAL_CAPACITY);
  }

  setColor(color: number): void {
    this.mat.color.set(color);
  }

  setLineWidth(width: number): void {
    // Use size to control point size
    this.mat.size = Math.max(1, width * 2);
  }

  setResolution(_width: number, _height: number): void {
    // No-op
  }

  setOpacity(opacity: number): void {
    this.mat.opacity = opacity;
    this.mat.transparent = opacity < 1;
  }

  private ensureCapacity(count: number): void {
    if (this.capacity >= count) return;

    const newCap = Math.max(count, this.capacity * 2, INITIAL_CAPACITY);

    if (this.points) {
      this.object.remove(this.points);
    }
    if (this.geom) {
      this.geom.dispose();
    }

    this.posArray = new Float32Array(newCap * 3);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute("position", new THREE.BufferAttribute(this.posArray, 3));
    this.geom.setDrawRange(0, 0);

    this.points = new THREE.Points(this.geom, this.mat);
    this.object.add(this.points);
    this.capacity = newCap;
  }

  /** Update from a decoded sensor_msgs/LaserScan message. */
  updateLaserScan(msg: Record<string, unknown>): void {
    // ranges may be a TypedArray (Float32Array) from the binary decoder
    const ranges = msg.ranges as ArrayLike<number> | undefined;
    if (!ranges || ranges.length === 0) {
      if (this.geom) this.geom.setDrawRange(0, 0);
      return;
    }

    const angleMin = (msg.angle_min as number) ?? 0;
    const angleIncrement = (msg.angle_increment as number) ?? 0;
    const rangeMin = (msg.range_min as number) ?? 0;
    const rangeMax = (msg.range_max as number) ?? Infinity;

    this.ensureCapacity(ranges.length);
    if (!this.posArray || !this.geom) return;

    let validCount = 0;
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      // Filter invalid ranges
      if (!Number.isFinite(r) || r < rangeMin || r > rangeMax) continue;

      const angle = angleMin + i * angleIncrement;
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);

      this.posArray[validCount * 3] = x;
      this.posArray[validCount * 3 + 1] = y;
      this.posArray[validCount * 3 + 2] = 0;
      validCount++;
    }

    const attr = this.geom.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.geom.setDrawRange(0, validCount);
  }

  dispose(): void {
    if (this.points) {
      this.object.remove(this.points);
    }
    if (this.geom) {
      this.geom.dispose();
    }
    this.mat.dispose();
  }
}
