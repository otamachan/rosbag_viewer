/**
 * Renders a geometry_msgs/PoseArray as multiple small arrows
 * using InstancedMesh for performance.
 *
 * All coordinates are in ROS frame (added to rosGroup).
 *
 * The InstancedMesh is pre-allocated and reused. It only gets recreated
 * when the count exceeds current capacity.
 */

import * as THREE from "three";

const DEFAULT_COLOR = 0x2196f3;
const SHAFT_RADIUS = 0.02;
const SHAFT_LENGTH = 0.35;
const HEAD_RADIUS = 0.06;
const HEAD_LENGTH = 0.15;
const INITIAL_CAPACITY = 128;

export class PoseArrayDisplay {
  readonly object: THREE.Group;

  private mesh: THREE.InstancedMesh | null = null;
  private arrowGeom: THREE.BufferGeometry;
  private material: THREE.MeshPhongMaterial;
  /** Current allocated capacity of the InstancedMesh. */
  private capacity = 0;

  // Reusable temporaries to avoid per-frame allocations
  private readonly _dummy = new THREE.Object3D();
  private readonly _quat = new THREE.Quaternion();

  constructor(color?: number) {
    this.object = new THREE.Group();

    // Build combined arrow geometry (shaft + head)
    const shaft = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 6);
    shaft.rotateZ(-Math.PI / 2);
    shaft.translate(SHAFT_LENGTH / 2, 0, 0);

    const head = new THREE.ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 6);
    head.rotateZ(-Math.PI / 2);
    head.translate(SHAFT_LENGTH + HEAD_LENGTH / 2, 0, 0);

    this.arrowGeom = mergeGeometries([shaft, head]);
    shaft.dispose();
    head.dispose();

    this.material = new THREE.MeshPhongMaterial({ color: color ?? DEFAULT_COLOR });

    // Pre-allocate mesh
    this.ensureCapacity(INITIAL_CAPACITY);
  }

  setColor(color: number): void {
    this.material.color.set(color);
  }

  setLineWidth(width: number): void {
    // PoseArray uses meshes, so scale arrows proportionally
    const s = width / 2; // default linewidth=2 → scale=1
    this.object.scale.setScalar(s);
  }

  setResolution(_width: number, _height: number): void {
    // No-op: PoseArray uses meshes, not LineMaterial
  }

  setOpacity(opacity: number): void {
    this.material.opacity = opacity;
    this.material.transparent = opacity < 1;
  }

  /** Ensure InstancedMesh can hold at least `count` instances. */
  private ensureCapacity(count: number): void {
    if (this.mesh && this.capacity >= count) return;

    const newCap = Math.max(count, this.capacity * 2, INITIAL_CAPACITY);
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.dispose();
    }
    this.mesh = new THREE.InstancedMesh(this.arrowGeom, this.material, newCap);
    this.mesh.count = 0;
    this.object.add(this.mesh);
    this.capacity = newCap;
  }

  /** Update from a decoded geometry_msgs/PoseArray message. */
  updatePoseArray(msg: Record<string, unknown>): void {
    const poses = msg.poses as Record<string, unknown>[] | undefined;
    if (!poses || !Array.isArray(poses) || poses.length === 0) {
      if (this.mesh) this.mesh.count = 0;
      return;
    }

    const count = poses.length;
    this.ensureCapacity(count);
    if (!this.mesh) return;

    const dummy = this._dummy;
    const quat = this._quat;

    for (let i = 0; i < count; i++) {
      const pose = poses[i];
      const pos = pose.position as Record<string, unknown> | undefined;
      const ori = pose.orientation as Record<string, unknown> | undefined;

      const x = (pos?.x as number) ?? 0;
      const y = (pos?.y as number) ?? 0;
      const z = (pos?.z as number) ?? 0;

      dummy.position.set(x, y, z);

      if (ori) {
        quat.set((ori.x as number) ?? 0, (ori.y as number) ?? 0, (ori.z as number) ?? 0, (ori.w as number) ?? 1);
        dummy.quaternion.copy(quat);
      }

      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }

    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.dispose();
    }
    this.arrowGeom.dispose();
    this.material.dispose();
  }
}

/**
 * Simple geometry merge (concatenate vertex/index buffers).
 * Replaces the deprecated THREE.BufferGeometryUtils.mergeBufferGeometries
 * for our simple case of two non-indexed geometries.
 */
function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];

  for (const g of geoms) {
    // Expand indexed geometry so vertex order matches triangle faces
    const expanded = g.index ? g.toNonIndexed() : g;
    const pos = expanded.getAttribute("position");
    const norm = expanded.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (norm) {
        normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      }
    }
    if (expanded !== g) expanded.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length > 0) {
    merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  }
  return merged;
}
