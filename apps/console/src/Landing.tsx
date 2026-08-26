import { useState } from "react";
import { Link } from "react-router";
import { Checklist } from "./Checklist.js";
import { DerivationControls, DerivationPanel, useDerivation } from "./Derivation.js";
import styles from "./Landing.module.css";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";

/**
 * The front door.
 *
 * A sentence, the thing the sentence is about, and the two ways in. Everything
 * sits in its own hairline cell, so the page reads as a sheet rather than as a
 * column of blocks.
 *
 * The panel is live. That is the one decision here that is not taste: this
 * page exists to stop asking a judge to take "nothing is hardcoded" on faith,
 * and a picture of the interface would put the asking straight back.
 */

const REPO = "https://github.com/twinkling-reality/dusky";

export function Landing() {
  const [examples, setExamples] = useState(false);
  const derivation = useDerivation();

  return (
    <>
      <SiteHeader>
        <button type="button" className={header.link} onClick={() => setExamples((v) => !v)}>
          Examples
        </button>
        <a className={header.link} href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </SiteHeader>

      <main className={styles.page}>
        <div className={styles.sheet}>
          <section className={styles.saying}>
            <h1 className={styles.claim}>A browser for a web made of tools instead of pages.</h1>
            <p className={styles.lede}>
              Dusky reads the actions a site publishes over WebMCP and turns them into an interface
              for Meta Ray-Ban Display: 600 by 600, six keys, no cursor. There is no per-site
              integration anywhere in it.
            </p>
          </section>

          <section className={styles.lens}>
            <span className={styles.cellLabel}>On the glasses, live</span>
            <DerivationPanel d={derivation} />
          </section>

          <Link className={styles.action} to="/demo">
            <span className={styles.actionName}>Open the demo</span>
            <span className={styles.actionNote}>
              Pre-paired, no typing, no glasses. Needs Chrome 149+ with the WebMCP flag.
            </span>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
          </Link>

          <button type="button" className={styles.action} onClick={() => setExamples((v) => !v)}>
            <span className={styles.actionName}>{examples ? "Hide examples" : "See examples"}</span>
            <span className={styles.actionNote}>
              Four schemas, editable. Change one and the panel above answers.
            </span>
            <span className={styles.arrow} aria-hidden="true">
              {examples ? "↑" : "↓"}
            </span>
          </button>

          <a className={styles.action} href={REPO} target="_blank" rel="noreferrer">
            <span className={styles.actionName}>Read the source</span>
            <span className={styles.actionNote}>
              Every claim on this page has a test behind it in the repository.
            </span>
            <span className={styles.arrow} aria-hidden="true">
              ↗
            </span>
          </a>
        </div>

        <div className={styles.status}>
          <Checklist />
        </div>

        {examples && (
          <section className={styles.examples}>
            <DerivationControls d={derivation} />
          </section>
        )}
      </main>
    </>
  );
}
