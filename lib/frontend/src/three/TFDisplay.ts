/**
 * Renders TF frame axes from a TFTree.
 *
 * Each frame in the tree is rendered as a small set of 3 RGB axes
 * at the frame's position/orientation in fixed-frame coordinates
 * using InstancedMesh.
 */

import * as THREE from "three";
import type { TFTree } from "./TFTree.ts";

const AX_LENGTH = 0.5;
const AX_RADIUS = 0.02;
const INITIAL_CAPACITY = 64;

export class TFDisplay {
  readonly object: THREE.Group;

  // We render 3 InstancedMeshes (one per axis: X=red, Y=green, Z=blue)
  private xMesh: THREE.InstancedMesh | null = null;
  private yMesh: THREE.InstancedMesh | null = null;
  private zMesh: THREE.InstancedMesh | null = null;

  private axGeom: THREE.CylinderGeometry;
  private xMat: THREE.MeshPhongMaterial;
  private yMat: THREE.MeshPhongMaterial;
  private zMat: THREE.MeshPhongMaterial;

  private capacity = 0;
  private axScale = 1;

  // Reusable temporaries
  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3(1, 1, 1);
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _axisQuat = new THREE.Quaternion();
  private readonly _frameMat = new THREE.Matrix4();

  // Pre-computed axis rotations (cylinder is Y-up, need to rotate to X/Y/Z)
  private readonly _xRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2); // Y→X
  private readonly _yRot = new THREE.Quaternion(); // identity (already Y)
  private readonly _zRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); // Y→Z

  constructor() {
    this.object = new THREE.Group();

    this.axGeom = new THREE.CylinderGeometry(AX_RADIUS, AX_RADIUS, AX_LENGTH, 6);
    // Translate so cylinder starts at origin and extends along +Y
    this.axGeom.translate(0, AX_LENGTH / 2, 0);

    this.xMat = new THREE.MeshPhongMaterial({ color: 0xff0000 });
    this.yMat = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
    this.zMat = new THREE.MeshPhongMaterial({ color: 0x0000ff });

    this.ensureCapacity(INITIAL_CAPACITY);
  }

  setColor(_color: number): void {
    // TF always uses RGB for axes — ignore color setting
  }

  setLineWidth(width: number): void {
    this.axScale = width;
  }

  setResolution(_width: number, _height: number): void {
    // No-op
  }

  setOpacity(opacity: number): void {
    for (const m of [this.xMat, this.yMat, this.zMat]) {
      m.opacity = opacity;
      m.transparent = opacity < 1;
    }
  }

  private ensureCapacity(count: number): void {
    if (this.capacity >= count) return;

    const newCap = Math.max(count, this.capacity * 2, INITIAL_CAPACITY);

    if (this.xMesh) {
      this.object.remove(this.xMesh);
      this.xMesh.dispose();
    }
    if (this.yMesh) {
      this.object.remove(this.yMesh);
      this.yMesh.dispose();
    }
    if (this.zMesh) {
      this.object.remove(this.zMesh);
      this.zMesh.dispose();
    }

    this.xMesh = new THREE.InstancedMesh(this.axGeom, this.xMat, newCap);
    this.yMesh = new THREE.InstancedMesh(this.axGeom, this.yMat, newCap);
    this.zMesh = new THREE.InstancedMesh(this.axGeom, this.zMat, newCap);
    // Disable frustum culling — instances span the entire scene
    this.xMesh.frustumCulled = false;
    this.yMesh.frustumCulled = false;
    this.zMesh.frustumCulled = false;
    this.xMesh.count = 0;
    this.yMesh.count = 0;
    this.zMesh.count = 0;

    this.object.add(this.xMesh);
    this.object.add(this.yMesh);
    this.object.add(this.zMesh);
    this.capacity = newCap;
  }

  /**
   * Update axes from the TFTree.
   * Renders each frame at its fixed-frame position/orientation.
   */
  updateFromTree(tfTree: TFTree): void {
    const frameNames = tfTree.getFrameNames();

    // If no fixed frame is set, show nothing
    if (!tfTree.fixedFrame) {
      if (this.xMesh) this.xMesh.count = 0;
      if (this.yMesh) this.yMesh.count = 0;
      if (this.zMesh) this.zMesh.count = 0;
      return;
    }

    // Collect frames that can be resolved to fixed frame
    const resolved: THREE.Matrix4[] = [];
    for (const name of frameNames) {
      if (tfTree.getTransformToFixed(name, this._frameMat)) {
        resolved.push(this._frameMat.clone());
      }
    }

    const count = resolved.length;
    this.ensureCapacity(count);
    if (!this.xMesh || !this.yMesh || !this.zMesh) return;

    const s = this.axScale;
    for (let i = 0; i < count; i++) {
      const mat = resolved[i];

      // Decompose to get position and rotation
      mat.decompose(this._pos, this._quat, this._scale);

      // X axis: frame rotation * xAxisRot
      this._axisQuat.copy(this._quat).multiply(this._xRot);
      this._mat4.compose(this._pos, this._axisQuat, this._scale.set(s, s, s));
      this.xMesh.setMatrixAt(i, this._mat4);

      // Y axis: frame rotation * yAxisRot (identity)
      this._axisQuat.copy(this._quat).multiply(this._yRot);
      this._mat4.compose(this._pos, this._axisQuat, this._scale.set(s, s, s));
      this.yMesh.setMatrixAt(i, this._mat4);

      // Z axis: frame rotation * zAxisRot
      this._axisQuat.copy(this._quat).multiply(this._zRot);
      this._mat4.compose(this._pos, this._axisQuat, this._scale.set(s, s, s));
      this.zMesh.setMatrixAt(i, this._mat4);
    }

    this.xMesh.count = count;
    this.yMesh.count = count;
    this.zMesh.count = count;
    this.xMesh.instanceMatrix.needsUpdate = true;
    this.yMesh.instanceMatrix.needsUpdate = true;
    this.zMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.xMesh) this.xMesh.dispose();
    if (this.yMesh) this.yMesh.dispose();
    if (this.zMesh) this.zMesh.dispose();
    this.axGeom.dispose();
    this.xMat.dispose();
    this.yMat.dispose();
    this.zMat.dispose();
  }
}
