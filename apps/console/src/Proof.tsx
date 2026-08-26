import { Link } from "react-router";
import { Derivation } from "./Derivation.js";
import styles from "./Proof.module.css";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";

/**
 * The argument, on its own route.
 *
 * Two working demos do not settle "nothing is written per site": a judge still
 * has to take it on faith that there is no file with two branches in it. An
 * EDITABLE declaration does settle it, because a hardcoded interface cannot
 * answer an edit. So the machine IS the page, and nothing is stacked above it.
 *
 * There is no headline, and that is deliberate. The three columns are labelled
 * Declared, Derived and Displayed, in sequence, and a headline over them would
 * be a fourth thing saying what they already say. What a stranger cannot infer
 * is that the left box can be typed into and the right panel is real, and both
 * of those are said beside the thing they are true of rather than above the
 * whole page.
 *
 * This page carried three summary cards and a closing paragraph as well. The
 * cards restated the chooser directly underneath them with different
 * membership, so the same taxonomy appeared twice and neither copy looked like
 * the one you could press.
 */

const REPO = "https://github.com/twinkling-reality/dusky";

export function Proof() {
  return (
    <>
      <SiteHeader>
        <Link className={header.link} to="/demo?start=1">
          Open Dusky
        </Link>
        <a className={header.link} href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </SiteHeader>

      <main className={styles.page}>
        {/* The document needs a name even where the page does not show one. */}
        <h1 className={styles.srOnly}>How a declaration becomes a screen</h1>
        <Derivation />
      </main>
    </>
  );
}
