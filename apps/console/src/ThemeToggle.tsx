import { useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";
import { applyTheme, readTheme, type Theme } from "./theme.js";

/**
 * Three states, all named, none hidden.
 *
 * A single button that cycles would hide two of them behind guesswork. This is
 * small enough to sit in the bar as metadata rather than as a control that
 * wants attention.
 */
const OPTIONS: { id: Theme; label: string }[] = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
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
          onClick={() => {
            applyTheme(o.id);
            setTheme(o.id);
          }}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
