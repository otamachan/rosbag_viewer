import type { ComponentType } from "react";
import type * as THREE from "three";

/** 3D display object interface */
export interface ThreeDisplay {
  readonly object: THREE.Object3D;
  /** Override the frame_id extracted from message header */
  frameId?: string;
  update(msg: Record<string, unknown>): void;
  /** Called when settings change (color/size/opacity etc — all managed by plugin) */
  applySettings(settings: Record<string, unknown>): void;
  /** Called on viewport resize (for LineMaterial resolution etc) */
  setResolution(width: number, height: number): void;
  dispose(): void;
}

/** Props passed to sidebar plugin components */
export interface SidebarPluginProps {
  message: Record<string, unknown>;
  topicType: string;
  topicName: string;
  settings?: Record<string, unknown>;
}

/** Property definition for auto-generated settings UI */
export interface PropertyDef {
  key: string;
  label: string;
  type: "number" | "select" | "color" | "boolean";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  defaultValue: unknown;
}

/** Plugin definition */
export interface DisplayPlugin {
  id: string;
  /** Match by message type or topic name */
  canHandle: (topicType: string, topicName: string) => boolean;

  /** 3D display factory (optional — sidebar-only plugins omit this) */
  createDisplay?: (settings: Record<string, unknown>) => ThreeDisplay;

  /** Sidebar component (optional) */
  sidebarComponent?: ComponentType<SidebarPluginProps>;

  /** Property definitions for settings UI */
  properties?: PropertyDef[];

  /** Extract group names from a message for per-group visibility toggles */
  extractGroups?: (msg: Record<string, unknown>) => string[];
}
