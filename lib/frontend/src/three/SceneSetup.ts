/**
 * Three.js scene setup for the 3D viewer.
 *
 * Coordinate convention:
 *   ROS uses X-forward, Y-left, Z-up (right-handed).
 *   Three.js uses X-right, Y-up, Z-toward-camera (right-handed).
 *
 * We place a "rosGroup" rotated -PI/2 around X so that children
 * added in ROS coordinates render correctly in Three.js space.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Root group in ROS coordinates (Z-up). Add display objects here. */
  rosGroup: THREE.Group;
}

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x48484a);

  const scene = new THREE.Scene();

  // Camera: start looking at origin from above-right
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  camera.position.set(5, 8, 5);
  camera.lookAt(0, 0, 0);

  // Controls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(10, 20, 10);
  scene.add(directional);

  // ROS coordinate group: rotate so ROS Z-up maps to Three.js Y-up
  const rosGroup = new THREE.Group();
  rosGroup.rotation.x = -Math.PI / 2;
  scene.add(rosGroup);

  return { scene, camera, renderer, controls, rosGroup };
}

export function resizeRenderer(ctx: SceneContext, width: number, height: number): void {
  if (width <= 0 || height <= 0) return;
  ctx.renderer.setSize(width, height, false);
  ctx.camera.aspect = width / height;
  ctx.camera.updateProjectionMatrix();
}

export function disposeScene(ctx: SceneContext): void {
  ctx.controls.dispose();
  ctx.renderer.dispose();
}
