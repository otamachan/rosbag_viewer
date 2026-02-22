import type { ReactNode } from "react";
import { useState } from "react";
import styles from "./CollapsibleSection.module.css";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  /** When true, body gets flex:1 to fill remaining space (for sidebar). */
  fillSpace?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  count,
  fillSpace = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <>
      <div className={styles.header} onClick={() => setOpen((v) => !v)}>
        <span className={styles.arrow}>{open ? "\u25BC" : "\u25B6"}</span>
        <span>{title}</span>
        {count !== undefined && <span className={styles.count}>({count})</span>}
      </div>
      {open && <div className={fillSpace ? `${styles.body} ${styles.bodyFill}` : styles.body}>{children}</div>}
    </>
  );
}
