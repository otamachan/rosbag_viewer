/**
 * Renders a nav_msgs/Odometry as a pose arrow (or axes).
 * Reuses PoseDisplay internally — Odometry is essentially PoseWithCovariance + Twist.
 * We display the pose; twist is ignored.
 *
 * Message structure:
 *   { header, child_frame_id, pose: { pose: { position, orientation }, covariance }, twist: ... }
 */

import type * as THREE from "three";
import type { PoseShape } from "./PoseDisplay.ts";
import { PoseDisplay } from "./PoseDisplay.ts";

export class OdometryDisplay {
  readonly object: THREE.Group;
  private inner: PoseDisplay;

  constructor(color?: number, shape?: PoseShape) {
    this.inner = new PoseDisplay(color, shape);
    this.object = this.inner.object;
  }

  setColor(color: number): void {
    this.inner.setColor(color);
  }

  setLineWidth(width: number): void {
    this.inner.setLineWidth(width);
  }

  setResolution(width: number, height: number): void {
    this.inner.setResolution(width, height);
  }

  setOpacity(opacity: number): void {
    this.inner.setOpacity(opacity);
  }

  setShape(shape: PoseShape): void {
    this.inner.setShape(shape);
  }

  /** Update from a decoded nav_msgs/Odometry message. */
  updateOdometry(msg: Record<string, unknown>): void {
    // Odometry.pose is PoseWithCovariance { pose: { position, orientation }, covariance }
    // PoseDisplay.updatePose expects { pose: { position, orientation } } or
    // { pose: { pose: { position, orientation } } } (PoseWithCovarianceStamped style)
    // So we can pass the whole msg — PoseDisplay already handles unwrapping pose.pose
    this.inner.updatePose(msg);
  }

  dispose(): void {
    this.inner.dispose();
  }
}
