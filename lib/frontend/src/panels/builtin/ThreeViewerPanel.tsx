/**
 * 3D viewer panel using Three.js.
 *
 * Renders spatial message types simultaneously for all visible topics
 * using the plugin system. Each plugin provides a ThreeDisplay factory.
 *
 * TF topics (tf2_msgs/TFMessage, tf/tfMessage) are handled separately
 * via TFTree + shared TFDisplay — they are not plugins.
 *
 * All displays are placed under per-frame tfFrameGroups whose matrices
 * are set from the TFTree so that everything renders in fixed-frame coords.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { DisplayPlugin, ThreeDisplay } from "../../plugins/DisplayPlugin.ts";
import { findPlugin } from "../../plugins/PluginRegistry.ts";
import { AxesDisplay } from "../../three/AxesDisplay.ts";
import { GridDisplay } from "../../three/GridDisplay.ts";
import type { SceneContext } from "../../three/SceneSetup.ts";
import { createScene, disposeScene, resizeRenderer } from "../../three/SceneSetup.ts";
import { TFDisplay } from "../../three/TFDisplay.ts";
import { TFTree } from "../../three/TFTree.ts";
import type { MultiTopicPanelProps } from "../PanelProps.ts";
import styles from "./ThreeViewerPanel.module.css";

function isTFType(topicType: string): boolean {
  return topicType === "tf2_msgs/TFMessage" || topicType === "tf/tfMessage";
}

/** Extract header.frame_id from a ROS message. */
function extractFrameId(msg: Record<string, unknown>): string {
  const header = msg.header as Record<string, unknown> | undefined;
  if (header) return (header.frame_id as string) ?? "";
  // OccupancyGrid: info.header.frame_id
  const info = msg.info as Record<string, unknown> | undefined;
  if (info) {
    const h = info.header as Record<string, unknown> | undefined;
    if (h) return (h.frame_id as string) ?? "";
  }
  return "";
}

interface DisplayEntry {
  topicName: string;
  topicType: string;
  plugin: DisplayPlugin;
  display: ThreeDisplay;
  tfFrameGroup: THREE.Group;
  frameId: string;
  settings: Record<string, unknown>;
}

interface SceneState {
  ctx: SceneContext;
  grid: GridDisplay;
  axes: AxesDisplay;
  rafId: number;
  dirty: boolean;
}

// Reusable matrix for TF transform application
const _tempMatrix = new THREE.Matrix4();
const _identityMatrix = new THREE.Matrix4();

export function ThreeViewerPanel(props: MultiTopicPanelProps) {
  const visibleTopics = props.visibleTopics ?? [];
  const displaySettings = props.topicDisplaySettings ?? new Map<string, Record<string, unknown>>();
  const { fixedFrame, seekVersion, onAvailableFramesChange } = props;

  const [topDown, setTopDown] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const displaysRef = useRef<Map<string, DisplayEntry>>(new Map());
  const resolutionRef = useRef(new THREE.Vector2(1, 1));

  // TF tree instance (persists across renders)
  const tfTreeRef = useRef(new TFTree());
  // Shared TFDisplay for rendering all frame axes
  const sharedTFDisplayRef = useRef<{ display: TFDisplay; group: THREE.Group } | null>(null);

  // Update fixedFrame on the tree when prop changes
  useEffect(() => {
    tfTreeRef.current.fixedFrame = fixedFrame;
    // Re-apply transforms immediately
    const scene = sceneRef.current;
    if (scene) scene.dirty = true;
  }, [fixedFrame]);

  // Clear dynamic TFs on seek
  const prevSeekVersionRef = useRef(seekVersion);
  useEffect(() => {
    if (seekVersion !== prevSeekVersionRef.current) {
      prevSeekVersionRef.current = seekVersion;
      tfTreeRef.current.clearDynamic();
    }
  }, [seekVersion]);

  // Initialize Three.js scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = createScene(canvas);
    const grid = new GridDisplay();
    const axes = new AxesDisplay(1.5);

    ctx.rosGroup.add(grid.object);
    ctx.rosGroup.add(axes.object);

    // Create shared TFDisplay for frame axes visualization
    const tfDisplay = new TFDisplay();
    const tfGroup = new THREE.Group();
    tfGroup.matrixAutoUpdate = false;
    tfGroup.add(tfDisplay.object);
    ctx.rosGroup.add(tfGroup);
    sharedTFDisplayRef.current = { display: tfDisplay, group: tfGroup };

    let rafId = 0;
    let dirty = true;
    // Mark dirty on camera changes (orbit, zoom, pan)
    ctx.controls.addEventListener("change", () => {
      dirty = true;
    });
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      ctx.controls.update();
      // Check scene-level dirty flag (set by display updates)
      const state = sceneRef.current;
      if (state?.dirty) {
        dirty = true;
        state.dirty = false;
      }
      if (dirty) {
        ctx.renderer.render(ctx.scene, ctx.camera);
        dirty = false;
      }
    };
    rafId = requestAnimationFrame(animate);

    sceneRef.current = { ctx, grid, axes, rafId, dirty: true };

    // Initial resize
    const container = rootRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      resizeRenderer(ctx, rect.width, rect.height);
      resolutionRef.current.set(rect.width, rect.height);
    }

    return () => {
      cancelAnimationFrame(rafId);
      // Dispose all displays
      for (const entry of displaysRef.current.values()) {
        entry.display.dispose();
      }
      displaysRef.current.clear();
      tfDisplay.dispose();
      sharedTFDisplayRef.current = null;
      grid.dispose();
      axes.dispose();
      disposeScene(ctx);
      sceneRef.current = null;
    };
  }, []);

  // Toggle top-down (Z-axis) view
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { controls, camera } = scene.ctx;

    if (topDown) {
      const dist = camera.position.distanceTo(controls.target);
      camera.position.set(controls.target.x, controls.target.y + Math.max(dist, 1), controls.target.z);
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = 0;
    } else {
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
    }
    controls.update();
    scene.dirty = true;
  }, [topDown]);

  // Resize observer
  useEffect(() => {
    const container = rootRef.current;
    const scene = sceneRef.current;
    if (!container || !scene) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        resizeRenderer(scene.ctx, width, height);
        resolutionRef.current.set(width, height);
        // Update resolution on all displays
        for (const d of displaysRef.current.values()) {
          d.display.setResolution(width, height);
        }
        scene.dirty = true;
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Display lifecycle: create/remove/update displays based on visibleTopics + settings
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const displays = displaysRef.current;

    // Determine which topics should have displays (exclude TF — handled by shared TFDisplay)
    const activeNames = new Set<string>();
    for (const topic of visibleTopics) {
      if (isTFType(topic.topicType)) continue;
      const settings = displaySettings.get(topic.topicName);
      if (settings?.visible === false) continue;
      const plugin = findPlugin(topic.topicType, topic.topicName);
      if (plugin?.createDisplay) {
        activeNames.add(topic.topicName);
      }
    }

    // Remove displays for topics no longer active
    for (const [name, entry] of displays) {
      if (!activeNames.has(name)) {
        scene.ctx.rosGroup.remove(entry.tfFrameGroup);
        entry.display.dispose();
        displays.delete(name);
      }
    }

    // Add/update displays
    for (const topic of visibleTopics) {
      if (!activeNames.has(topic.topicName)) continue;

      const settings = displaySettings.get(topic.topicName) ?? {};
      const existing = displays.get(topic.topicName);

      if (existing) {
        // Apply settings changes via plugin
        const settingsChanged = !shallowEqual(existing.settings, settings);
        if (settingsChanged) {
          existing.display.applySettings(settings);
          existing.settings = { ...settings };
        }
        continue;
      }

      // Create new display via plugin
      const plugin = findPlugin(topic.topicType, topic.topicName);
      if (!plugin?.createDisplay) continue;

      const display = plugin.createDisplay(settings);
      display.setResolution(resolutionRef.current.x, resolutionRef.current.y);

      // Wrap in a tfFrameGroup for TF transformation
      const tfFrameGroup = new THREE.Group();
      tfFrameGroup.matrixAutoUpdate = false;
      tfFrameGroup.add(display.object);
      scene.ctx.rosGroup.add(tfFrameGroup);

      displays.set(topic.topicName, {
        topicName: topic.topicName,
        topicType: topic.topicType,
        plugin,
        display,
        tfFrameGroup,
        frameId: "",
        settings: { ...settings },
      });
    }
    scene.dirty = true;
  }, [visibleTopics, displaySettings]);

  // Apply display settings (size, opacity, visibility) to the shared TFDisplay
  useEffect(() => {
    const shared = sharedTFDisplayRef.current;
    if (!shared) return;
    // Find any TF topic's settings to apply to the shared display
    let foundTF = false;
    for (const topic of visibleTopics) {
      if (!isTFType(topic.topicType)) continue;
      foundTF = true;
      const settings = displaySettings.get(topic.topicName);
      if (settings) {
        shared.display.setLineWidth((settings.size as number) ?? 1.0);
        shared.display.setOpacity((settings.opacity as number) ?? 1.0);
        shared.group.visible = settings.visible !== false;
      }
      break; // use first TF topic's settings
    }
    // Hide TF display when no TF topic is visible
    if (!foundTF) {
      shared.group.visible = false;
    }
    // Re-render TF axes with updated scale/opacity (updateFromTree uses axScale)
    shared.display.updateFromTree(tfTreeRef.current);
    const scene = sceneRef.current;
    if (scene) scene.dirty = true;
  }, [visibleTopics, displaySettings]);

  // Update displays only for topics whose message reference actually changed.
  const prevMessagesRef = useRef<Map<string, Record<string, unknown> | null>>(new Map());
  useEffect(() => {
    const displays = displaysRef.current;
    const prevMessages = prevMessagesRef.current;
    const tfTree = tfTreeRef.current;
    let anyUpdated = false;
    let tfUpdated = false;

    for (const topic of visibleTopics) {
      // Skip if message reference hasn't changed
      const prevMsg = prevMessages.get(topic.topicName) ?? null;
      if (topic.message === prevMsg) continue;
      prevMessages.set(topic.topicName, topic.message);
      if (!topic.message) continue;

      // TF topics: feed into the tree (no per-topic display)
      if (isTFType(topic.topicType)) {
        const isStatic = topic.topicName.includes("tf_static");
        const transforms = (topic.message as Record<string, unknown>).transforms as
          | Record<string, unknown>[]
          | undefined;
        if (transforms && Array.isArray(transforms)) {
          for (const tf of transforms) {
            const childFrameId = (tf.child_frame_id as string) ?? "";
            const header = tf.header as Record<string, unknown> | undefined;
            const parentFrameId = (header?.frame_id as string) ?? "";
            const transform = tf.transform as Record<string, unknown> | undefined;
            const trans = transform?.translation as Record<string, unknown> | undefined;
            const rot = transform?.rotation as Record<string, unknown> | undefined;
            if (childFrameId && parentFrameId && trans && rot) {
              tfTree.updateTransform(
                parentFrameId,
                childFrameId,
                { x: (trans.x as number) ?? 0, y: (trans.y as number) ?? 0, z: (trans.z as number) ?? 0 },
                {
                  x: (rot.x as number) ?? 0,
                  y: (rot.y as number) ?? 0,
                  z: (rot.z as number) ?? 0,
                  w: (rot.w as number) ?? 1,
                },
                isStatic,
              );
            }
          }
          tfUpdated = true;
        }
        continue;
      }

      // Non-TF topics: update display via plugin's unified update()
      const entry = displays.get(topic.topicName);
      if (!entry) continue;

      // Extract frame_id from message header
      const frameId = extractFrameId(topic.message);
      if (frameId) entry.frameId = frameId;

      entry.display.update(topic.message);
      anyUpdated = true;
    }

    // Apply TF transforms to all display tfFrameGroups
    if (anyUpdated || tfUpdated) {
      for (const entry of displays.values()) {
        if (entry.frameId) {
          if (fixedFrame) {
            const ok = tfTree.getTransformToFixed(entry.frameId, _tempMatrix);
            entry.tfFrameGroup.matrix.copy(ok ? _tempMatrix : _identityMatrix);
            entry.tfFrameGroup.visible = ok;
          } else {
            // No fixed frame set — show raw coordinates (identity transform)
            entry.tfFrameGroup.matrix.copy(_identityMatrix);
            entry.tfFrameGroup.visible = true;
          }
        }
      }

      // Update shared TFDisplay with all frames from the tree
      const shared = sharedTFDisplayRef.current;
      if (shared) {
        shared.display.updateFromTree(tfTree);
        // TFDisplay renders in fixed frame coords, identity group matrix
        shared.group.matrix.copy(_identityMatrix);
      }
    }

    // Notify parent of available frames
    if (tfUpdated && onAvailableFramesChange) {
      onAvailableFramesChange(tfTree.getFrameNames());
    }

    // Clean up stale entries
    for (const name of prevMessages.keys()) {
      if (!displays.has(name) && !visibleTopics.some((t) => t.topicName === name)) {
        prevMessages.delete(name);
      }
    }

    if (anyUpdated || tfUpdated) {
      const scene = sceneRef.current;
      if (scene) scene.dirty = true;
    }
  }, [visibleTopics, fixedFrame, onAvailableFramesChange]);

  // Re-apply TF transforms when fixedFrame changes (even without new messages)
  useEffect(() => {
    const displays = displaysRef.current;
    const tfTree = tfTreeRef.current;

    for (const entry of displays.values()) {
      if (entry.frameId) {
        if (fixedFrame) {
          const ok = tfTree.getTransformToFixed(entry.frameId, _tempMatrix);
          entry.tfFrameGroup.matrix.copy(ok ? _tempMatrix : _identityMatrix);
          entry.tfFrameGroup.visible = ok;
        } else {
          entry.tfFrameGroup.matrix.copy(_identityMatrix);
          entry.tfFrameGroup.visible = true;
        }
      }
    }

    // Update shared TFDisplay
    const shared = sharedTFDisplayRef.current;
    if (shared) {
      shared.display.updateFromTree(tfTree);
    }

    const scene = sceneRef.current;
    if (scene) scene.dirty = true;
  }, [fixedFrame]);

  // Auto-frame camera on first data
  const hasFramed = useRef(false);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || hasFramed.current) return;

    // Find first topic with a message to frame on
    for (const topic of visibleTopics) {
      if (!topic.message) continue;
      if (isTFType(topic.topicType)) continue;

      const plugin = findPlugin(topic.topicType, topic.topicName);
      if (!plugin?.createDisplay) continue;

      let cx = 0;
      let cy = 0;

      // Try to extract a representative position for framing
      const msg = topic.message as Record<string, unknown>;
      if (msg.pose) {
        let pose = msg.pose as Record<string, unknown>;
        if (pose.position === undefined && pose.pose !== undefined) {
          pose = pose.pose as Record<string, unknown>;
        }
        const pos = pose?.position as Record<string, unknown> | undefined;
        if (pos) {
          cx = (pos.x as number) ?? 0;
          cy = (pos.y as number) ?? 0;
        }
      } else if (msg.poses) {
        const poses = msg.poses as Record<string, unknown>[];
        if (poses && poses.length > 0) {
          let sx = 0,
            sy = 0,
            n = 0;
          for (const ps of poses) {
            const pose = (ps.pose ?? ps) as Record<string, unknown>;
            const pos = pose?.position as Record<string, unknown> | undefined;
            if (pos) {
              sx += (pos.x as number) ?? 0;
              sy += (pos.y as number) ?? 0;
              n++;
            }
          }
          if (n > 0) {
            cx = sx / n;
            cy = sy / n;
          }
        }
      }

      scene.ctx.controls.target.set(cx, 0, -cy);
      scene.ctx.camera.position.set(cx + 5, 10, -cy + 5);
      scene.ctx.controls.update();
      scene.dirty = true;
      hasFramed.current = true;
      break;
    }
  }, [visibleTopics]);

  // Build info text
  const infoLines: string[] = [];
  for (const topic of visibleTopics) {
    if (!topic.message) continue;
    const short = topic.topicName.split("/").pop() ?? topic.topicName;
    if (isTFType(topic.topicType)) {
      const n = ((topic.message as Record<string, unknown>).transforms as unknown[] | undefined)?.length ?? 0;
      infoLines.push(`${short}: ${n} frames`);
    } else {
      const entry = displaysRef.current.get(topic.topicName);
      if (!entry) continue;
      infoLines.push(`${short}: ${entry.plugin.id}`);
    }
  }
  if (fixedFrame) infoLines.push(`frame: ${fixedFrame}`);
  const infoText = infoLines.join("  |  ");

  return (
    <div ref={rootRef} className={styles.root}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <button
        type="button"
        className={topDown ? `${styles.viewBtn} ${styles.viewBtnActive}` : styles.viewBtn}
        onClick={() => setTopDown((v) => !v)}
        title="Top-down view (Z-axis)"
      >
        Top
      </button>
      {infoText && <div className={styles.info}>{infoText}</div>}
    </div>
  );
}

/** Shallow comparison of two Record<string, unknown> objects */
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
