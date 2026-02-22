import { useState } from "react";
import styles from "./JsonNode.module.css";

const MAX_ARRAY_DISPLAY = 20;

export function JsonNode({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined) {
    return <span className={styles.nullValue}>null</span>;
  }

  if (typeof data === "boolean") {
    return <span className={styles.bool}>{data ? "true" : "false"}</span>;
  }

  if (typeof data === "number") {
    return <span className={styles.number}>{formatNumber(data)}</span>;
  }

  if (typeof data === "bigint") {
    return <span className={styles.number}>{data.toString()}</span>;
  }

  if (typeof data === "string") {
    return <span className={styles.string}>&quot;{data}&quot;</span>;
  }

  // TypedArray
  if (ArrayBuffer.isView(data) && !(data instanceof DataView)) {
    const arr = data as unknown as ArrayLike<number>;
    const name = data.constructor.name;
    const len = arr.length;
    if (len <= MAX_ARRAY_DISPLAY) {
      const items = Array.from(arr).map(formatNumber).join(", ");
      return (
        <span>
          <span className={styles.bracket}>
            {name}[{len}]
          </span>{" "}
          [{items}]
        </span>
      );
    }
    const preview = Array.from({ length: MAX_ARRAY_DISPLAY }, (_, i) => formatNumber(arr[i])).join(", ");
    return (
      <span>
        <span className={styles.bracket}>
          {name}[{len}]
        </span>{" "}
        [{preview}, ...]
      </span>
    );
  }

  // Plain array
  if (Array.isArray(data)) {
    return <CollapsibleArray data={data} depth={depth} />;
  }

  // Object (including {secs, nsecs} time structs)
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;

    // Compact display for time/duration structs
    if ("secs" in obj && "nsecs" in obj && Object.keys(obj).length === 2) {
      return (
        <span className={styles.number}>
          {obj.secs as number}.{String(obj.nsecs as number).padStart(9, "0")}
        </span>
      );
    }

    return <CollapsibleObject data={obj} depth={depth} />;
  }

  return <span>{String(data)}</span>;
}

function CollapsibleObject({ data, depth }: { data: Record<string, unknown>; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2);
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return <span className={styles.bracket}>{"{}"}</span>;
  }

  if (collapsed) {
    return (
      <span>
        <span className={styles.toggle} onClick={() => setCollapsed(false)}>
          +
        </span>
        <span className={styles.bracket}>
          {"{"} {entries.length} fields {"}"}
        </span>
      </span>
    );
  }

  return (
    <span>
      <span className={styles.toggle} onClick={() => setCollapsed(true)}>
        -
      </span>
      <span className={styles.bracket}>{"{"}</span>
      {entries.map(([key, value]) => (
        <div key={key} className={styles.row}>
          <span className={styles.key}>{key}</span>: <JsonNode data={value} depth={depth + 1} />
        </div>
      ))}
      <span className={styles.bracket}>{"}"}</span>
    </span>
  );
}

function CollapsibleArray({ data, depth }: { data: unknown[]; depth: number }) {
  const [collapsed, setCollapsed] = useState(data.length > 5 && depth > 1);

  if (data.length === 0) {
    return <span className={styles.bracket}>[]</span>;
  }

  if (collapsed) {
    return (
      <span>
        <span className={styles.toggle} onClick={() => setCollapsed(false)}>
          +
        </span>
        <span className={styles.bracket}>[{data.length} items]</span>
      </span>
    );
  }

  const items = data.length > MAX_ARRAY_DISPLAY ? data.slice(0, MAX_ARRAY_DISPLAY) : data;

  return (
    <span>
      <span className={styles.toggle} onClick={() => setCollapsed(true)}>
        -
      </span>
      <span className={styles.bracket}>[</span>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: array items have no stable unique id
        <div key={i} className={styles.row}>
          <JsonNode data={item} depth={depth + 1} />
          {i < data.length - 1 ? "," : ""}
        </div>
      ))}
      {data.length > MAX_ARRAY_DISPLAY && (
        <div className={styles.row}>
          <span className={styles.nullValue}>... {data.length - MAX_ARRAY_DISPLAY} more</span>
        </div>
      )}
      <span className={styles.bracket}>]</span>
    </span>
  );
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toPrecision(6);
}
