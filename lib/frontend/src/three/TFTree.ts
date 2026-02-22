/**
 * TF (Transform) tree data structure.
 *
 * Stores parent-child frame relationships and computes the transform chain
 * from any frame to the fixed frame. Uses THREE.js math types for
 * efficient matrix composition without React dependency.
 */

import * as THREE from "three";

interface TFFrame {
  parent: string;
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
  rw: number;
  isStatic: boolean;
}

const MAX_CHAIN_DEPTH = 32;

// Reusable temporaries for getTransformToFixed
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _localMat = new THREE.Matrix4();

export class TFTree {
  private frames = new Map<string, TFFrame>();
  fixedFrame = "";

  /** Insert or update a transform from parent to child. */
  updateTransform(
    parent: string,
    child: string,
    translation: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number },
    isStatic: boolean,
  ): void {
    this.frames.set(child, {
      parent,
      tx: translation.x,
      ty: translation.y,
      tz: translation.z,
      rx: rotation.x,
      ry: rotation.y,
      rz: rotation.z,
      rw: rotation.w,
      isStatic,
    });
  }

  /** Clear dynamic (/tf) transforms, keeping /tf_static. */
  clearDynamic(): void {
    for (const [key, frame] of this.frames) {
      if (!frame.isStatic) {
        this.frames.delete(key);
      }
    }
  }

  /** Clear all transforms. */
  clear(): void {
    this.frames.clear();
  }

  /** Return all known frame names (child_frame_ids). */
  getFrameNames(): string[] {
    const names = new Set<string>();
    for (const [child, frame] of this.frames) {
      names.add(child);
      names.add(frame.parent);
    }
    return Array.from(names).sort();
  }

  /**
   * Compute the transform from `frameId` to `fixedFrame` and write it into `outMatrix`.
   * Returns true if the chain was successfully resolved, false otherwise.
   *
   * The resulting matrix transforms points in `frameId` coordinates to `fixedFrame` coordinates.
   */
  getTransformToFixed(frameId: string, outMatrix: THREE.Matrix4): boolean {
    if (!this.fixedFrame || frameId === this.fixedFrame) {
      outMatrix.identity();
      return frameId === this.fixedFrame || !this.fixedFrame;
    }

    // Build chain from frameId up to fixedFrame
    // We accumulate: T_fixed_to_frame = T_parent_to_child * T_grandparent_to_parent * ...
    // Actually we need T_fixedFrame<-frameId = T_fixedFrame<-...<-parent * T_parent<-child
    // Each frame stores T_parent<-child (the transform of child in parent's frame)
    // So T_fixed<-frameId = T_fixed<-...parent * ... * T_parent<-frameId
    // We walk from frameId upward, accumulating left-multiplied transforms.

    outMatrix.identity();
    let current = frameId;
    const visited = new Set<string>();

    for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
      if (current === this.fixedFrame) return true;
      if (visited.has(current)) return false; // loop
      visited.add(current);

      const frame = this.frames.get(current);
      if (!frame) return false; // broken chain

      // Local transform: parent <- current
      _pos.set(frame.tx, frame.ty, frame.tz);
      _quat.set(frame.rx, frame.ry, frame.rz, frame.rw);
      _localMat.compose(_pos, _quat, _scale);

      // outMatrix = localMat * outMatrix  (prepend)
      outMatrix.premultiply(_localMat);
      current = frame.parent;
    }

    return false; // exceeded max depth
  }
}
