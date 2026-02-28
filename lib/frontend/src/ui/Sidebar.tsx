import { useCallback, useRef, useState } from "react";
import type { FileEntry } from "../api/client.ts";
import { findPlugin } from "../plugins/PluginRegistry.ts";
import type { LoadedBag } from "../state/MultiBagState.ts";
import { CollapsibleSection } from "./CollapsibleSection.tsx";
import { FolderBrowser } from "./FolderBrowser.tsx";
import { JsonNode } from "./JsonNode.tsx";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  // Folder browser
  currentDir: string;
  entries: FileEntry[];
  loading: boolean;
  onNavigate: (dir: string) => void;

  // Bags
  loadedBags: LoadedBag[];
  selectedPaths: Set<string>;
  onToggleBag: (path: string) => void;

  // Sidebar width
  width: number;

  // Display properties (3D viewer topics)
  topicDisplaySettings: Map<string, Record<string, unknown>>;
  onDisplaySettingsChange: (name: string, settings: Record<string, unknown>) => void;

  // JSON data display
  selectedTopicName: string | null;
  selectedTopicType: string | null;
  selectedMessage: Record<string, unknown> | null;
}

type SectionId = "bags" | "files" | "display" | "plugins" | "data";

const DEFAULT_ORDER: SectionId[] = ["bags", "files", "display", "plugins", "data"];

export function Sidebar({
  currentDir,
  entries,
  loading,
  onNavigate,
  loadedBags,
  selectedPaths,
  onToggleBag,
  width,
  topicDisplaySettings,
  onDisplaySettingsChange,
  selectedTopicName,
  selectedTopicType,
  selectedMessage,
}: SidebarProps) {
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(DEFAULT_ORDER);
  const [dragOverId, setDragOverId] = useState<SectionId | null>(null);
  const dragSrcRef = useRef<SectionId | null>(null);

  // Find plugin for selected topic (if any)
  const selectedPlugin =
    selectedTopicType && selectedTopicName ? findPlugin(selectedTopicType, selectedTopicName) : null;

  const handleDragStart = useCallback((id: SectionId) => {
    dragSrcRef.current = id;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: SectionId) => {
    e.preventDefault();
    if (dragSrcRef.current && dragSrcRef.current !== id) {
      setDragOverId(id);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: SectionId) => {
    e.preventDefault();
    setDragOverId(null);
    const srcId = dragSrcRef.current;
    if (!srcId || srcId === targetId) return;

    setSectionOrder((prev) => {
      const next = prev.filter((id) => id !== srcId);
      const targetIdx = next.indexOf(targetId);
      next.splice(targetIdx, 0, srcId);
      return next;
    });
    dragSrcRef.current = null;
  }, []);

  const handleDragEnd = useCallback(() => {
    dragSrcRef.current = null;
    setDragOverId(null);
  }, []);

  // Render a section by id
  const renderSection = (id: SectionId) => {
    const isDragOver = dragOverId === id;
    const wrapProps = {
      onDragOver: (e: React.DragEvent) => handleDragOver(e, id),
      onDragLeave: handleDragLeave,
      onDrop: (e: React.DragEvent) => handleDrop(e, id),
      onDragEnd: handleDragEnd,
    };
    const dragHandleProps = {
      draggable: true,
      onDragStart: () => handleDragStart(id),
    };

    switch (id) {
      case "bags":
        if (loadedBags.length === 0) return null;
        return (
          <div key={id} {...wrapProps}>
            {isDragOver && <div className={styles.dropIndicator} />}
            <CollapsibleSection
              title="Loaded Bags"
              defaultOpen={true}
              count={loadedBags.length}
              headerProps={dragHandleProps}
            >
              <div className={styles.bagList}>
                {loadedBags.map((bag) => (
                  <div key={bag.path} className={styles.bagItem}>
                    <span className={styles.bagDot} />
                    <span className={styles.bagName} title={bag.path}>
                      {bag.path.split("/").pop()}
                    </span>
                    <span className={styles.bagClose} title="Unload" onClick={() => onToggleBag(bag.path)}>
                      x
                    </span>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          </div>
        );

      case "files":
        return (
          <div key={id} {...wrapProps}>
            {isDragOver && <div className={styles.dropIndicator} />}
            <CollapsibleSection
              title="Bag Files"
              defaultOpen={loadedBags.length === 0}
              count={entries.filter((e) => e.kind === "file").length}
              headerProps={dragHandleProps}
            >
              <FolderBrowser
                currentDir={currentDir}
                entries={entries}
                selectedPaths={selectedPaths}
                loading={loading}
                onNavigate={onNavigate}
                onToggleBag={onToggleBag}
              />
            </CollapsibleSection>
          </div>
        );

      case "display": {
        if (!selectedTopicName || !selectedTopicType) return null;
        const displayPlugin = findPlugin(selectedTopicType, selectedTopicName);
        if (!displayPlugin) return null;
        return (
          <div key={id} {...wrapProps}>
            {isDragOver && <div className={styles.dropIndicator} />}
            <CollapsibleSection title="Display" defaultOpen={true} headerProps={dragHandleProps}>
              <div className={styles.displayList}>
                {[{ topicName: selectedTopicName, topicType: selectedTopicType }].map((topic) => {
                  const settings = topicDisplaySettings.get(topic.topicName) ?? {};
                  const isVisible = settings.visible !== false;
                  const properties = displayPlugin.properties ?? [];
                  // Check if there's a color property
                  const colorProp = properties.find((p) => p.type === "color");

                  return (
                    <div key={topic.topicName}>
                      <div className={styles.displayRow}>
                        {colorProp && (
                          <input
                            type="color"
                            value={
                              (settings[colorProp.key] as string) ?? (colorProp.defaultValue as string) ?? "#888888"
                            }
                            className={styles.colorInput}
                            onChange={(e) => {
                              onDisplaySettingsChange(topic.topicName, {
                                ...settings,
                                [colorProp.key]: e.target.value,
                              });
                            }}
                          />
                        )}
                        <span className={styles.displayName} title={topic.topicName}>
                          {shortName(topic.topicName)}
                        </span>
                        <span className={styles.displayType}>{shortType(topic.topicType)}</span>
                        <span
                          className={styles.eyeBtn}
                          style={{ opacity: isVisible ? 1 : 0.3 }}
                          title={isVisible ? "Hide" : "Show"}
                          onClick={() => {
                            onDisplaySettingsChange(topic.topicName, {
                              ...settings,
                              visible: !isVisible,
                            });
                          }}
                        >
                          {isVisible ? "\u25CF" : "\u25CB"}
                        </span>
                      </div>
                      {/* Auto-generated property UI from plugin properties (excluding color, handled above) */}
                      {isVisible &&
                        properties
                          .filter((p) => p.type !== "color")
                          .map((prop) => (
                            <div key={prop.key} className={styles.propRow}>
                              <span className={styles.propLabel}>{prop.label}</span>
                              {prop.type === "number" && (
                                <input
                                  type="number"
                                  min={prop.min}
                                  max={prop.max}
                                  step={prop.step}
                                  value={(settings[prop.key] as number) ?? (prop.defaultValue as number)}
                                  className={styles.numInput}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    if (!Number.isNaN(v)) {
                                      onDisplaySettingsChange(topic.topicName, {
                                        ...settings,
                                        [prop.key]: v,
                                      });
                                    }
                                  }}
                                />
                              )}
                              {prop.type === "select" && prop.options && (
                                <select
                                  value={(settings[prop.key] as string) ?? (prop.defaultValue as string)}
                                  className={styles.selectInput}
                                  onChange={(e) => {
                                    onDisplaySettingsChange(topic.topicName, {
                                      ...settings,
                                      [prop.key]: e.target.value,
                                    });
                                  }}
                                >
                                  {prop.options.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ))}
                      {/* Namespace visibility checkboxes */}
                      {isVisible &&
                        displayPlugin.extractGroups &&
                        selectedMessage &&
                        (() => {
                          const msgNs = displayPlugin.extractGroups?.(selectedMessage) ?? [];
                          const settingsNs = Object.keys(settings)
                            .filter((k) => k.startsWith("ns:"))
                            .map((k) => k.slice(3));
                          const allNs = Array.from(new Set([...msgNs, ...settingsNs])).sort();
                          if (allNs.length === 0) return null;
                          return allNs.map((ns) => (
                            <div key={`ns:${ns}`} className={styles.nsRow}>
                              <input
                                type="checkbox"
                                className={styles.nsCheckbox}
                                checked={settings[`ns:${ns}`] !== false}
                                onChange={(e) => {
                                  onDisplaySettingsChange(topic.topicName, {
                                    ...settings,
                                    [`ns:${ns}`]: e.target.checked,
                                  });
                                }}
                              />
                              <span className={styles.nsLabel} title={ns || "(default)"}>
                                {ns || "(default)"}
                              </span>
                            </div>
                          ));
                        })()}
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          </div>
        );
      }

      case "plugins": {
        // Render plugin's sidebarComponent if available
        if (!selectedPlugin?.sidebarComponent || !selectedMessage || !selectedTopicType || !selectedTopicName)
          return null;
        const SidebarComp = selectedPlugin.sidebarComponent;
        return (
          <div key={id} {...wrapProps}>
            {isDragOver && <div className={styles.dropIndicator} />}
            <CollapsibleSection
              title={selectedPlugin.id.charAt(0).toUpperCase() + selectedPlugin.id.slice(1)}
              defaultOpen={true}
              headerProps={dragHandleProps}
            >
              <SidebarComp
                message={selectedMessage}
                topicType={selectedTopicType}
                topicName={selectedTopicName}
                settings={topicDisplaySettings.get(selectedTopicName) ?? {}}
              />
            </CollapsibleSection>
          </div>
        );
      }

      case "data":
        if (!selectedTopicName) return null;
        return (
          <div key={id} {...wrapProps}>
            {isDragOver && <div className={styles.dropIndicator} />}
            <CollapsibleSection title="Data" defaultOpen={true} fillSpace headerProps={dragHandleProps}>
              {selectedTopicType && <div className={styles.topicType}>{selectedTopicType}</div>}
              {selectedMessage ? (
                <div className={styles.jsonArea}>
                  <JsonNode data={selectedMessage} />
                </div>
              ) : (
                <div className={styles.noData}>No data at current time</div>
              )}
            </CollapsibleSection>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className={styles.root} style={{ width: `${width}px` }}>
      {sectionOrder.map(renderSection)}
    </div>
  );
}

function shortName(topicName: string): string {
  const parts = topicName.split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : topicName;
}

function shortType(topicType: string): string {
  return topicType.split("/").pop() ?? topicType;
}
