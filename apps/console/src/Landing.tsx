import { Link } from "react-router";
import { Checklist } from "./Checklist.js";
import { Derivation } from "./Derivation.js";
import styles from "./Landing.module.css";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";

/**
 * The front door.
 *
 * One decision shapes it: the claim and the proof share a screen. The panel
 * beside the headline is a live 600 by 600 Display, the same component the
 * glasses run, and everything below it is the schema that produced what is on
 * it. A judge who reads the first sentence has already seen the argument.
 *
 * The demo needs WebMCP; the panel does not. So the thing that always works is
 * the thing above the fold, and somebody in the wrong browser meets an
 * explanation rather than a wall.
 *
 * Prose is kept short deliberately. This is a front door, not the
 * documentation: the repository holds the long version and says so.
 */

const REPO = "https://github.com/twinkling-reality/dusky";
const FLAG = "chrome://flags/#enable-webmcp-testing";

/** Three things worth knowing, at the length somebody will actually read. */
const FACTS = [
  {
    title: "The tab stays open",
    body: "Tools run in your browser, inside the site's own document, in your session. Dusky never holds a credential, and closing the tab ends the session. That is the security model, not a limitation.",
  },
  {
    title: "Code decides, models suggest",
    body: "Whether an action stops for your approval is settled with no model, no network and no DOM. A site's own read-only claim can lower ceremony and never raise it.",
  },
  {
    title: "It cannot drive everything",
    body: "A parameter that is a nested object cannot be collected in one glance on six keys. Those tools are left off the menu rather than offered as a control that dead-ends.",
  },
];

export function Landing() {
  return (
    <>
      <SiteHeader>
        <a className={header.link} href={REPO} target="_blank" rel="noreferrer">
          Source
        </a>
        <Link className={header.cta} to="/demo">
          Try it now
        </Link>
      </SiteHeader>

      <div className={styles.page}>
        <Derivation
          intro={
            <>
              <h1 className={styles.claim}>A browser for a web made of tools instead of pages.</h1>
              <p className={styles.lede}>
                Dusky reads the actions a site publishes over WebMCP and turns them into an
                interface for Meta Ray-Ban Display: 600 by 600, six keys, no cursor. There is no
                per-site integration anywhere in it.
              </p>
              <div className={styles.actions}>
                <Link className={styles.primary} to="/demo">
                  Try it now, no glasses
                </Link>
                <a className={styles.secondary} href={REPO} target="_blank" rel="noreferrer">
                  Read the source
                </a>
              </div>
              <p className={styles.requires}>
                The live demo needs Chrome 149 or later with <code>{FLAG}</code>, or the ChatGPT
                desktop browser. Consuming another site&rsquo;s tools is a permission only a browser
                can grant. The panel beside this works in any browser.
              </p>
              <Checklist />
            </>
          }
        />

        <section className={styles.facts}>
          {FACTS.map((f) => (
            <article key={f.title} className={styles.fact}>
              <h2 className={styles.factTitle}>{f.title}</h2>
              <p className={styles.factBody}>{f.body}</p>
            </article>
          ))}
        </section>

        <footer className={styles.foot}>
          <a href={REPO} target="_blank" rel="noreferrer">
            Source, and the long version of all of this
          </a>
          <Link to="/demo">Open the demo</Link>
        </footer>
      </div>
    </>
  );
}
