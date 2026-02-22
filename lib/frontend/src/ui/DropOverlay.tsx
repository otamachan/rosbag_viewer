import styles from "./DropOverlay.module.css";

interface DropOverlayProps {
  visible: boolean;
  uploading: boolean;
  fileCount: number;
}

export function DropOverlay({ visible, uploading, fileCount }: DropOverlayProps) {
  if (!visible) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.inner}>
        {uploading ? (
          <>
            <div className={styles.title}>
              Uploading {fileCount} file{fileCount !== 1 ? "s" : ""}...
            </div>
            <div className={styles.subtitle}>Please wait</div>
          </>
        ) : (
          <>
            <div className={styles.title}>Drop .bag files to upload</div>
            <div className={styles.subtitle}>Files will be uploaded to the server and loaded</div>
          </>
        )}
      </div>
    </div>
  );
}
