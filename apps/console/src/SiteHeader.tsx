import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "./SiteHeader.module.css";
import { ThemeToggle } from "./ThemeToggle.js";

/**
 * The one bar that is always there.
 *
 * The landing page is a long scroll now: a hero, an interactive derivation,
 * and several sections of prose. Somebody who reads to the bottom and decides
 * they want to try it should not have to scroll back up to find out how, and
 * somebody in the demo should always have a way back to the explanation.
 */
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className={styles.bar}>
      <Link to="/" className={styles.wordmark}>
        Dusky
      </Link>
      <nav className={styles.nav}>
        <ThemeToggle />
        {children}
      </nav>
    </header>
  );
}
