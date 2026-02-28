/**
 * Renders a nav_msgs/OccupancyGrid as a textured plane in 3D space.
 *
 * Default rviz2-style color scheme (map display):
 *   -1 (unknown) → #CDCDCD (medium gray)
 *    0 (free)    → #FFFFFF (white)
 *  100 (occupied) → #000000 (black)
 *  in-between    → linear interpolation
 *
 * A custom 256×4 RGBA color table can be injected via the constructor
 * so that the same display class works for distance maps, cost maps, etc.
 */

import * as THREE from "three";

/**
 * Build the default rviz2-style OccupancyGrid color table (256 entries × RGBA).
 *
 * Index mapping (data arrives as int8, reinterpreted as uint8):
 *  - 0xFF (= -1 signed) → (205, 205, 205, 255) unknown
 *  - 0..100             → white→black linear interpolation
 *  - 101..254           → black
 */
export function buildOccupancyColorTable(): Uint8Array {
  const table = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const off = i * 4;
    if (i === 0xff) {
      // -1 signed → unknown
      table[off] = 205;
      table[off + 1] = 205;
      table[off + 2] = 205;
      table[off + 3] = 255;
    } else if (i <= 100) {
      const c = 255 - (((i * 255 + 50) / 100) | 0);
      table[off] = c;
      table[off + 1] = c;
      table[off + 2] = c;
      table[off + 3] = 255;
    } else {
      // 101..254 → black
      table[off] = 0;
      table[off + 1] = 0;
      table[off + 2] = 0;
      table[off + 3] = 255;
    }
  }
  return table;
}

export class OccupancyGridDisplay {
  readonly object: THREE.Group;

  private mesh: THREE.Mesh | null = null;
  private texture: THREE.DataTexture | null = null;
  private material: THREE.MeshBasicMaterial;
  private lastWidth = 0;
  private lastHeight = 0;
  /** Reusable RGBA buffer — only reallocated when grid size changes. */
  private rgbaBuf: Uint8Array | null = null;
  private readonly colorTable: Uint8Array;

  constructor(colorTable?: Uint8Array) {
    this.colorTable = colorTable ?? buildOccupancyColorTable();
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

    // Build RGBA texture data via color table lookup
    const ct = this.colorTable;
    for (let i = 0; i < expectedLen; i++) {
      const src = ((cells[i] as number) & 0xff) * 4;
      const dst = i * 4;
      rgba[dst] = ct[src] as number;
      rgba[dst + 1] = ct[src + 1] as number;
      rgba[dst + 2] = ct[src + 2] as number;
      rgba[dst + 3] = ct[src + 3] as number;
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
