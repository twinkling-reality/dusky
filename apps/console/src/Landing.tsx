import { useState } from "react";
import { Link } from "react-router";
import styles from "./Landing.module.css";
import { RequirementsButton, RequirementsPanel, useRequirements } from "./Requirements.js";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";

/**
 * The front door.
 *
 * A sentence, the two ways in, and the product itself sitting on a field of
 * light. The page is drawn inside a margin: two vertical rules and one
 * horizontal rule, drawn on the body in console.css, with the nav capsule
 * breaking the top rule where it crosses.
 *
 * The requirements used to be a permanent cell in a ruled sheet, which spent a
 * third of the front door telling a browser that already worked that it worked.
 * They are a button with a mark now, and the dropdown behind it opens ITSELF
 * the first time something comes back unmet. Nothing is quieter for the people
 * who are fine and nothing is later for the people who are not.
 *
 * The argument for the claim is not on this page and no longer has a page of
 * its own. /method was ten rebuilds of a schema printed beside the screen it
 * compiled to, and a schema is not readable at a glance: every version needed
 * a minute of reading to land an idea the page promised in five seconds. The
 * recorded demo carries it instead, where a voice can do the explaining.
 */

const REPO = "https://github.com/twinkling-reality/dusky";

const STAGE_ALT =
  "Dusky running: on the left the glasses view, headed Verdant Market, confirm, reading Add to " +
  "cart, oat-1, this spends money, and offering Confirm on enter or Cancel on escape. On the " +
  "right the shop itself, its cart still empty, and the catalogue the product was chosen from.";

export function Landing() {
  const probe = useRequirements();
  const [reqOpen, setReqOpen] = useState(false);

  return (
    <>
      <SiteHeader>
        {/*
          A verdict, not an action, so it sits with the other verdicts and the
          way out rather than in the row of things to press. It was next to
          "Open Dusky" in the identical pill shape, which made a status readout
          look like the second thing to do on the page. The demo page already
          carries it here, and two pages of one site should not disagree about
          where the same control lives.
        */}
        <div className={styles.reqAnchor}>
          <RequirementsButton
            probe={probe}
            open={reqOpen}
            onToggle={() => setReqOpen((v) => !v)}
            className={styles.reqBtn}
          />
          {reqOpen && <RequirementsPanel probe={probe} onClose={() => setReqOpen(false)} />}
        </div>
        <a className={header.link} href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </SiteHeader>

      <main className={styles.page}>
        <section className={styles.hero}>
          <h1 className={styles.claim}>Turn web actions into augmented reality.</h1>
          <p className={styles.lede}>
            Dusky uses WebMCP to turn website capabilities into dynamic, actionable interfaces for
            AR displays.
          </p>

          {/*
            Two ways in, side by side, decided once.

            This same question used to be asked twice: here, and again on the
            start card behind /demo, which `?start=1` exists to skip. So the
            front door offered one button and a floating underlined sentence,
            and the page it linked to asked the whole question over again.

            It is one decision and it belongs here, where somebody is deciding.
            "Open Dusky" runs the glasses build in this browser, because almost
            nobody arriving owns a pair and a first screen asking for a code off
            a lens they do not have is what this page exists to replace. The
            second button is the same size and the same row, because for the
            people it is for it is not a footnote.
          */}
          <div className={styles.actions}>
            <Link className={styles.primary} to="/demo?start=1">
              Open Dusky
              <span className={styles.arrow} aria-hidden="true">
                &rarr;
              </span>
            </Link>
            <Link className={styles.secondary} to="/demo">
              I have glasses
            </Link>
          </div>
        </section>

        {/*
          The stage: the product on a field of light.

          A real capture of a real session, taken by scripts/stage.mjs against
          a running system: the glasses view on the left, the site the tools are
          running in on the right, and the protocol log under it. Nothing in it
          is drawn for this page, so it cannot drift away from what Dusky does.

          A still standing in for the recording. The box does not care what
          size it is: the field is masked to nothing before it reaches an edge,
          so the recording replaces the <img> and nothing else moves.
        */}
        <div className={styles.stage}>
          <img
            className={styles.shot}
            data-squircle=""
            src="/stage.png"
            alt={STAGE_ALT}
            width={2784}
            height={900}
          />
        </div>
      </main>
    </>
  );
}
