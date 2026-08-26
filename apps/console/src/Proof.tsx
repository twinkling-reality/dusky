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
 * It had no heading for a while, on the theory that labelled columns say what
 * they are and a heading over them is a fourth thing saying it again. That was
 * wrong, and it was wrong for a reason worth writing down: the labels named the
 * wrong axis. They said how the two columns DIFFER, and never once said what
 * the code is, what the black square is, or that the first produced the second.
 * Somebody arriving cold had nothing at all.
 *
 * So there are three sentences here, and each of them carries something the
 * page cannot show. Not a fourth restatement of the columns.
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
        <header className={styles.head}>
          <h1 className={styles.title}>Where the screen comes from</h1>
          <p className={styles.intro}>
            A website can publish a machine-readable list of the things it can do. Dusky reads that
            list and builds the screen on the glasses out of it. Nothing on that screen was written
            for this shop, or for any other one.
          </p>
        </header>
        <Derivation />
      </main>
    </>
  );
}
