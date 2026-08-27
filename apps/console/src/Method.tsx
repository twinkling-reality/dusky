import { Link } from "react-router";
import { Gate, Published, Sandbox, Screen } from "./Derivation.js";
import styles from "./Method.module.css";
import { CONTRAST } from "./presets.js";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";

/**
 * How Dusky works, in four sections.
 *
 * A heading, one sentence, and a picture. Nobody reads a page like this for
 * long, so nothing here gets a second sentence and nothing gets a paragraph.
 *
 * The headings are plain nouns on purpose. Earlier drafts called these things
 * "The shape" and "What stops for you", which is a voice rather than a label:
 * a reader scanning has to decode the metaphor before they learn anything, and
 * the whole point of a heading here is to be understood without being read.
 *
 * The security section is first because it is the strongest thing in this
 * project and it was not on the website at all: it lived in a collapsed
 * disclosure on /demo and in AGENTS.md, so a judge scoring WebMCP leverage
 * never saw it.
 */

const REPO = "https://github.com/twinkling-reality/dusky";

export function Method() {
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
        <h1 className={styles.title}>How Dusky works</h1>

        <section className={styles.section}>
          <h2 className={styles.h2}>Where things run</h2>
          <p className={styles.line}>
            Tools run in your own browser, inside the site&rsquo;s own page. Dusky never sees a
            password.
          </p>
          <ol className={styles.flow}>
            <li className={styles.step}>
              <span className={styles.mark} data-kind="lens" data-squircle="" aria-hidden="true" />
              <span className={styles.who}>Your glasses</span>
              <span className={styles.what}>you choose</span>
            </li>
            <li className={styles.step}>
              <span className={styles.mark} data-kind="relay" data-squircle="" aria-hidden="true" />
              <span className={styles.who}>Dusky&rsquo;s relay</span>
              <span className={styles.what}>carries it, holds the session</span>
            </li>
            <li className={styles.step}>
              <span
                className={styles.mark}
                data-kind="browser"
                data-squircle=""
                aria-hidden="true"
              />
              <span className={styles.who}>Your browser</span>
              <span className={styles.what}>runs the tool</span>
            </li>
          </ol>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>What a site publishes</h2>
          <p className={styles.line}>
            A site lists what it can do. Dusky builds the screen from that list.
          </p>
          <figure className={styles.figure}>
            <Published code={CONTRAST.before.tool} />
            <Screen side={CONTRAST.before} />
          </figure>
          <p className={styles.line}>
            Give <code>product_id</code> three permitted values and the same code draws buttons.
          </p>
          <figure className={styles.figure}>
            <Published code={CONTRAST.after.code} />
            <Screen side={CONTRAST.after} />
          </figure>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>What needs your approval</h2>
          <p className={styles.line}>
            Anything that spends money or deletes something stops and asks you first. This one calls
            itself a free storage checkup. It is named <code>delete_account</code>.
          </p>
          <figure className={styles.figure}>
            <Gate />
          </figure>
        </section>

        <section className={`${styles.section} ${styles.sectionWide}`}>
          <h2 className={styles.h2}>Try it</h2>
          <p className={styles.line}>Change the list. The screen changes.</p>
          <figure className={styles.wide}>
            <Sandbox />
          </figure>
        </section>
      </main>
    </>
  );
}
