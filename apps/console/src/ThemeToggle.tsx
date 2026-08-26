import { type ReactNode, useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";
import { applyTheme, readTheme, type Theme } from "./theme.js";

/**
 * Three states, all reachable, none hidden behind a cycle.
 *
 * Icons rather than words because this is metadata in a bar, not a decision
 * the page wants anybody to dwell on. Each still carries a real label for
 * anyone not reading pixels.
 */
const OPTIONS: { id: Theme; label: string; icon: ReactNode }[] = [
  {
    id: "system",
    label: "Match the system",
    icon: (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
        <path d="M5.5 14h5" />
      </svg>
    ),
  },
  {
    id: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="3.1" />
        <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1" />
      </svg>
    ),
  },
  {
    id: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  // Read on mount rather than at module scope: the inline script in index.html
  // has already applied it, and this only has to agree with what is on screen.
  useEffect(() => {
    setTheme(readTheme());
  }, []);

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Theme</legend>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          className={styles.option}
          data-on={o.id === theme}
          aria-pressed={o.id === theme}
          aria-label={o.label}
          title={o.label}
          onClick={() => {
            applyTheme(o.id);
            setTheme(o.id);
          }}
        >
          {o.icon}
        </button>
      ))}
    </fieldset>
  );
}
