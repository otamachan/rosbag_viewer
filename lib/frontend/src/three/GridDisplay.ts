/**
 * Ground grid on the ROS XY plane (Z=0), matching rviz2 defaults.
 *
 * rviz2: 10×10 cells, cell_size=1m → 10m×10m grid,
 *        uniform color RGB(128,128,128), alpha 0.5, no center-line highlight.
 *
 * Since rosGroup is rotated, this appears as a floor grid in Three.js.
 */

import * as THREE from "three";

const GRID_COLOR = 0x808080; // RGB(128,128,128) — rviz2 Qt::gray

export class GridDisplay {
  readonly object: THREE.GridHelper;

  constructor(size = 10, divisions = 10) {
    // GridHelper(totalSize, divisions, centerColor, gridColor)
    // rviz2 uses uniform color for all lines, so both colors are the same.
    this.object = new THREE.GridHelper(size, divisions, GRID_COLOR, GRID_COLOR);
    this.object.rotation.x = Math.PI / 2;

    // rviz2 default alpha = 0.5
    const mat = this.object.material as THREE.Material;
    mat.opacity = 0.5;
    mat.transparent = true;
    mat.depthWrite = false;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
