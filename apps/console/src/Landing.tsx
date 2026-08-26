import { useEffect, useRef, useState } from "react";
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
 * The argument for the claim is not on this page. It is a route of its own at
 * /proof, because it was a drawer that unfolded a second screenful under a hero
 * and made this page two pages pretending to be one. A visitor who wants proof
 * goes and gets it; a visitor who wants the product presses the button.
 */

const REPO = "https://github.com/twinkling-reality/dusky";

const STAGE_ALT =
  "Dusky running: on the left the glasses view, headed Verdant Market, confirm, reading Add to " +
  "cart, oat-1, this spends money, and offering Confirm on enter or Cancel on escape. On the " +
  "right the shop itself, with its catalogue, and a log of every WebMCP call as it happens.";

export function Landing() {
  const probe = useRequirements();
  const [reqOpen, setReqOpen] = useState(false);

  /*
   * Opened once, by the page, the first time a requirement comes back unmet.
   *
   * Once, and latched: a visitor who reads it and closes it has been told, and
   * a panel that reopens on every re-probe is a panel nobody can get rid of.
   * The mark on the button keeps the verdict either way, so closing it loses
   * the remedy and never the answer.
   */
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current || probe.verdict !== "bad") return;
    announced.current = true;
    setReqOpen(true);
  }, [probe.verdict]);

  return (
    <>
      <SiteHeader>
        {/*
          "Proof", not "Examples".

          That page exists to remove the need to trust a claim, and a gallery
          of examples is not what removes it: an editable declaration compiling
          to screens in front of you is. "Examples" also reads as optional, and
          the one thing a sceptical reader is looking for is the opposite of
          optional.
        */}
        <Link className={header.link} to="/proof">
          Proof
        </Link>
        <a className={header.link} href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </SiteHeader>

      <main className={styles.page}>
        <section className={styles.hero}>
          {/*
            Four rules this copy is under, each one paid for by a version
            that broke it.

            No acronym and no term of art. A stranger owns "website",
            "glasses", "shop", "restaurant"; they do not own "declared
            tools", "gesture-driven" or "per-site integration".

            Nothing a competitor could print unchanged. "Use websites from
            your glasses" is equally true of screen mirroring, a voice
            assistant and a native app store, so it named a category rather
            than this product.

            Nothing the demo disproves. "Pick one, and it happens" was
            false: a consequential tool stops on the lens for a human yes,
            which is the best property in the project and was traded away
            for a rhythm.

            Range, never absence. "No code for any site" is the achievement
            and reads to a stranger as "supports nothing", so the claim is
            made by naming two unrelated sites on one code path instead.
          */}
          <h1 className={styles.claim}>Turn web actions into augmented reality.</h1>
          <p className={styles.lede}>
            Dusky uses WebMCP to turn website capabilities into dynamic, actionable interfaces for
            AR displays.
          </p>

          {/*
            Baseline-aligned with the subtitle rather than with the headline.
            The headline is the page talking; the subtitle and the buttons are
            the same sentence continuing into something you can press, and they
            sit on one line for that reason.

            "Open Dusky", not "Open the demo". /demo is the console, and the
            console is the product: it holds the site in an allow="tools"
            frame, calls getTools, and drives the real Session over the real
            relay. A wearer with hardware opens that same page and pairs a code
            instead of embedding the panel. Calling it a demo understated it,
            and understated it in exactly the place a reader decides how
            finished this is.
          */}
          <div className={styles.actions}>
            <Link className={styles.primary} to="/demo?start=1">
              Open Dusky
              <span className={styles.arrow} aria-hidden="true">
                &rarr;
              </span>
            </Link>

            {/* The dropdown hangs off this box, so it is anchored to the
                control that opened it rather than placed somewhere pleasing
                over the picture with no visible relationship to it. */}
            <div className={styles.reqAnchor}>
              <RequirementsButton
                probe={probe}
                open={reqOpen}
                onToggle={() => setReqOpen((v) => !v)}
                className={styles.secondary}
              />
              {reqOpen && <RequirementsPanel probe={probe} onClose={() => setReqOpen(false)} />}
            </div>
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
            width={2208}
            height={960}
          />
        </div>
      </main>
    </>
  );
}
