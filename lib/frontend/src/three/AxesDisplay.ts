/**
 * RGB axes indicator (X=red, Y=green, Z=blue) at the origin.
 * Rendered in ROS coordinates inside rosGroup.
 */

import * as THREE from "three";

export class AxesDisplay {
  readonly object: THREE.AxesHelper;

  constructor(size = 1.5) {
    this.object = new THREE.AxesHelper(size);
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
