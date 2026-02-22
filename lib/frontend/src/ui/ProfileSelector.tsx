import type { SettingsProfile } from "../panels/PanelProps.ts";
import styles from "./ProfileSelector.module.css";

interface ProfileSelectorProps {
  profiles: SettingsProfile[];
  activeProfileName: string;
  onSwitch: (name: string) => void;
  onAdd: (name: string) => void;
  onDelete: (name: string) => void;
}

export function ProfileSelector({ profiles, activeProfileName, onSwitch, onAdd, onDelete }: ProfileSelectorProps) {
  const handleAdd = () => {
    const name = window.prompt("Profile name:");
    if (!name || name.trim() === "") return;
    const trimmed = name.trim();
    if (profiles.some((p) => p.name === trimmed)) {
      window.alert(`Profile "${trimmed}" already exists.`);
      return;
    }
    onAdd(trimmed);
  };

  const handleDelete = () => {
    if (activeProfileName === "default") return;
    if (!window.confirm(`Delete profile "${activeProfileName}"?`)) return;
    onDelete(activeProfileName);
  };

  return (
    <div className={styles.wrapper}>
      <select className={styles.select} value={activeProfileName} onChange={(e) => onSwitch(e.target.value)}>
        {profiles.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <button type="button" className={styles.btn} onClick={handleAdd} title="Add profile">
        +
      </button>
      <button
        type="button"
        className={styles.btn}
        style={{ opacity: activeProfileName === "default" ? 0.4 : 1 }}
        onClick={handleDelete}
        disabled={activeProfileName === "default"}
        title="Delete profile"
      >
        ×
      </button>
    </div>
  );
}
