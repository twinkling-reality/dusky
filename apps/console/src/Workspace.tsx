import { gate } from "@dusky/policy";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { RequirementsButton, RequirementsPanel, useRequirements } from "./Requirements.js";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";
import { codeProblem, isCode, mintCode, type PairMode } from "./session.js";
import { originOf, type Source, sitesFromQuery } from "./sources.js";
import { useConsoleLink } from "./useConsoleLink.js";
import styles from "./Workspace.module.css";

/**
 * Everything in one tab: what the wearer sees, the site the tools live in, and
 * every protocol call as it happens.
 *
 * This page is not a viewer. It is where the tools actually run, in the
 * partner site's own document, in this browser's own session, which is why it
 * has to stay open and why Dusky never holds anybody's credentials. That is
 * the security model rather than a limitation, so the page says so instead of
 * letting someone discover it by closing the tab.
 */

const RELAY_URL = import.meta.env["VITE_RELAY_URL"] ?? "ws://localhost:7900/console";
const DISPLAY_URL = import.meta.env["VITE_DISPLAY_URL"] ?? "http://localhost:7802";

/**
 * What you are looking at, on the same terms as the requirements dropdown.
 *
 * This page carried a paragraph about the security model above the fold and a
 * caption under every heading, and all of it was cut because none of it was
 * what a stranger needed. Cutting it left nothing at all: four labelled boxes
 * and no way to find out what any of them is.
 *
 * A dropdown costs nothing to anybody who does not open it, which is what makes
 * it the right home for text that only some people need. The last line is the
 * one that matters: it says what to press.
 */
function WhatIsThis({
  heading,
  sites,
  onClose,
}: {
  heading: string;
  sites: readonly Source[];
  onClose: () => void;
}) {
  const box = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const el = box.current;
      const t = e.target as Node | null;
      if (!el || !t) return;
      if (el.contains(t) || (t instanceof Element && t.closest("[aria-controls=what]"))) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  return (
    <section id="what" ref={box} className={styles.what} data-squircle="" aria-label="What is this">
      <dl className={styles.whatList}>
        <div>
          <dt>Glasses</dt>
          <dd>The screen a wearer sees, running in this tab. A real pair loads the same page.</dd>
        </div>
        <div>
          <dt>{heading}</dt>
          <dd>
            {sites.length > 1
              ? "Live sites, unrelated to each other. Dusky read the actions each one publishes and built that screen from all of them."
              : "A live site. Dusky read the actions it publishes and built that screen from them."}
          </dd>
        </div>
        <div>
          <dt>Declared actions</dt>
          <dd>What each site published, and whether each action stops for you first.</dd>
        </div>
        <div>
          <dt>Activity</dt>
          <dd>Every call between Dusky and those sites, as it happens.</dd>
        </div>
      </dl>
      <p className={styles.whatDo}>Press a row on the glasses. Watch the matching site change.</p>
    </section>
  );
}

export function Workspace() {
  const probe = useRequirements();
  const [reqOpen, setReqOpen] = useState(false);
  const [whatOpen, setWhatOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  /*
   * Every site at once, which is the whole product.
   *
   * This was one source wrapped in an array, and that array was the only thing
   * holding Dusky to one business at a time: `getTools({ fromOrigins })` has
   * always taken a list, tool identity has always been (origin, name), and the
   * menu has always ordered a mixed registry. Nothing downstream changed to
   * make this work.
   *
   * `?source=` still narrows it, and nothing on the page offers that. See the
   * note on `sitesFromQuery`.
   */
  const sites = useMemo(() => sitesFromQuery(params.toString()), [params]);

  /*
   * What the relay is told, and it must be a STABLE array.
   *
   * The connect effect depends on this, so rebuilding it every render would
   * reopen the socket every render. `sites` is memoised on the search string,
   * so this is too.
   */
  const held = useMemo(() => sites.map((s) => ({ origin: originOf(s), name: s.name })), [sites]);

  /*
   * A code in the URL means somebody already started a session. `?start=1`
   * means they have not, and want to: it is what the front door's one button
   * links to, so a visitor lands on a running Dusky rather than on a page with
   * another button in the middle of it.
   *
   * Minted in the initialiser rather than in an effect. An effect that mints
   * runs twice under StrictMode and the second code silently replaces the
   * first, which is a session nobody is connected to. The initialiser settles
   * on one value for the mounted component and the effect below only ever
   * copies it into the URL.
   */
  const fromUrl = params.get("session");
  const [session, setSession] = useState<string | null>(() =>
    fromUrl && isCode(fromUrl)
      ? fromUrl.toUpperCase()
      : params.get("start") === "1"
        ? mintCode()
        : null,
  );
  // `?mode=glasses` says the code came off a lens, so no panel is embedded.
  const [mode, setMode] = useState<PairMode>(
    params.get("mode") === "glasses" ? "glasses" : "embedded",
  );
  const [typed, setTyped] = useState("");

  const link = useConsoleLink(RELAY_URL, session ?? "", held, session !== null);

  /**
   * What to call the box holding the sites, and what to call a row's site.
   *
   * One site keeps its own name as the heading, which is what this page looked
   * like when it could only hold one, and is what `?source=` still produces.
   * Several of them get a plain label, because no business name is true above a
   * box containing another business.
   */
  const heading = sites.length === 1 ? (sites[0] as Source).name : "Sites";
  const nameOf = (origin: string) =>
    held.find((h) => h.origin === origin)?.name ?? new URL(origin).host;

  // Arrow keys reach the panel only when the frame has focus, and a judge who
  // has to discover that is a judge who thinks the demo is broken.
  const lens = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    if (mode !== "embedded" || !session) return;
    const t = setTimeout(() => {
      /*
       * Not if the panel already has it. Focus inside a frame makes the frame
       * itself the active element out here, so focusing it again is a no-op
       * for the page and a BLUR for whatever is focused within it. With the
       * session starting on arrival rather than on a click, this timer now
       * fires 600ms after load, which is comfortably inside the time it takes
       * to open the composer and start typing: it committed a half-typed value
       * and advanced the frame out from under the wearer.
       */
      if (document.activeElement === lens.current) return;
      lens.current?.focus();
    }, 600);
    return () => clearTimeout(t);
  }, [mode, session]);

  /*
   * One place that writes the session into the URL, whatever started it: the
   * button, a pasted code, or `?start=1`. Three call sites each building their
   * own query string is how `start=1` would have survived into the shareable
   * link and re-minted a second session for whoever opened it.
   */
  useEffect(() => {
    if (!session) return;
    if (params.get("session") === session && !params.has("start")) return;
    const next = new URLSearchParams(params);
    next.set("session", session);
    next.delete("start");
    setParams(next, { replace: true });
  }, [session, params, setParams]);

  /*
   * Back to the start card, which is the only place pairing is explained.
   *
   * Somebody who owns glasses arrives here through the front door's one button,
   * which mints a session and embeds the panel, and there was then no route to
   * the pairing form at all: it lives on the card that `?start=1` skips. The
   * code itself is deliberately NOT printed here, because the code a wearer
   * types is the one on their own lens, not the one this page minted.
   */
  const unpair = () => {
    setSession(null);
    setMode("embedded");
    const next = new URLSearchParams(params);
    next.delete("session");
    next.delete("start");
    setParams(next, { replace: true });
  };

  const start = () => {
    setMode("embedded");
    setSession(mintCode());
  };

  const pairGlasses = (code: string) => {
    // No embedded panel in this mode: the relay allows one Display per
    // session, so a second one would close the wearer's.
    setMode("glasses");
    setSession(code.toUpperCase());
  };

  return (
    <>
      <SiteHeader>
        {/*
          The same control the front door uses, rather than a warning banner of
          this page's own.

          There were three copies of "WebMCP is not enabled": a banner here, the
          error frame on the lens, and the activity log. The lens and the log
          are both reporting a real failure and have to say it. This one was the
          only one that was ours to delete, and the component that says it
          properly already existed.
        */}
        {/*
          The way back to pairing, in the header with the other ways out.

          It sat over the grid in a row of its own, beside two source buttons
          for choosing which single site Dusky held. Those are gone with the
          restriction they controlled: holding every site at once means a
          control for choosing one of them is a control for using less of the
          product, and it would have to be labelled "show me fewer of the things
          you can do".

          That left one link alone on a row costing the page fifty pixels it no
          longer has, because three site frames and eleven actions need the height.
          It was never a control over the content anyway. It is the way to a
          different mode, which is what the header is for.
        */}
        {session && mode === "embedded" && (
          <button type="button" className={styles.pairLink} onClick={unpair}>
            Pair glasses
          </button>
        )}
        {session && (
          <div className={styles.reqAnchor}>
            <button
              type="button"
              className={styles.reqBtn}
              onClick={() => setWhatOpen((v) => !v)}
              aria-expanded={whatOpen}
              aria-controls="what"
            >
              What is this?
            </button>
            {whatOpen && (
              <WhatIsThis heading={heading} sites={sites} onClose={() => setWhatOpen(false)} />
            )}
          </div>
        )}
        <div className={styles.reqAnchor}>
          <RequirementsButton
            probe={probe}
            open={reqOpen}
            onToggle={() => setReqOpen((v) => !v)}
            className={styles.reqBtn}
          />
          {reqOpen && <RequirementsPanel probe={probe} onClose={() => setReqOpen(false)} />}
        </div>
        <Link className={header.link} to="/">
          Home
        </Link>
      </SiteHeader>

      <div className={styles.page}>
        {!session ? (
          <section className={styles.startCard}>
            {/*
              Two places to put the output, not two products.

              This card used to offer "Try it now, no glasses" and "Or pair a
              REAL pair of glasses", which reads as a toy and the actual thing.
              It is one build either way: the panel below is an iframe onto the
              same apps/display the glasses load, over the same relay, driving
              the same tools in the same site. The only difference is whether
              the pixels land on a monitor or on a waveguide.
            */}
            <h1 className={styles.h1}>Where do you want the screen?</h1>
            <button type="button" className={styles.primary} onClick={start}>
              Run it in this browser
            </button>
            <p className={styles.hint}>
              Opens the glasses build below, on the same relay, driving the same tools in the same
              site. Arrow keys and Enter, or just click.
            </p>
            <form
              className={styles.pair}
              onSubmit={(e) => {
                e.preventDefault();
                if (isCode(typed)) pairGlasses(typed);
              }}
            >
              <label className={styles.label} htmlFor="code">
                Or send it to your Ray-Ban Display
              </label>
              <div className={styles.pairRow}>
                <input
                  id="code"
                  className={styles.input}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value.toUpperCase())}
                  placeholder="ABCDEF"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className={styles.btn} type="submit" disabled={!isCode(typed)}>
                  Pair
                </button>
              </div>
              <p className={styles.hint}>{codeProblem(typed) ?? "The six letters on the lens."}</p>
            </form>
          </section>
        ) : (
          <>
            {/*
              Four cells on a two by two grid.

              Top row is the two live things, bottom row is the two records of
              what they did, and the two columns line up down the page. Before
              this the log hung off the bottom of one column on its own and the
              two columns ended at different heights, which is what made it read
              as parts rather than as a page.
            */}
            <div className={styles.grid}>
              <section className={styles.cell}>
                <h2 className={styles.h2}>Glasses</h2>
                {/*
                  Which window is driving this session.

                  `useConsoleLink` has computed `superseded` since two tabs on
                  one code were first made to stop fighting, and nothing ever
                  rendered it. So the window that LOST kept its heading, its
                  tool list and its activity log, and looked exactly like the
                  one that won. With two browsers open, which is the ordinary
                  case the moment somebody needs a second one with the WebMCP
                  flag, there was no way to tell them apart at all.

                  Same shape as `workingFrame` being computed and never
                  transmitted: a state the code knows and the person does not.
                */}
                {link.link === "superseded" && (
                  <p className={styles.hint} role="status">
                    <strong>Another window took over this session.</strong> Nothing here is live any
                    more. Close this window, or pair it again to take the session back.
                  </p>
                )}
                {mode === "embedded" ? (
                  <div className={styles.stage} data-squircle="">
                    <iframe
                      ref={lens}
                      className={styles.lens}
                      title="Dusky on the glasses"
                      src={`${DISPLAY_URL}/?session=${session}`}
                    />
                  </div>
                ) : (
                  <p className={styles.hint}>
                    Paired to glasses showing <strong>{session}</strong>. No panel is embedded here
                    on purpose: a session takes one Display, and a second would disconnect yours.
                  </p>
                )}
              </section>

              <section className={styles.cell}>
                <h2 className={styles.h2}>{heading}</h2>
                {/*
                  One frame per site, side by side rather than stacked.

                  Side by side because the whole argument is on this row: two
                  businesses that have never heard of each other, running in
                  this browser, in this person's own session, driving one menu.
                  Stacked they would not fit, and `frontdoor.spec.ts` holds the
                  page to one 1440x900 screen because a page whose job is "look,
                  it works" cannot ask anybody to scroll to find out whether it
                  did.
                */}
                <div className={styles.sites} data-many={sites.length > 3 ? "" : undefined}>
                  {sites.map((s) => (
                    <figure key={s.id} className={styles.site}>
                      {/*
                        allow="tools" delegates the WebMCP permissions policy to
                        this frame. Without it, and without the site naming our
                        origin in exposedTo, getTools returns nothing. That is
                        the intended security property, and it is granted once
                        per site rather than once for the page.
                      */}
                      <iframe
                        className={styles.frame}
                        data-squircle=""
                        title={s.name}
                        src={s.url}
                        allow="tools"
                      />
                      {/* The origin is the one value worth printing beside a
                          name: it is how anybody can see the tools were read
                          from somewhere other than this page, and with several
                          sites it is how they can see they are different
                          somewheres. */}
                      <figcaption className={styles.siteName}>
                        {s.name}
                        <span className={styles.origin}>{originOf(s)}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>

              <section className={styles.cell}>
                <h2 className={styles.h2}>Declared actions</h2>
                {/* A stable hook. Tests used to find this list by filtering for
                    an origin string that happened to be printed in every row,
                    which broke the moment the rows stopped printing it. */}
                <ul className={styles.tools} data-testid="actions">
                  {link.tools.map((t) => {
                    const g = gate(t);
                    return (
                      <li key={`${t.origin}/${t.name}`} className={styles.tool}>
                        {/* The name and the ceremony policy assigned it. The
                            descriptions were three more lines each saying what
                            the lens beside them already says in the site's own
                            words. */}
                        <span className={styles.toolName}>{t.title ?? t.name}</span>
                        {/* Whose action this is, on the row rather than in a
                            heading above a group. One list is the claim being
                            made: these arrived together, they order together,
                            and one sentence can reach across them. Grouping
                            them by site would draw the boundary the product
                            exists to remove. Omitted entirely when there is
                            only one site, because then every row would carry
                            the same word. */}
                        {sites.length > 1 && (
                          <span className={styles.toolSite}>{nameOf(t.origin)}</span>
                        )}
                        <span
                          className={styles.chip}
                          data-consequence={g.consequence}
                          title={g.reason}
                        >
                          {g.requiresConfirmation ? "gated" : "read"}
                        </span>
                      </li>
                    );
                  })}
                  {/*
                    Said per site, because one site answering is not evidence
                    about another.

                    A shared flag would have reported every site still loading
                    as having granted nothing, in the same breath as one that
                    really had. Both sentences below are about what ARRIVED
                    rather than about somebody else's page, which is the only
                    kind that stays true: a site may have declared plenty and
                    not named this origin, and none of that is visible here.
                  */}
                  {sites
                    .filter((s) => !link.tools.some((t) => t.origin === originOf(s)))
                    .map((s) => (
                      <li key={s.id} className={styles.empty}>
                        {link.problem ? (
                          // Could not look, which is not the same as nothing
                          // to see and must not be reported as it. The reason
                          // itself is on the lens and in Activity; repeating
                          // it once per site would be the same sentence
                          // several times over.
                          `Could not read what ${s.name} declared.`
                        ) : link.settled(originOf(s)) ? (
                          <>
                            {s.name} offered nothing. A site has to name this exact origin in{" "}
                            <code>exposedTo</code> before the browser will show Dusky anything.
                          </>
                        ) : (
                          `Reading what ${s.name} declared.`
                        )}
                      </li>
                    ))}
                </ul>
              </section>

              <section className={styles.cell}>
                <h2 className={styles.h2}>Activity</h2>
                <pre className={styles.log} data-squircle="">
                  {link.activity.length ? link.activity.join("\n") : "no calls yet"}
                </pre>
              </section>
            </div>

            {/* Last line on the page, because it is a footnote and not a
                briefing, and because somebody must not learn it by closing
                the tab and losing the session. */}
            <p className={styles.standing}>Closing this tab ends the session.</p>
          </>
        )}
      </div>
    </>
  );
}
