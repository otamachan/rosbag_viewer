import type { FileEntry } from "../api/client.ts";
import styles from "./FolderBrowser.module.css";

interface FolderBrowserProps {
  currentDir: string;
  entries: FileEntry[];
  selectedPaths: Set<string>;
  loading: boolean;
  onNavigate: (dir: string) => void;
  onToggleBag: (path: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function parentDir(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

export function FolderBrowser({
  currentDir,
  entries,
  selectedPaths,
  loading,
  onNavigate,
  onToggleBag,
}: FolderBrowserProps) {
  const segments = currentDir.split("/").filter(Boolean);

  return (
    <div className={styles.root}>
      {/* Breadcrumb */}
      <div className={styles.breadcrumb}>
        <span className={styles.crumbSegment} onClick={() => onNavigate("/")}>
          /
        </span>
        {segments.map((seg, i) => {
          const path = `/${segments.slice(0, i + 1).join("/")}`;
          return (
            <span key={path} className={styles.crumbGroup}>
              <span className={styles.crumbSep}>/</span>
              <span className={styles.crumbSegment} onClick={() => onNavigate(path)}>
                {seg}
              </span>
            </span>
          );
        })}
        {loading && <span className={styles.loading}>...</span>}
      </div>

      {/* File/directory list */}
      <div className={styles.list}>
        {/* Parent directory */}
        {currentDir !== "/" && (
          <div className={styles.item} onClick={() => onNavigate(parentDir(currentDir))}>
            <span className={styles.dirIcon}>&#x1F4C1;</span>
            <span className={styles.name}>..</span>
          </div>
        )}

        {/* Directories */}
        {entries
          .filter((e) => e.kind === "directory")
          .map((e) => (
            <div key={e.path} className={styles.item} onClick={() => onNavigate(e.path)}>
              <span className={styles.dirIcon}>&#x1F4C1;</span>
              <span className={styles.name}>{e.name}</span>
            </div>
          ))}

        {/* Bag files */}
        {entries
          .filter((e) => e.kind === "file")
          .map((e) => (
            <div
              key={e.path}
              className={selectedPaths.has(e.path) ? `${styles.item} ${styles.selected}` : styles.item}
              onClick={() => onToggleBag(e.path)}
            >
              <input
                type="checkbox"
                checked={selectedPaths.has(e.path)}
                onChange={() => onToggleBag(e.path)}
                onClick={(ev) => ev.stopPropagation()}
                className={styles.checkbox}
              />
              <span className={styles.name}>{e.name}</span>
              <span className={styles.badge}>{formatSize(e.size)}</span>
            </div>
          ))}

        {!loading && entries.length === 0 && <div className={styles.emptyMsg}>No .bag files found</div>}
      </div>
    </div>
  );
}
