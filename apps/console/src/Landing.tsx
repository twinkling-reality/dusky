import { useState } from "react";
import { Link } from "react-router";
import { Callout } from "./Callout.js";
import { Checklist } from "./Checklist.js";
import { DerivationControls, DerivationPanel, useDerivation } from "./Derivation.js";
import styles from "./Landing.module.css";
import { Schematic } from "./Schematic.js";
import { SiteHeader } from "./SiteHeader.js";

/**
 * The front door: one screen, one object, three annotations.
 *
 * It is laid out as a parts drawing because that is what Dusky is about. The
 * glasses are a schematic; the leader line runs off the display lens to a
 * callout; and what is inside that callout is not a picture of the interface,
 * it is the interface, running, driven by the schema in the callout below it.
 *
 * That last part is the whole reason the page exists. An annotated diagram
 * with three paragraphs in it would be asking to be believed, which is the
 * thing two working demos already failed to avoid.
 */

const REPO = "https://github.com/twinkling-reality/dusky";

type Panel = "why" | "schema" | null;

export function Landing() {
  const [open, setOpen] = useState<Panel>(null);
  // One machine, shown in two places. The panel in the first callout and the
  // boxes in the third are the same session; editing one moves the other.
  const derivation = useDerivation();
  const toggle = (p: Panel) => setOpen((cur) => (cur === p ? null : p));

  return (
    <>
      <SiteHeader repo={REPO} />

      <main className={styles.page}>
        <div className={styles.stage}>
          <div className={styles.objectCol}>
            <h1 className={styles.claim}>A browser for a web made of tools instead of pages.</h1>
            <p className={styles.lede}>
              Dusky reads the actions a site publishes over WebMCP and turns them into an interface
              for Meta Ray-Ban Display. 600 by 600, six keys, no cursor, and no per-site integration
              anywhere in it.
            </p>
            <Schematic />
            <Checklist />
          </div>

          <div className={styles.calloutCol}>
            <Callout label="The lens" pinned>
              <DerivationPanel d={derivation} />
              <p className={styles.caption}>
                Live. The component the glasses run, driven by the same state machine over the same
                compiler, answering the schema under &ldquo;How&rdquo;. Click through it.
              </p>
            </Callout>

            <Callout
              label="Why"
              teaser="Why the tab has to stay open"
              expanded={open === "why"}
              onToggle={() => toggle("why")}
            >
              <p className={styles.body}>
                A tool does not run on Dusky&rsquo;s servers. It runs in your browser, inside the
                partner site&rsquo;s own document, in your own logged-in session. Dusky moves intent
                between the glasses and that tab and never moves a credential, which is why it never
                needs one. The cost is the tab: close it and the session ends, because the
                capability lived there and nowhere else.
              </p>
              <p className={styles.body}>
                Whether an action stops for your approval is settled by code with no model, no
                network and no DOM in it. A site&rsquo;s own <code>readOnlyHint</code> can lower
                ceremony and never raise it, because the site making the claim may be the one you
                need protecting from.
              </p>
            </Callout>

            <Callout
              label="How"
              teaser="Point it at a schema it has never seen"
              expanded={open === "schema"}
              onToggle={() => toggle("schema")}
            >
              <p className={styles.body}>
                Every box below is editable, and the lens above answers. Change a parameter from a
                string to an enum and the composer becomes buttons while you watch. A hardcoded
                interface cannot respond to an edit, which is the only version of this claim worth
                anything.
              </p>
              <DerivationControls d={derivation} />
            </Callout>
          </div>
        </div>

        <div className={styles.actions}>
          <Link className={styles.primary} to="/demo">
            Open the demo
          </Link>
          <span className={styles.actionsNote}>
            No glasses, no typing. Needs Chrome 149+ with the WebMCP flag, or the ChatGPT desktop
            browser.
          </span>
        </div>
      </main>
    </>
  );
}
