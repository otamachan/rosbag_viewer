/**
 * Renders visualization_msgs/MarkerArray in a 3D scene.
 *
 * Supported marker types:
 *   ARROW(0), CUBE(1), SPHERE(2), CYLINDER(3),
 *   LINE_STRIP(4), LINE_LIST(5), CUBE_LIST(6),
 *   SPHERE_LIST(7), POINTS(8)
 *
 * Each marker is keyed by `ns + "\0" + id` and managed via the action field:
 *   ADD(0)/MODIFY(1) → create or update
 *   DELETE(2)        → remove one marker
 *   DELETEALL(3)     → remove all markers
 */

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

// Marker type constants
const ARROW = 0;
const CUBE = 1;
const SPHERE = 2;
const CYLINDER = 3;
const LINE_STRIP = 4;
const LINE_LIST = 5;
const CUBE_LIST = 6;
const SPHERE_LIST = 7;
const POINTS = 8;

// Marker action constants
const ADD = 0;
// const MODIFY = 1; // treated same as ADD
const DELETE = 2;
const DELETEALL = 3;

// Arrow geometry constants (same as PoseArrayDisplay)
const SHAFT_RADIUS = 0.02;
const SHAFT_LENGTH = 0.35;
const HEAD_LENGTH = 0.15;

interface MarkerEntry {
  object: THREE.Object3D;
  type: number;
  ns: string;
  dispose: () => void;
}

type RosMsg = Record<string, unknown>;
type RosColor = { r: number; g: number; b: number; a: number };
type RosPoint = { x: number; y: number; z: number };

export class MarkerArrayDisplay {
  readonly object: THREE.Group;

  private markers = new Map<string, MarkerEntry>();
  private nsGroups = new Map<string, THREE.Group>();
  private resolution = new THREE.Vector2(800, 600);

  // Cached shared geometries (created lazily, for non-arrow mesh types)
  private _boxGeom: THREE.BoxGeometry | null = null;
  private _sphereGeom: THREE.SphereGeometry | null = null;
  private _cylinderGeom: THREE.CylinderGeometry | null = null;

  // Reusable temporaries
  private readonly _dummy = new THREE.Object3D();
  private readonly _quat = new THREE.Quaternion();
  private readonly _color = new THREE.Color();

  constructor() {
    this.object = new THREE.Group();
  }

  // ── Shared geometry getters ──────────────────────────────────────────

  private get boxGeom(): THREE.BoxGeometry {
    if (!this._boxGeom) this._boxGeom = new THREE.BoxGeometry(1, 1, 1);
    return this._boxGeom;
  }

  private get sphereGeom(): THREE.SphereGeometry {
    if (!this._sphereGeom) this._sphereGeom = new THREE.SphereGeometry(0.5, 16, 16);
    return this._sphereGeom;
  }

  private get cylinderGeom(): THREE.CylinderGeometry {
    if (!this._cylinderGeom) {
      this._cylinderGeom = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
      // Rotate so cylinder axis aligns with X (ROS convention)
      this._cylinderGeom.rotateZ(-Math.PI / 2);
    }
    return this._cylinderGeom;
  }

  // ── Public API ───────────────────────────────────────────────────────

  setResolution(width: number, height: number): void {
    this.resolution.set(width, height);
    // Update existing LINE_STRIP / LINE_LIST markers
    for (const entry of this.markers.values()) {
      if (entry.type === LINE_STRIP || entry.type === LINE_LIST) {
        entry.object.traverse((child) => {
          if (child instanceof LineSegments2) {
            (child.material as LineMaterial).resolution.set(width, height);
          }
        });
      }
    }
  }

  /** Return all namespace names currently present, sorted. */
  getNamespaces(): string[] {
    return Array.from(this.nsGroups.keys()).sort();
  }

  /** Set visibility of a namespace group. */
  setNamespaceVisible(ns: string, visible: boolean): void {
    const group = this.nsGroups.get(ns);
    if (group) group.visible = visible;
  }

  /** Read `ns:<name>` keys from settings and apply visibility. */
  applySettings(settings: Record<string, unknown>): void {
    for (const [ns, group] of this.nsGroups) {
      const key = `ns:${ns}`;
      group.visible = settings[key] !== false;
    }
  }

  update(msg: RosMsg): void {
    const markers = msg.markers as RosMsg[] | undefined;
    if (!markers || !Array.isArray(markers)) return;

    for (const marker of markers) {
      const action = (marker.action as number) ?? ADD;

      if (action === DELETEALL) {
        this.deleteAll();
        continue;
      }

      const ns = (marker.ns as string) ?? "";
      const id = (marker.id as number) ?? 0;
      const key = `${ns}\0${id}`;

      if (action === DELETE) {
        this.deleteMarker(key);
        continue;
      }

      // ADD or MODIFY
      const type = (marker.type as number) ?? 0;
      this.addOrUpdateMarker(key, ns, type, marker);
    }
  }

  dispose(): void {
    this.deleteAll();
    this._boxGeom?.dispose();
    this._sphereGeom?.dispose();
    this._cylinderGeom?.dispose();
    this._boxGeom = null;
    this._sphereGeom = null;
    this._cylinderGeom = null;
  }

  // ── Marker management ────────────────────────────────────────────────

  private getOrCreateNsGroup(ns: string): THREE.Group {
    let group = this.nsGroups.get(ns);
    if (!group) {
      group = new THREE.Group();
      this.nsGroups.set(ns, group);
      this.object.add(group);
    }
    return group;
  }

  private deleteMarker(key: string): void {
    const entry = this.markers.get(key);
    if (entry) {
      const nsGroup = this.nsGroups.get(entry.ns);
      if (nsGroup) {
        nsGroup.remove(entry.object);
        if (nsGroup.children.length === 0) {
          this.object.remove(nsGroup);
          this.nsGroups.delete(entry.ns);
        }
      }
      entry.dispose();
      this.markers.delete(key);
    }
  }

  private deleteAll(): void {
    for (const entry of this.markers.values()) {
      entry.dispose();
    }
    this.markers.clear();
    for (const nsGroup of this.nsGroups.values()) {
      this.object.remove(nsGroup);
    }
    this.nsGroups.clear();
  }

  private addOrUpdateMarker(key: string, ns: string, type: number, marker: RosMsg): void {
    // If the existing marker has a different type, remove it first
    const existing = this.markers.get(key);
    if (existing && existing.type !== type) {
      const nsGroup = this.nsGroups.get(existing.ns);
      if (nsGroup) nsGroup.remove(existing.object);
      existing.dispose();
      this.markers.delete(key);
    }

    const parent = this.getOrCreateNsGroup(ns);

    switch (type) {
      case ARROW:
        this.buildArrow(key, ns, marker, parent);
        break;
      case CUBE:
        this.buildSimpleMesh(key, ns, type, marker, this.boxGeom, parent);
        break;
      case SPHERE:
        this.buildSimpleMesh(key, ns, type, marker, this.sphereGeom, parent);
        break;
      case CYLINDER:
        this.buildSimpleMesh(key, ns, type, marker, this.cylinderGeom, parent);
        break;
      case LINE_STRIP:
        this.buildLine(key, ns, type, marker, false, parent);
        break;
      case LINE_LIST:
        this.buildLine(key, ns, type, marker, true, parent);
        break;
      case CUBE_LIST:
        this.buildInstancedList(key, ns, type, marker, this.boxGeom, parent);
        break;
      case SPHERE_LIST:
        this.buildInstancedList(key, ns, type, marker, this.sphereGeom, parent);
        break;
      case POINTS:
        this.buildPoints(key, ns, marker, parent);
        break;
      // TEXT, MESH_RESOURCE, TRIANGLE_LIST — skip
    }
  }

  // ── Builders ─────────────────────────────────────────────────────────

  private buildArrow(key: string, ns: string, marker: RosMsg, parent: THREE.Group): void {
    const points = marker.points as RosPoint[] | undefined;
    const color = marker.color as RosColor | undefined;
    const scale = marker.scale as RosPoint | undefined;
    const pose = marker.pose as RosMsg | undefined;

    // Always rebuild arrows (geometry depends on scale/points)
    const existing = this.markers.get(key);
    if (existing) {
      parent.remove(existing.object);
      existing.dispose();
      this.markers.delete(key);
    }

    if (points && points.length >= 2) {
      // Two-point arrow: scale.x = shaft diameter, scale.y = head diameter, scale.z = head length
      const start = points[0];
      const end = points[1];
      const dx = (end.x ?? 0) - (start.x ?? 0);
      const dy = (end.y ?? 0) - (start.y ?? 0);
      const dz = (end.z ?? 0) - (start.z ?? 0);
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (length < 1e-6) return;

      const shaftDiameter = scale?.x ?? SHAFT_RADIUS * 2;
      const headDiameter = scale?.y || shaftDiameter;
      const headLength = scale?.z || headDiameter;
      const shaftLength = Math.max(length - headLength, 0);

      const arrowGeom = this.makeArrowGeom(shaftDiameter / 2, shaftLength, headDiameter / 2, headLength);
      const mat = this.makeMeshMaterial(color);
      const mesh = new THREE.Mesh(arrowGeom, mat);

      const group = new THREE.Group();
      group.add(mesh);

      // Position at start, orient toward end
      group.position.set(start.x ?? 0, start.y ?? 0, start.z ?? 0);
      const dir = new THREE.Vector3(dx, dy, dz).normalize();
      group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);

      // Apply pose on top (two-point arrows still respect pose transform)
      if (pose) {
        const posePos = pose.position as RosPoint | undefined;
        const poseOri = pose.orientation as RosMsg | undefined;
        if (posePos) {
          group.position.set(
            (posePos.x ?? 0) + (start.x ?? 0),
            (posePos.y ?? 0) + (start.y ?? 0),
            (posePos.z ?? 0) + (start.z ?? 0),
          );
        }
        if (poseOri) {
          // For two-point arrows, pose orientation is typically identity; skip if so
          const qw = (poseOri.w as number) ?? 1;
          if (Math.abs(qw) < 0.9999) {
            this._quat.set((poseOri.x as number) ?? 0, (poseOri.y as number) ?? 0, (poseOri.z as number) ?? 0, qw);
            group.quaternion.premultiply(this._quat);
          }
        }
      }

      parent.add(group);
      this.markers.set(key, {
        object: group,
        type: ARROW,
        ns,
        dispose: () => {
          arrowGeom.dispose();
          mat.dispose();
        },
      });
    } else {
      // Single arrow from pose + scale
      // scale.x = total length, scale.y = shaft diameter, scale.z = head diameter (0 → scale.y)
      const totalLength = scale?.x || SHAFT_LENGTH + HEAD_LENGTH;
      const shaftDiameter = scale?.y ?? SHAFT_RADIUS * 2;
      const headDiameter = scale?.z || shaftDiameter;
      // Head length proportional to head diameter
      const headLength = headDiameter * 2;
      const shaftLength = Math.max(totalLength - headLength, 0);

      const arrowGeom = this.makeArrowGeom(shaftDiameter / 2, shaftLength, headDiameter / 2, headLength);
      const mat = this.makeMeshMaterial(color);
      const mesh = new THREE.Mesh(arrowGeom, mat);

      const group = new THREE.Group();
      group.add(mesh);

      // Apply pose (no scale on group — geometry already has correct dimensions)
      if (pose) {
        const pos = pose.position as RosPoint | undefined;
        const ori = pose.orientation as RosMsg | undefined;
        if (pos) group.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
        if (ori) {
          this._quat.set(
            (ori.x as number) ?? 0,
            (ori.y as number) ?? 0,
            (ori.z as number) ?? 0,
            (ori.w as number) ?? 1,
          );
          group.quaternion.copy(this._quat);
        }
      }

      parent.add(group);
      this.markers.set(key, {
        object: group,
        type: ARROW,
        ns,
        dispose: () => {
          arrowGeom.dispose();
          mat.dispose();
        },
      });
    }
  }

  /** Build arrow geometry (shaft cylinder + cone head) pointing along +X. */
  private makeArrowGeom(
    shaftRadius: number,
    shaftLength: number,
    headRadius: number,
    headLength: number,
  ): THREE.BufferGeometry {
    const shaft = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 6);
    shaft.rotateZ(-Math.PI / 2);
    shaft.translate(shaftLength / 2, 0, 0);

    const head = new THREE.ConeGeometry(headRadius, headLength, 6);
    head.rotateZ(-Math.PI / 2);
    head.translate(shaftLength + headLength / 2, 0, 0);

    const geom = mergeGeometries([shaft, head]);
    shaft.dispose();
    head.dispose();
    return geom;
  }

  private buildSimpleMesh(
    key: string,
    ns: string,
    type: number,
    marker: RosMsg,
    geom: THREE.BufferGeometry,
    parent: THREE.Group,
  ): void {
    const color = marker.color as RosColor | undefined;
    const pose = marker.pose as RosMsg | undefined;
    const scale = marker.scale as RosPoint | undefined;

    let entry = this.markers.get(key);
    if (!entry) {
      const mat = this.makeMeshMaterial(color);
      const mesh = new THREE.Mesh(geom, mat);
      const group = new THREE.Group();
      group.add(mesh);
      parent.add(group);
      entry = {
        object: group,
        type,
        ns,
        dispose: () => {
          mat.dispose();
        },
      };
      this.markers.set(key, entry);
    } else {
      const mesh = entry.object.children[0] as THREE.Mesh;
      if (color) {
        (mesh.material as THREE.MeshPhongMaterial).color.setRGB(color.r, color.g, color.b);
        (mesh.material as THREE.MeshPhongMaterial).opacity = color.a ?? 1;
        (mesh.material as THREE.MeshPhongMaterial).transparent = (color.a ?? 1) < 1;
      }
    }
    this.applyPoseAndScale(entry.object, pose, scale);
  }

  private buildLine(key: string, ns: string, type: number, marker: RosMsg, isList: boolean, parent: THREE.Group): void {
    const points = marker.points as RosPoint[] | undefined;
    const color = marker.color as RosColor | undefined;
    const scale = marker.scale as RosPoint | undefined;
    const colors = marker.colors as RosColor[] | undefined;

    // Always rebuild lines (geometry changes)
    const existing = this.markers.get(key);
    if (existing) {
      parent.remove(existing.object);
      existing.dispose();
    }

    if (!points || points.length < 2) return;

    const positions: number[] = [];
    const vertexColors: number[] = [];
    const hasPerVertexColor = colors && colors.length > 0;

    if (isList) {
      // LINE_LIST: pairs of points form segments
      for (let i = 0; i + 1 < points.length; i += 2) {
        const a = points[i];
        const b = points[i + 1];
        positions.push(a.x ?? 0, a.y ?? 0, a.z ?? 0);
        positions.push(b.x ?? 0, b.y ?? 0, b.z ?? 0);
        if (hasPerVertexColor) {
          const ca = colors[i] ?? color ?? { r: 1, g: 1, b: 1, a: 1 };
          const cb = colors[i + 1] ?? color ?? { r: 1, g: 1, b: 1, a: 1 };
          vertexColors.push(ca.r, ca.g, ca.b);
          vertexColors.push(cb.r, cb.g, cb.b);
        }
      }
    } else {
      // LINE_STRIP: continuous polyline
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        positions.push(p.x ?? 0, p.y ?? 0, p.z ?? 0);
        if (hasPerVertexColor) {
          const c = colors[i] ?? color ?? { r: 1, g: 1, b: 1, a: 1 };
          vertexColors.push(c.r, c.g, c.b);
        }
      }
    }

    if (positions.length < 6) return; // need at least 2 points

    const lineColor = color ? new THREE.Color(color.r, color.g, color.b) : new THREE.Color(1, 1, 1);
    const mat = new LineMaterial({
      color: hasPerVertexColor ? 0xffffff : lineColor.getHex(),
      linewidth: (scale?.x ?? 0.01) * 200, // scale.x is in meters, convert to pixel-like width
      worldUnits: false,
      vertexColors: !!hasPerVertexColor,
      transparent: (color?.a ?? 1) < 1,
      opacity: color?.a ?? 1,
    });
    mat.resolution.copy(this.resolution);

    // LINE_LIST: each pair of points is an independent segment → LineSegmentsGeometry
    // LINE_STRIP: continuous polyline → LineGeometry
    let line: LineSegments2;
    let geom: LineSegmentsGeometry;
    if (isList) {
      const g = new LineSegmentsGeometry();
      g.setPositions(positions);
      if (hasPerVertexColor) g.setColors(vertexColors);
      geom = g;
      line = new LineSegments2(g, mat);
    } else {
      const g = new LineGeometry();
      g.setPositions(positions);
      if (hasPerVertexColor) g.setColors(vertexColors);
      geom = g;
      line = new Line2(g, mat);
    }
    line.computeLineDistances();

    const group = new THREE.Group();
    group.add(line);
    parent.add(group);

    this.markers.set(key, {
      object: group,
      type,
      ns,
      dispose: () => {
        geom.dispose();
        mat.dispose();
      },
    });
  }

  private buildInstancedList(
    key: string,
    ns: string,
    type: number,
    marker: RosMsg,
    geom: THREE.BufferGeometry,
    parent: THREE.Group,
  ): void {
    const points = marker.points as RosPoint[] | undefined;
    const color = marker.color as RosColor | undefined;
    const scale = marker.scale as RosPoint | undefined;
    const colors = marker.colors as RosColor[] | undefined;

    // Always rebuild (point count can change)
    const existing = this.markers.get(key);
    if (existing) {
      parent.remove(existing.object);
      existing.dispose();
    }

    if (!points || points.length === 0) return;

    const count = points.length;
    const hasPerInstanceColor = colors && colors.length > 0;

    const mat = new THREE.MeshPhongMaterial({
      color: hasPerInstanceColor ? 0xffffff : new THREE.Color(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1),
      transparent: (color?.a ?? 1) < 1,
      opacity: color?.a ?? 1,
    });

    const mesh = new THREE.InstancedMesh(geom, mat, count);
    const dummy = this._dummy;

    const sx = scale?.x ?? 1;
    const sy = scale?.y ?? 1;
    const sz = scale?.z ?? 1;

    for (let i = 0; i < count; i++) {
      const p = points[i];
      dummy.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
      dummy.quaternion.identity();
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      if (hasPerInstanceColor) {
        const c = colors[i] ?? color ?? { r: 1, g: 1, b: 1, a: 1 };
        this._color.setRGB(c.r, c.g, c.b);
        mesh.setColorAt(i, this._color);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const group = new THREE.Group();
    group.add(mesh);
    parent.add(group);

    this.markers.set(key, {
      object: group,
      type,
      ns,
      dispose: () => {
        mesh.dispose();
        mat.dispose();
      },
    });
  }

  private buildPoints(key: string, ns: string, marker: RosMsg, parent: THREE.Group): void {
    const points = marker.points as RosPoint[] | undefined;
    const color = marker.color as RosColor | undefined;
    const scale = marker.scale as RosPoint | undefined;
    const colors = marker.colors as RosColor[] | undefined;

    // Always rebuild
    const existing = this.markers.get(key);
    if (existing) {
      parent.remove(existing.object);
      existing.dispose();
    }

    if (!points || points.length === 0) return;

    const count = points.length;
    const hasPerPointColor = colors && colors.length > 0;

    const posArr = new Float32Array(count * 3);
    let colorArr: Float32Array | null = null;
    if (hasPerPointColor) {
      colorArr = new Float32Array(count * 3);
    }

    for (let i = 0; i < count; i++) {
      const p = points[i];
      posArr[i * 3] = p.x ?? 0;
      posArr[i * 3 + 1] = p.y ?? 0;
      posArr[i * 3 + 2] = p.z ?? 0;

      if (colorArr && hasPerPointColor) {
        const c = colors[i] ?? color ?? { r: 1, g: 1, b: 1, a: 1 };
        colorArr[i * 3] = c.r;
        colorArr[i * 3 + 1] = c.g;
        colorArr[i * 3 + 2] = c.b;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    if (colorArr) {
      geom.setAttribute("color", new THREE.BufferAttribute(colorArr, 3));
    }

    const mat = new THREE.PointsMaterial({
      color: hasPerPointColor ? 0xffffff : new THREE.Color(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1),
      size: (scale?.x ?? 0.01) * 200 || 3,
      sizeAttenuation: false,
      vertexColors: !!hasPerPointColor,
      transparent: (color?.a ?? 1) < 1,
      opacity: color?.a ?? 1,
    });

    const obj = new THREE.Points(geom, mat);
    const group = new THREE.Group();
    group.add(obj);
    parent.add(group);

    this.markers.set(key, {
      object: group,
      type: POINTS,
      ns,
      dispose: () => {
        geom.dispose();
        mat.dispose();
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private makeMeshMaterial(color: RosColor | undefined): THREE.MeshPhongMaterial {
    return new THREE.MeshPhongMaterial({
      color: new THREE.Color(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1),
      transparent: (color?.a ?? 1) < 1,
      opacity: color?.a ?? 1,
    });
  }

  private applyPoseAndScale(obj: THREE.Object3D, pose: RosMsg | undefined, scale: RosPoint | undefined): void {
    if (pose) {
      const pos = pose.position as RosPoint | undefined;
      const ori = pose.orientation as RosMsg | undefined;
      if (pos) obj.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
      if (ori) {
        this._quat.set((ori.x as number) ?? 0, (ori.y as number) ?? 0, (ori.z as number) ?? 0, (ori.w as number) ?? 1);
        obj.quaternion.copy(this._quat);
      }
    }
    if (scale) {
      obj.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
    }
  }
}

/**
 * Simple geometry merge (concatenate vertex/index buffers).
 * Same pattern as PoseArrayDisplay.
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
