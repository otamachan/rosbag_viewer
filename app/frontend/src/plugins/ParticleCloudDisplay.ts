/**
 * Renders a nav2_msgs/ParticleCloud as instanced arrows with
 * per-particle coloring based on weight.
 *
 * Weight → color mapping: each particle's weight is normalised
 * against the maximum weight in the cloud, then used to lerp
 * the base color's lightness (dark = low weight, bright = high).
 */

import * as THREE from "three";

const DEFAULT_COLOR = 0x2196f3;
const SHAFT_RADIUS = 0.02;
const SHAFT_LENGTH = 0.35;
const HEAD_RADIUS = 0.06;
const HEAD_LENGTH = 0.15;
const INITIAL_CAPACITY = 128;

export class ParticleCloudDisplay {
  readonly object: THREE.Group;

  private mesh: THREE.InstancedMesh | null = null;
  private arrowGeom: THREE.BufferGeometry;
  private material: THREE.MeshPhongMaterial;
  private capacity = 0;
  private baseColor: THREE.Color;
  private arrowScale = 1;

  private readonly _dummy = new THREE.Object3D();
  private readonly _quat = new THREE.Quaternion();
  private readonly _color = new THREE.Color();

  constructor(color?: number) {
    this.object = new THREE.Group();
    this.baseColor = new THREE.Color(color ?? DEFAULT_COLOR);

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

    this.material = new THREE.MeshPhongMaterial({
      color: 0xffffff,
    });

    this.ensureCapacity(INITIAL_CAPACITY);
  }

  setColor(color: number): void {
    this.baseColor.set(color);
  }

  setLineWidth(width: number): void {
    this.arrowScale = width;
  }

  setOpacity(opacity: number): void {
    this.material.opacity = opacity;
    this.material.transparent = opacity < 1;
  }

  private ensureCapacity(count: number): void {
    if (this.mesh && this.capacity >= count) return;

    const newCap = Math.max(count, this.capacity * 2, INITIAL_CAPACITY);
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.dispose();
    }
    this.mesh = new THREE.InstancedMesh(this.arrowGeom, this.material, newCap);
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(newCap * 3), 3);
    this.object.add(this.mesh);
    this.capacity = newCap;
  }

  updateParticleCloud(msg: Record<string, unknown>): void {
    const particles = msg.particles as Record<string, unknown>[] | undefined;
    if (!particles || !Array.isArray(particles) || particles.length === 0) {
      if (this.mesh) this.mesh.count = 0;
      return;
    }

    const count = particles.length;
    this.ensureCapacity(count);
    if (!this.mesh) return;

    // Find max weight for normalization
    let maxWeight = 0;
    for (let i = 0; i < count; i++) {
      const w = (particles[i].weight as number) ?? 0;
      if (w > maxWeight) maxWeight = w;
    }

    const dummy = this._dummy;
    const quat = this._quat;
    const col = this._color;
    const base = this.baseColor;

    for (let i = 0; i < count; i++) {
      const particle = particles[i];
      const pose = particle.pose as Record<string, unknown> | undefined;
      const pos = pose?.position as Record<string, unknown> | undefined;
      const ori = pose?.orientation as Record<string, unknown> | undefined;

      const x = (pos?.x as number) ?? 0;
      const y = (pos?.y as number) ?? 0;
      const z = (pos?.z as number) ?? 0;

      dummy.position.set(x, y, z);
      dummy.scale.setScalar(this.arrowScale);

      if (ori) {
        quat.set((ori.x as number) ?? 0, (ori.y as number) ?? 0, (ori.z as number) ?? 0, (ori.w as number) ?? 1);
        dummy.quaternion.copy(quat);
      }

      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);

      // Per-instance color based on weight
      const w = (particle.weight as number) ?? 0;
      const t = maxWeight > 0 ? w / maxWeight : 1;
      col.copy(base).lerp(new THREE.Color(0x000000), 1 - t);
      this.mesh.setColorAt(i, col);
    }

    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.dispose();
    }
    this.arrowGeom.dispose();
    this.material.dispose();
  }
}

function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];

  for (const g of geoms) {
    const pos = g.getAttribute("position");
    const norm = g.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (norm) {
        normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      }
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length > 0) {
    merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  }
  return merged;
}
