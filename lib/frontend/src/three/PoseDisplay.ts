/**
 * Renders a geometry_msgs/PoseStamped (or PoseWithCovarianceStamped) as either:
 *   - "arrow"  — rviz2-style 3D arrow (shaft cylinder + cone head)
 *   - "axes"   — rviz2-style 3-axis indicator (3 cylinders: R=X, G=Y, B=Z)
 *
 * Geometry matches rviz2 PoseDisplay defaults:
 *   Arrow: shaft_length=1.0, shaft_radius=0.05, head_length=0.3, head_radius=0.1
 *   Axes:  length=1.0, radius=0.1 (plain cylinders, no cone heads)
 *
 * Position/orientation is set on `this.object` directly so both shapes
 * share the same transform and switching shapes preserves position.
 */

import * as THREE from "three";

const DEFAULT_COLOR = 0xff1900; // rviz2 default: QColor(255, 25, 0)

export type PoseShape = "arrow" | "axes";

// ---- Arrow constants (rviz2 PoseDisplay defaults) ----
const SHAFT_LENGTH = 1.0;
const SHAFT_RADIUS = 0.05;
const HEAD_LENGTH = 0.3;
const HEAD_RADIUS = 0.1;

// ---- Axes constants (rviz2 Axes defaults) ----
const AX_LENGTH = 1.0;
const AX_RADIUS = 0.1;

export class PoseDisplay {
  readonly object: THREE.Group;

  private shape: PoseShape;
  private color: number;

  // Arrow mode objects
  private arrowGroup: THREE.Group;
  private shaftMat: THREE.MeshPhongMaterial;
  private headMat: THREE.MeshPhongMaterial;

  // Axes mode objects
  private axesGroup: THREE.Group;
  private axisXMat: THREE.MeshPhongMaterial;
  private axisYMat: THREE.MeshPhongMaterial;
  private axisZMat: THREE.MeshPhongMaterial;

  // All geometries/materials for dispose
  private allGeometries: THREE.BufferGeometry[] = [];
  private allMaterials: THREE.MeshPhongMaterial[] = [];

  private readonly _quat = new THREE.Quaternion();

  constructor(color?: number, shape?: PoseShape) {
    this.object = new THREE.Group();
    this.color = color ?? DEFAULT_COLOR;
    this.shape = shape ?? "arrow";

    // ---- Arrow (shaft cylinder + cone head along +X) ----
    this.arrowGroup = new THREE.Group();

    const shaftGeom = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 8);
    shaftGeom.rotateZ(-Math.PI / 2); // Y-up → X-forward
    shaftGeom.translate(SHAFT_LENGTH / 2, 0, 0);
    this.shaftMat = new THREE.MeshPhongMaterial({ color: this.color });
    this.arrowGroup.add(new THREE.Mesh(shaftGeom, this.shaftMat));

    const headGeom = new THREE.ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 8);
    headGeom.rotateZ(-Math.PI / 2); // Y-up → X-forward
    headGeom.translate(SHAFT_LENGTH + HEAD_LENGTH / 2, 0, 0);
    this.headMat = new THREE.MeshPhongMaterial({ color: this.color });
    this.arrowGroup.add(new THREE.Mesh(headGeom, this.headMat));

    this.allGeometries.push(shaftGeom, headGeom);
    this.allMaterials.push(this.shaftMat, this.headMat);

    // ---- Axes (3 plain cylinders, no cone heads — matches rviz2) ----
    this.axesGroup = new THREE.Group();

    // X axis (red): cylinder rotated -90° around Z, centered at (length/2, 0, 0)
    const xGeom = new THREE.CylinderGeometry(AX_RADIUS, AX_RADIUS, AX_LENGTH, 8);
    xGeom.rotateZ(-Math.PI / 2);
    xGeom.translate(AX_LENGTH / 2, 0, 0);
    this.axisXMat = new THREE.MeshPhongMaterial({ color: 0xff0000 });
    this.axesGroup.add(new THREE.Mesh(xGeom, this.axisXMat));

    // Y axis (green): no rotation needed (cylinder is Y-up), centered at (0, length/2, 0)
    const yGeom = new THREE.CylinderGeometry(AX_RADIUS, AX_RADIUS, AX_LENGTH, 8);
    yGeom.translate(0, AX_LENGTH / 2, 0);
    this.axisYMat = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
    this.axesGroup.add(new THREE.Mesh(yGeom, this.axisYMat));

    // Z axis (blue): cylinder rotated +90° around X, centered at (0, 0, length/2)
    const zGeom = new THREE.CylinderGeometry(AX_RADIUS, AX_RADIUS, AX_LENGTH, 8);
    zGeom.rotateX(Math.PI / 2);
    zGeom.translate(0, 0, AX_LENGTH / 2);
    this.axisZMat = new THREE.MeshPhongMaterial({ color: 0x0000ff });
    this.axesGroup.add(new THREE.Mesh(zGeom, this.axisZMat));

    this.allGeometries.push(xGeom, yGeom, zGeom);
    this.allMaterials.push(this.axisXMat, this.axisYMat, this.axisZMat);

    this.applyShape();
  }

  private applyShape(): void {
    this.object.remove(this.arrowGroup);
    this.object.remove(this.axesGroup);
    if (this.shape === "arrow") {
      this.object.add(this.arrowGroup);
    } else {
      this.object.add(this.axesGroup);
    }
  }

  setShape(shape: PoseShape): void {
    if (this.shape === shape) return;
    this.shape = shape;
    this.applyShape();
  }

  setColor(color: number): void {
    this.color = color;
    this.shaftMat.color.set(color);
    this.headMat.color.set(color);
  }

  setLineWidth(width: number): void {
    this.arrowGroup.scale.setScalar(width);
    this.axesGroup.scale.setScalar(width);
  }

  setResolution(_width: number, _height: number): void {
    // No-op
  }

  setOpacity(opacity: number): void {
    for (const m of this.allMaterials) {
      m.opacity = opacity;
      m.transparent = opacity < 1;
    }
  }

  /** Update from a decoded PoseStamped or PoseWithCovarianceStamped message. */
  updatePose(msg: Record<string, unknown>): void {
    let pose = msg.pose as Record<string, unknown> | undefined;
    if (!pose) return;

    // PoseWithCovarianceStamped: unwrap msg.pose.pose
    if (pose.position === undefined && pose.pose !== undefined) {
      pose = pose.pose as Record<string, unknown>;
    }

    const pos = pose.position as Record<string, unknown> | undefined;
    const ori = pose.orientation as Record<string, unknown> | undefined;
    if (!pos || !ori) return;

    this.object.position.set((pos.x as number) ?? 0, (pos.y as number) ?? 0, (pos.z as number) ?? 0);

    this._quat.set((ori.x as number) ?? 0, (ori.y as number) ?? 0, (ori.z as number) ?? 0, (ori.w as number) ?? 1);
    this.object.quaternion.copy(this._quat);
  }

  dispose(): void {
    for (const g of this.allGeometries) g.dispose();
    for (const m of this.allMaterials) m.dispose();
  }
}
