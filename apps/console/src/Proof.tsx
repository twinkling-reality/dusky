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
 * answer an edit. So the box is the page, and everything around it is a label.
 *
 * Labels, not paragraphs. This page had three explanatory blocks stacked above
 * the one thing worth reading, which is how a proof ends up unread.
 */

const REPO = "https://github.com/twinkling-reality/dusky";

interface Case {
  id: string;
  kicker: string;
  line: string;
  /** What in the repository backs it up, named so it can be checked. */
  evidence: string;
}

/* One line each. The box below is the argument; these are labels on it. */
const CASES: Case[] = [
  {
    id: "shop",
    kicker: "A shop",
    line: "Four tools. Every parameter a string.",
    evidence: "e2e/roundtrip.spec.ts",
  },
  {
    id: "restaurant",
    kicker: "A restaurant",
    line: "Three tools. An integer enum and a boolean.",
    evidence: "e2e/reservations.spec.ts",
  },
  {
    id: "yours",
    kicker: "Anything else",
    line: "Type a schema. Watch the screens change.",
    evidence: "packages/frames",
  },
];

export function Proof() {
  return (
    <>
      <SiteHeader>
        <Link className={header.link} to="/">
          Home
        </Link>
        <a className={header.link} href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </SiteHeader>

      <main className={styles.page}>
        <section className={styles.head}>
          <h1 className={styles.claim}>Nothing here is written per site.</h1>
          <p className={styles.lede}>
            Every screen is compiled from the tools a site declares over WebMCP.
          </p>
        </section>

        <ul className={styles.cases}>
          {CASES.map((c) => (
            <li key={c.id} className={styles.case}>
              <span className={styles.kicker}>{c.kicker}</span>
              <p className={styles.caseLine}>{c.line}</p>
              <code className={styles.evidence}>{c.evidence}</code>
            </li>
          ))}
        </ul>

        <section className={styles.derivation}>
          <Derivation />
        </section>

        <section className={styles.tail}>
          <p className={styles.tailBody}>
            A site has to name Dusky&rsquo;s origin in <code>exposedTo</code> first. That is the
            browser&rsquo;s rule, not ours.
          </p>
          <Link className={styles.tailAction} to="/demo?start=1">
            Open Dusky
            <span className={styles.arrow} aria-hidden="true">
              &rarr;
            </span>
          </Link>
        </section>
      </main>
    </>
  );
}
