import type { MsgSchema } from "../decoder/RosDecoder.ts";

/** A single decoded message with its timestamp. */
export interface TimedMessage {
  time: number;
  msg: Record<string, unknown>;
}

/** Data for a single topic in the multi-topic 3D view. */
export interface TopicData {
  topicName: string;
  topicType: string;
  message: Record<string, unknown> | null;
  messageHistory: TimedMessage[];
}

/** Per-topic display settings for the 3D viewer (plugin-managed). */
export type TopicDisplaySettings = Record<string, unknown>;

/** A named display-settings profile (topic colors/sizes/visibility snapshot). */
export interface SettingsProfile {
  name: string;
  topicDisplaySettings: Record<string, Record<string, unknown>>;
  hiddenTopics: string[];
}

/** Common props passed to every panel component. */
export interface PanelProps {
  /** ROS message type name (e.g. "geometry_msgs/PoseStamped"). */
  topicType: string;
  /** Decoded message object (null if no message at current time). */
  message: Record<string, unknown> | null;
  /** Schema for the message type. */
  schema: MsgSchema;
  /** Raw binary payload (for panels that need direct buffer access). */
  rawBuffer: DataView | null;
  /** Current playback timestamp (offset from bag start, in seconds). */
  timestamp: number;
  /** All decoded messages for this topic (for history-based panels). */
  messageHistory: TimedMessage[];
  /** Full type map for resolving nested schemas. */
  typeMap: Map<string, MsgSchema>;
}

/** Extended props for the 3D viewer (multi-topic). */
export interface MultiTopicPanelProps extends PanelProps {
  visibleTopics: TopicData[];
  topicDisplaySettings: Map<string, TopicDisplaySettings>;
  onDisplaySettingsChange: (topicName: string, settings: TopicDisplaySettings) => void;
  fixedFrame: string;
  seekVersion: number;
  onAvailableFramesChange: (frames: string[]) => void;
}
