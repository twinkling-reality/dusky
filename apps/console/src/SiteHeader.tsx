import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "./SiteHeader.module.css";

/**
 * Wordmark left, links right, no rule underneath.
 *
 * The wordmark is set in the page's own ink rather than in the accent: it is
 * the name of the thing, not a control, and greying it out made the first
 * word on the page the quietest.
 */
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className={styles.bar} data-motion-shell="header">
      <Link to="/" className={styles.wordmark} viewTransition>
        Dusky
      </Link>
      <nav className={styles.nav}>{children}</nav>
    </header>
  );
}
