import { JsonNode } from "../../ui/JsonNode.tsx";
import type { PanelProps } from "../PanelProps.ts";
import styles from "./JsonTreePanel.module.css";

export function JsonTreePanel({ message }: PanelProps) {
  if (!message) {
    return <div className={`${styles.root} ${styles.empty}`}>No message at current time</div>;
  }

  return (
    <div className={styles.root}>
      <JsonNode data={message} />
    </div>
  );
}
