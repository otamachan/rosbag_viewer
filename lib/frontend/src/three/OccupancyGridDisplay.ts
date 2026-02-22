/**
 * Renders a nav_msgs/OccupancyGrid as a textured plane in 3D space.
 *
 * rviz2-style color scheme (map display):
 *   -1 (unknown) → #CDCDCD (medium gray)
 *    0 (free)    → #FFFFFF (white)
 *  100 (occupied) → #000000 (black)
 *  in-between    → linear interpolation
 */

import * as THREE from "three";

export class OccupancyGridDisplay {
  readonly object: THREE.Group;

  private mesh: THREE.Mesh | null = null;
  private texture: THREE.DataTexture | null = null;
  private material: THREE.MeshBasicMaterial;
  private lastWidth = 0;
  private lastHeight = 0;
  /** Reusable RGBA buffer — only reallocated when grid size changes. */
  private rgbaBuf: Uint8Array | null = null;

  constructor() {
    this.object = new THREE.Group();
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  setColor(_color: number): void {
    // OccupancyGrid uses its own color scheme; no-op
  }

  setLineWidth(_width: number): void {
    // No-op
  }

  setResolution(_width: number, _height: number): void {
    // No-op
  }

  setOpacity(opacity: number): void {
    this.material.opacity = opacity;
    this.material.transparent = opacity < 1;
    this.material.needsUpdate = true;
  }

  /** Update from a decoded nav_msgs/OccupancyGrid message. */
  updateOccupancyGrid(msg: Record<string, unknown>): void {
    const info = msg.info as Record<string, unknown> | undefined;
    const rawData = msg.data;
    if (!info || !rawData) return;

    const width = (info.width as number) ?? 0;
    const height = (info.height as number) ?? 0;
    const resolution = (info.resolution as number) ?? 0.05;

    if (width === 0 || height === 0) return;

    let cells: ArrayLike<number>;
    if (rawData instanceof Int8Array || rawData instanceof Uint8Array) {
      cells = rawData;
    } else if (Array.isArray(rawData)) {
      cells = rawData as number[];
    } else {
      return;
    }

    const expectedLen = width * height;
    if (cells.length < expectedLen) return;

    // Reuse RGBA buffer — only reallocate when grid size changes
    const neededLen = expectedLen * 4;
    if (!this.rgbaBuf || this.rgbaBuf.length < neededLen) {
      this.rgbaBuf = new Uint8Array(neededLen);
    }
    const rgba = this.rgbaBuf;

    // Build RGBA texture data (rviz2 "map" color scheme)
    for (let i = 0; i < expectedLen; i++) {
      const v = cells[i] as number;
      const idx = i * 4;
      if (v < 0) {
        rgba[idx] = 205;
        rgba[idx + 1] = 205;
        rgba[idx + 2] = 205;
        rgba[idx + 3] = 255;
      } else {
        const c = 255 - (((Math.min(v, 100) * 255 + 50) / 100) | 0);
        rgba[idx] = c;
        rgba[idx + 1] = c;
        rgba[idx + 2] = c;
        rgba[idx + 3] = 255;
      }
    }

    if (width !== this.lastWidth || height !== this.lastHeight) {
      this.disposeInternals();

      this.texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
      this.texture.magFilter = THREE.NearestFilter;
      this.texture.minFilter = THREE.NearestFilter;
      this.texture.needsUpdate = true;

      this.material.map = this.texture;
      this.material.needsUpdate = true;

      const worldW = width * resolution;
      const worldH = height * resolution;
      const geom = new THREE.PlaneGeometry(worldW, worldH);
      this.mesh = new THREE.Mesh(geom, this.material);
      this.object.add(this.mesh);

      this.lastWidth = width;
      this.lastHeight = height;
    } else if (this.texture) {
      (this.texture.image.data as Uint8Array).set(rgba);
      this.texture.needsUpdate = true;
    }

    // Position based on origin pose
    if (this.mesh) {
      const origin = info.origin as Record<string, unknown> | undefined;
      const pos = origin?.position as Record<string, unknown> | undefined;
      const ori = origin?.orientation as Record<string, unknown> | undefined;

      const ox = (pos?.x as number) ?? 0;
      const oy = (pos?.y as number) ?? 0;
      const oz = (pos?.z as number) ?? 0;

      const worldW = width * resolution;
      const worldH = height * resolution;

      // Origin is bottom-left of cell (0,0); plane is centered → offset by half
      this.mesh.position.set(ox + worldW / 2, oy + worldH / 2, oz);

      if (ori) {
        this.mesh.quaternion.set(
          (ori.x as number) ?? 0,
          (ori.y as number) ?? 0,
          (ori.z as number) ?? 0,
          (ori.w as number) ?? 1,
        );
      }
    }
  }

  private disposeInternals(): void {
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
  }

  dispose(): void {
    this.disposeInternals();
    this.material.dispose();
  }
}
