import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry, TopicTimeline as TopicTimelineData } from "../api/client.ts";
import { getBagInfo, getBagMessages, getBagTimeline, getCwd, getFiles, uploadBagFiles } from "../api/client.ts";
import { parseFrames } from "../decoder/FrameParser.ts";
import type { SettingsProfile, TimedMessage, TopicData, TopicDisplaySettings } from "../panels/PanelProps.ts";
import { MessageBuffer } from "../playback/MessageBuffer.ts";
import { CollapsibleSection } from "../ui/CollapsibleSection.tsx";
import { DropOverlay } from "../ui/DropOverlay.tsx";
import { Sidebar } from "../ui/Sidebar.tsx";
import type { TimelineTopic } from "../ui/TopicTimeline.tsx";
import { TopicTimeline } from "../ui/TopicTimeline.tsx";
import { parseFramesAsync } from "../worker/decodeClient.ts";

const ThreeViewerPanel = lazy(() =>
  import("../panels/builtin/ThreeViewerPanel.tsx").then((m) => ({ default: m.ThreeViewerPanel })),
);

import { canHandle3D, findPlugin } from "../plugins/PluginRegistry.ts";
import type { LoadedBag, MergedTopic } from "../state/MultiBagState.ts";
import {
  buildMergedTypeMap,
  compositeKey,
  computeTimeRange,
  createLoadedBag,
  mergeTopics,
} from "../state/MultiBagState.ts";
import { ProfileSelector } from "../ui/ProfileSelector.tsx";
import styles from "./App.module.css";

const TF_TYPES = new Set(["tf2_msgs/TFMessage", "tf/tfMessage"]);

const TOPIC_COLORS = ["#f44336", "#2196f3", "#4caf50", "#ff9800", "#ce93d8", "#00bcd4", "#e91e63", "#ffb74d"];

function usePlayback(duration: number, loopRange: [number, number] | null) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [seekVersion, setSeekVersion] = useState(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const loopRangeRef = useRef(loopRange);
  loopRangeRef.current = loopRange;

  useEffect(() => {
    if (!isPlaying || duration <= 0) return;
    let lastTime = performance.now();
    let raf: number;

    const tick = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      setCurrentTime((prev) => {
        const next = prev + dt * speedRef.current;
        const lr = loopRangeRef.current;
        if (lr) {
          if (next >= lr[1]) return lr[0];
        } else {
          if (next >= duration) {
            setIsPlaying(false);
            return duration;
          }
        }
        return next;
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, duration]);

  const play = useCallback(() => {
    // If loopRange is set and currentTime is outside, seek to loop start
    const lr = loopRangeRef.current;
    if (lr) {
      setCurrentTime((prev) => {
        if (prev < lr[0] || prev >= lr[1]) return lr[0];
        return prev;
      });
    }
    setIsPlaying(true);
  }, []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const seek = useCallback(
    (t: number) => {
      setCurrentTime(Math.max(0, Math.min(t, duration)));
      setSeekVersion((v) => v + 1);
    },
    [duration],
  );
  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  return { isPlaying, currentTime, speed, setSpeed, play, pause, seek, reset, seekVersion };
}

export function App() {
  // Directory browser state
  const [dir, setDir] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Multi-bag state
  const [loadedBags, setLoadedBags] = useState<LoadedBag[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const nextBagIndexRef = useRef(0);

  // Topic & playback state
  const [selectedTopicName, setSelectedTopicName] = useState<string | null>(null);
  const [hiddenTopics, setHiddenTopics] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("rosbag-viewer:hiddenTopics");
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });
  // Profile state
  const [profiles, setProfiles] = useState<SettingsProfile[]>(() => {
    try {
      const saved = localStorage.getItem("rosbag-viewer:profiles");
      if (saved) {
        const parsed = JSON.parse(saved) as SettingsProfile[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      /* ignore */
    }
    return [{ name: "default", topicDisplaySettings: {}, hiddenTopics: [] }];
  });
  const [activeProfileName, setActiveProfileName] = useState<string>(() => {
    try {
      return localStorage.getItem("rosbag-viewer:activeProfile") ?? "default";
    } catch {
      return "default";
    }
  });

  const [loadingKeys, setLoadingKeys] = useState<Set<number>>(new Set());
  const bufferRef = useRef(new MessageBuffer());
  const [_bufferVersion, setBufferVersion] = useState(0);

  // Decoded message for sidebar Data panel (computed inline, no extra render)
  // Multi-topic 3D viewer state
  const [topicDisplaySettings, setTopicDisplaySettings] = useState<Map<string, TopicDisplaySettings>>(() => {
    try {
      const saved = localStorage.getItem("rosbag-viewer:displaySettings");
      if (saved) {
        const obj = JSON.parse(saved) as Record<string, Record<string, unknown>>;
        return new Map(Object.entries(obj));
      }
    } catch {
      /* ignore */
    }
    return new Map();
  });

  // TF fixed frame state (persisted to localStorage, default to "map")
  const [fixedFrame, setFixedFrame] = useState(() => {
    try {
      return localStorage.getItem("rosbag-viewer:fixedFrame") ?? "map";
    } catch {
      return "map";
    }
  });
  const [availableFrames, setAvailableFrames] = useState<string[]>([]);
  const prevAvailableFramesRef = useRef<string[]>([]);
  const handleAvailableFramesChange = useCallback((frames: string[]) => {
    // Only update if frames actually changed
    const prev = prevAvailableFramesRef.current;
    if (prev.length === frames.length && prev.every((f, i) => f === frames[i])) return;
    prevAvailableFramesRef.current = frames;
    setAvailableFrames(frames);
    // Auto-select only if no frame is set yet (never override user choice)
    setFixedFrame((cur) => {
      if (cur) return cur;
      if (frames.includes("map")) return "map";
      if (frames.includes("odom")) return "odom";
      return frames[0] ?? "";
    });
  }, []);

  // Topic timeline data (per bag)
  const [timelineMap, setTimelineMap] = useState<Map<string, TopicTimelineData>>(new Map());

  // Sidebar width (resizable)
  const [sidebarWidth, setSidebarWidth] = useState(300);

  // Drag & drop upload state
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFileCount, setUploadFileCount] = useState(0);
  const dragCounterRef = useRef(0);

  // Derived state: merged topics and time range
  const mergedTopics = useMemo<MergedTopic[]>(() => mergeTopics(loadedBags), [loadedBags]);
  const timeRange = useMemo(() => computeTimeRange(loadedBags), [loadedBags]);
  const mergedTypeMap = useMemo(() => buildMergedTypeMap(loadedBags), [loadedBags]);

  // Visible 3D-capable topics (checked in timeline)
  const visible3DTopics = useMemo(
    () =>
      mergedTopics.filter((t) => !hiddenTopics.has(t.name) && (canHandle3D(t.type, t.name) || TF_TYPES.has(t.type))),
    [mergedTopics, hiddenTopics],
  );

  // Merge timeline data across bags (offset each bag's times to global start)
  const timelineTopics = useMemo<TimelineTopic[]>(() => {
    if (timelineMap.size === 0 || loadedBags.length === 0) return [];
    const globalStart = timeRange.startTime;
    const byName = new Map<string, TimelineTopic>();
    for (const bag of loadedBags) {
      const tl = timelineMap.get(bag.path);
      if (!tl) continue;
      const bagOffset = bag.info.start_time - globalStart;
      for (const entry of tl.topics) {
        let merged = byName.get(entry.name);
        if (!merged) {
          merged = { name: entry.name, type: entry.type, times: [] };
          byName.set(entry.name, merged);
        }
        for (const t of entry.times) {
          merged.times.push(t + bagOffset);
        }
      }
    }
    // Sort times within each topic
    for (const topic of byName.values()) {
      topic.times.sort((a, b) => a - b);
    }
    // Sort topics alphabetically
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [timelineMap, loadedBags, timeRange]);

  const [loopRange, setLoopRange] = useState<[number, number] | null>(null);
  const playback = usePlayback(timeRange.duration, loopRange);

  const selectedMergedTopic = mergedTopics.find((t) => t.name === selectedTopicName) ?? null;
  // Fetch server CWD on startup
  useEffect(() => {
    getCwd()
      .then((cwd) => setDir(cwd))
      .catch(() => setDir("/"));
  }, []);

  // Auto-fetch files when directory changes
  useEffect(() => {
    if (!dir) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFiles(dir)
      .then((f) => {
        if (!cancelled) setFiles(f);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dir]);

  // Toggle bag file (load or unload)
  const handleToggleBag = useCallback(
    async (path: string) => {
      if (selectedPaths.has(path)) {
        // Unload bag
        const bag = loadedBags.find((b) => b.path === path);
        if (bag) {
          bufferRef.current.clearBag(bag.index);
          setBufferVersion((v) => v + 1);
        }
        setSelectedPaths((prev) => {
          const n = new Set(prev);
          n.delete(path);
          return n;
        });
        setLoadedBags((prev) => prev.filter((b) => b.path !== path));
        setTimelineMap((prev) => {
          const n = new Map(prev);
          n.delete(path);
          return n;
        });
        return;
      }

      // Load bag
      const bagIndex = nextBagIndexRef.current++;
      setSelectedPaths((prev) => new Set(prev).add(path));
      setError(null);

      try {
        const [info, timeline] = await Promise.all([getBagInfo(path), getBagTimeline(path)]);
        const newBag = createLoadedBag(bagIndex, path, info);
        setLoadedBags((prev) => [...prev, newBag]);
        setTimelineMap((prev) => new Map(prev).set(path, timeline));
      } catch (e) {
        setError(String(e));
        setSelectedPaths((prev) => {
          const n = new Set(prev);
          n.delete(path);
          return n;
        });
      }
    },
    [selectedPaths, loadedBags],
  );

  // Navigate to directory
  const handleNavigate = useCallback((newDir: string) => {
    setDir(newDir);
  }, []);

  // Helper: load messages for a topic's sources
  const loadTopicSources = useCallback(
    async (topic: MergedTopic) => {
      for (const source of topic.sources) {
        const bag = loadedBags.find((b) => b.index === source.bagIndex);
        if (!bag) continue;
        const key = compositeKey(source.bagIndex, source.topicId);
        if (bufferRef.current.has(key)) continue;

        setLoadingKeys((prev) => new Set(prev).add(key));
        try {
          const buf = await getBagMessages(bag.path, { topics: [source.topicId] });
          // Parse frames off main thread; fall back to synchronous if worker fails
          let frames: ReturnType<typeof parseFrames>;
          try {
            frames = await parseFramesAsync(buf, source.bagIndex);
          } catch {
            frames = parseFrames(buf);
          }
          bufferRef.current.loadForBag(frames, source.bagIndex, timeRange.startTime);
          setBufferVersion((v) => v + 1);
        } catch (e) {
          setError(String(e));
        } finally {
          setLoadingKeys((prev) => {
            const n = new Set(prev);
            n.delete(key);
            return n;
          });
        }
      }
    },
    [loadedBags, timeRange],
  );

  // Select a topic (and load its messages from all sources)
  const handleSelectTopic = useCallback(
    async (topicName: string) => {
      setSelectedTopicName(topicName);
      const topic = mergedTopics.find((t) => t.name === topicName);
      if (topic) await loadTopicSources(topic);
    },
    [mergedTopics, loadTopicSources],
  );

  // Decode message at current playback time (useMemo — no extra render)
  const decodedMsgCacheRef = useRef<{ payload: DataView | null; msg: Record<string, unknown> | null }>({
    payload: null,
    msg: null,
  });
  const decodedMsg = useMemo(() => {
    if (!selectedMergedTopic) return null;
    const bag = loadedBags.find((b) => b.typeMap.has(selectedMergedTopic.type));
    if (!bag) return null;
    const payload = bufferRef.current.getAtMerged(selectedMergedTopic.sources, playback.currentTime);
    if (!payload) return null;
    // Cache by payload reference — skip re-decode if same DataView
    const cache = decodedMsgCacheRef.current;
    if (cache.payload === payload && cache.msg) return cache.msg;
    try {
      const msg = bag.decoder.decode(selectedMergedTopic.type, payload);
      cache.payload = payload;
      cache.msg = msg;
      return msg;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMergedTopic, playback.currentTime, loadedBags]);

  // Toggle topic visibility in timeline
  const handleToggleTopicVisibility = useCallback((name: string) => {
    setHiddenTopics((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  }, []);

  // Set all topics visible or hidden
  const handleSetAllTopicsVisible = useCallback(
    (visible: boolean) => {
      if (visible) {
        setHiddenTopics(new Set());
      } else {
        setHiddenTopics(new Set(mergedTopics.map((t) => t.name)));
      }
    },
    [mergedTopics],
  );

  // Auto-load messages for visible 3D topics
  useEffect(() => {
    for (const topic of visible3DTopics) {
      const needsLoad = topic.sources.some((s) => {
        const key = compositeKey(s.bagIndex, s.topicId);
        return !bufferRef.current.has(key) && !loadingKeys.has(key);
      });
      if (needsLoad) {
        loadTopicSources(topic);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible3DTopics, loadTopicSources, loadingKeys.has]);

  // Assign default settings to new 3D topics (using plugin property defaults)
  useEffect(() => {
    setTopicDisplaySettings((prev) => {
      let changed = false;
      const next = new Map(prev);
      let idx = next.size;
      for (const topic of visible3DTopics) {
        if (!next.has(topic.name)) {
          const plugin = findPlugin(topic.type, topic.name);
          const defaults: Record<string, unknown> = { visible: true };
          if (plugin?.properties) {
            for (const prop of plugin.properties) {
              defaults[prop.key] = prop.defaultValue;
            }
          }
          // Override color with a cycling palette color
          if ("color" in defaults || TF_TYPES.has(topic.type)) {
            defaults.color = TOPIC_COLORS[idx % TOPIC_COLORS.length];
          }
          next.set(topic.name, defaults);
          idx++;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visible3DTopics]);

  // Pre-decode message history for visible 3D topics (only changes on buffer/topic changes, NOT on currentTime)
  const visibleTopicHistories = useMemo(() => {
    const map = new Map<string, { bag: LoadedBag; history: TimedMessage[] }>();
    for (const topic of visible3DTopics) {
      const bag = loadedBags.find((b) => b.typeMap.has(topic.type));
      if (!bag) continue;
      const all = bufferRef.current.getAllMerged(topic.sources);
      const history: TimedMessage[] = [];
      for (const entry of all) {
        try {
          const msg = bag.decoder.decode(topic.type, entry.payload);
          history.push({ time: entry.offsetSec, msg });
        } catch {
          /* skip */
        }
      }
      map.set(topic.name, { bag, history });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible3DTopics, loadedBags]);

  // Decode current message per visible 3D topic.
  // Cache decoded results by DataView reference — only re-decode when the payload changes.
  // Return the same array reference when all messages are unchanged to skip downstream updates.
  const topicDecodeCacheRef = useRef<Map<string, { payload: DataView | null; msg: Record<string, unknown> | null }>>(
    new Map(),
  );
  const prevVisibleTopicDataRef = useRef<TopicData[]>([]);
  const visibleTopicData = useMemo<TopicData[]>(() => {
    const cache = topicDecodeCacheRef.current;
    let anyChanged = false;
    const result = visible3DTopics.map((topic) => {
      const cached = visibleTopicHistories.get(topic.name);
      if (!cached) return { topicName: topic.name, topicType: topic.type, message: null, messageHistory: [] };

      const payload = bufferRef.current.getAtMerged(topic.sources, playback.currentTime);
      let message: Record<string, unknown> | null = null;
      if (payload) {
        const prev = cache.get(topic.name);
        if (prev && prev.payload === payload && prev.msg) {
          message = prev.msg;
        } else {
          try {
            message = cached.bag.decoder.decode(topic.type, payload);
            cache.set(topic.name, { payload, msg: message });
            anyChanged = true;
          } catch {
            /* skip */
          }
        }
      } else {
        const prev = cache.get(topic.name);
        if (prev && prev.payload !== null) {
          cache.set(topic.name, { payload: null, msg: null });
          anyChanged = true;
        }
      }

      return { topicName: topic.name, topicType: topic.type, message, messageHistory: cached.history };
    });
    // If topics list changed or any message decoded differently, return new array
    const prev = prevVisibleTopicDataRef.current;
    if (!anyChanged && prev.length === result.length && prev.every((p, i) => p.topicName === result[i].topicName)) {
      return prev;
    }
    prevVisibleTopicDataRef.current = result;
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible3DTopics, playback.currentTime, visibleTopicHistories]);

  // Persist display settings to localStorage
  useEffect(() => {
    const obj: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of topicDisplaySettings) obj[k] = v;
    localStorage.setItem("rosbag-viewer:displaySettings", JSON.stringify(obj));
  }, [topicDisplaySettings]);

  useEffect(() => {
    localStorage.setItem("rosbag-viewer:hiddenTopics", JSON.stringify([...hiddenTopics]));
  }, [hiddenTopics]);

  useEffect(() => {
    localStorage.setItem("rosbag-viewer:fixedFrame", fixedFrame);
  }, [fixedFrame]);

  // Auto-sync: keep active profile in sync with live settings
  useEffect(() => {
    setProfiles((prev) =>
      prev.map((p) => {
        if (p.name !== activeProfileName) return p;
        const obj: Record<string, Record<string, unknown>> = {};
        for (const [k, v] of topicDisplaySettings) obj[k] = v;
        return { ...p, topicDisplaySettings: obj, hiddenTopics: [...hiddenTopics] };
      }),
    );
  }, [topicDisplaySettings, hiddenTopics, activeProfileName]);

  // Persist profiles to localStorage
  useEffect(() => {
    localStorage.setItem("rosbag-viewer:profiles", JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    localStorage.setItem("rosbag-viewer:activeProfile", activeProfileName);
  }, [activeProfileName]);

  // Download settings as JSON
  const handleDownloadSettings = useCallback(() => {
    const data: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of topicDisplaySettings) {
      data[k] = { ...v, hidden: hiddenTopics.has(k) };
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "display-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [topicDisplaySettings, hiddenTopics]);

  // Upload settings from JSON
  const handleUploadSettings = useCallback(
    (json: string) => {
      try {
        const data = JSON.parse(json) as Record<string, Record<string, unknown>>;
        const next = new Map(topicDisplaySettings);
        const nextHidden = new Set(hiddenTopics);
        for (const [name, s] of Object.entries(data)) {
          const { hidden, ...settings } = s;
          next.set(name, { visible: true, ...settings });
          if (hidden) nextHidden.add(name);
          else nextHidden.delete(name);
        }
        setTopicDisplaySettings(next);
        setHiddenTopics(nextHidden);
      } catch {
        // ignore invalid JSON
      }
    },
    [topicDisplaySettings, hiddenTopics],
  );

  // --- Profile operations ---
  const serializeDisplaySettings = useCallback((): Record<string, Record<string, unknown>> => {
    const obj: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of topicDisplaySettings) obj[k] = v;
    return obj;
  }, [topicDisplaySettings]);

  const handleSwitchProfile = useCallback(
    (name: string) => {
      // Save current live state into active profile
      setProfiles((prev) =>
        prev.map((p) =>
          p.name === activeProfileName
            ? { ...p, topicDisplaySettings: serializeDisplaySettings(), hiddenTopics: [...hiddenTopics] }
            : p,
        ),
      );
      // Apply target profile's settings
      setProfiles((prev) => {
        const target = prev.find((p) => p.name === name);
        if (target) {
          setTopicDisplaySettings(new Map(Object.entries(target.topicDisplaySettings)));
          setHiddenTopics(new Set(target.hiddenTopics));
        }
        return prev;
      });
      setActiveProfileName(name);
    },
    [activeProfileName, serializeDisplaySettings, hiddenTopics],
  );

  const handleAddProfile = useCallback(
    (name: string) => {
      const snapshot: SettingsProfile = {
        name,
        topicDisplaySettings: serializeDisplaySettings(),
        hiddenTopics: [...hiddenTopics],
      };
      setProfiles((prev) => [...prev, snapshot]);
      setActiveProfileName(name);
    },
    [serializeDisplaySettings, hiddenTopics],
  );

  const handleDeleteProfile = useCallback(
    (name: string) => {
      if (name === "default") return;
      if (name === activeProfileName) {
        // Switch to default first
        const defaultProfile = profiles.find((p) => p.name === "default");
        if (defaultProfile) {
          setTopicDisplaySettings(new Map(Object.entries(defaultProfile.topicDisplaySettings)));
          setHiddenTopics(new Set(defaultProfile.hiddenTopics));
        }
        setActiveProfileName("default");
      }
      setProfiles((prev) => prev.filter((p) => p.name !== name));
    },
    [activeProfileName, profiles],
  );

  // Display settings change handler
  const handleDisplaySettingsChange = useCallback((topicName: string, settings: TopicDisplaySettings) => {
    setTopicDisplaySettings((prev) => new Map(prev).set(topicName, settings));
  }, []);

  // Sidebar resize handler
  const handleResizeStart = useCallback(() => {
    const onMove = (e: MouseEvent) => {
      setSidebarWidth(Math.max(180, Math.min(600, e.clientX)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  // Drag & drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      const bagFiles = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith(".bag"));
      if (bagFiles.length === 0) {
        setError("Only .bag files are accepted");
        return;
      }

      setIsUploading(true);
      setUploadFileCount(bagFiles.length);
      setError(null);

      try {
        const result = await uploadBagFiles(bagFiles);
        for (const uploaded of result.uploaded) {
          await handleToggleBag(uploaded.path);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setIsUploading(false);
        setUploadFileCount(0);
      }
    },
    [handleToggleBag],
  );

  return (
    <div
      className={styles.app}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <DropOverlay visible={isDragging || isUploading} uploading={isUploading} fileCount={uploadFileCount} />

      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>rosbag-viewer</span>
        {loadedBags.length > 0 && (
          <span className={styles.headerInfo}>
            {loadedBags.length === 1 ? loadedBags[0].path.split("/").pop() : `${loadedBags.length} bags loaded`}
          </span>
        )}
        <span className={styles.spacer} />
        <ProfileSelector
          profiles={profiles}
          activeProfileName={activeProfileName}
          onSwitch={handleSwitchProfile}
          onAdd={handleAddProfile}
          onDelete={handleDeleteProfile}
        />
        <button
          type="button"
          className={styles.headerBtn}
          onClick={handleDownloadSettings}
          title="Save display settings to file"
        >
          Save
        </button>
        <button
          type="button"
          className={styles.headerBtn}
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json";
            input.onchange = () => {
              const file = input.files?.[0];
              if (!file) return;
              file.text().then((text) => handleUploadSettings(text));
            };
            input.click();
          }}
          title="Load display settings from file"
        >
          Load
        </button>
      </div>

      <div className={styles.body}>
        {/* ---- Sidebar ---- */}
        <Sidebar
          currentDir={dir}
          entries={files}
          loading={loading}
          onNavigate={handleNavigate}
          loadedBags={loadedBags}
          selectedPaths={selectedPaths}
          onToggleBag={handleToggleBag}
          width={sidebarWidth}
          topicDisplaySettings={topicDisplaySettings}
          onDisplaySettingsChange={handleDisplaySettingsChange}
          selectedTopicName={selectedTopicName}
          selectedTopicType={selectedMergedTopic?.type ?? null}
          selectedMessage={decodedMsg}
        />

        {/* Resize handle */}
        <div className={styles.resizeHandle} onMouseDown={handleResizeStart} />

        {/* ---- Main panel area ---- */}
        <div className={styles.main}>
          {/* Topic timeline (rqt_bag-style) */}
          {timelineTopics.length > 0 && (
            <CollapsibleSection title="Timeline" defaultOpen={true} count={timelineTopics.length}>
              <TopicTimeline
                topics={timelineTopics}
                duration={timeRange.duration}
                currentTime={playback.currentTime}
                onSeek={playback.seek}
                selectedTopicName={selectedTopicName}
                onSelectTopic={handleSelectTopic}
                hiddenTopics={hiddenTopics}
                onToggleTopicVisibility={handleToggleTopicVisibility}
                onSetAllTopicsVisible={handleSetAllTopicsVisible}
                isPlaying={playback.isPlaying}
                onPlay={playback.play}
                onPause={playback.pause}
                speed={playback.speed}
                onSpeedChange={playback.setSpeed}
                startTime={timeRange.startTime}
                loopRange={loopRange}
                onLoopRangeChange={setLoopRange}
              />
            </CollapsibleSection>
          )}

          {/* 3D viewer — always visible when bags are loaded */}
          {loadedBags.length > 0 ? (
            <div className={styles.panelBody}>
              {availableFrames.length > 0 && (
                <div className={styles.fixedFrameBar}>
                  <span className={styles.fixedFrameLabel}>Fixed Frame:</span>
                  <select
                    value={fixedFrame}
                    onChange={(e) => setFixedFrame(e.target.value)}
                    className={styles.fixedFrameSelect}
                  >
                    {availableFrames.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Suspense fallback={<div className={styles.empty}>Loading 3D viewer...</div>}>
                <ThreeViewerPanel
                  topicType=""
                  message={null}
                  schema={{ name: null, fields: [] }}
                  rawBuffer={null}
                  timestamp={playback.currentTime}
                  messageHistory={[]}
                  typeMap={mergedTypeMap}
                  visibleTopics={visibleTopicData}
                  topicDisplaySettings={topicDisplaySettings}
                  onDisplaySettingsChange={handleDisplaySettingsChange}
                  fixedFrame={fixedFrame}
                  seekVersion={playback.seekVersion}
                  onAvailableFramesChange={handleAvailableFramesChange}
                />
              </Suspense>
            </div>
          ) : (
            <div className={styles.empty}>{loading ? "Loading..." : "Drop or select .bag files to begin"}</div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className={styles.status}>{error ? <span className={styles.errorText}>{error}</span> : "Ready"}</div>
    </div>
  );
}
