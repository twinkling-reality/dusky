import { gate } from "@dusky/policy";
import { ENABLE_HINT } from "@dusky/webmcp";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";
import { isCode, mintCode, type PairMode } from "./session.js";
import { SOURCES, sourceFromQuery } from "./sources.js";
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

export function Workspace() {
  const [params, setParams] = useSearchParams();
  const source = useMemo(() => sourceFromQuery(params.toString()), [params]);
  const origins = useMemo(() => [new URL(source.url).origin], [source]);

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

  const link = useConsoleLink(RELAY_URL, session ?? "", origins, session !== null, source.name);

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

  const switchSource = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("source", id);
    setParams(next, { replace: true });
  };

  return (
    <>
      <SiteHeader>
        {session && (
          <span className={header.state} data-state={link.link}>
            {session} &middot; {link.link}
          </span>
        )}
        <Link className={header.link} to="/">
          How it works
        </Link>
      </SiteHeader>

      <div className={styles.page}>
        {/*
          One line, and the rest behind it.
          
          The paragraph was correct and nobody read it, because a visitor who
          has just arrived to try something is not there to be briefed. The
          summary states the two facts a person has to leave with; the reason
          they are facts is one click away for anyone who wants it.
        */}
        <details className={styles.aside}>
          <summary className={styles.asideSummary}>
            Tools run in this tab, and closing this tab ends the session.
          </summary>
          <p className={styles.asideBody}>
            They run inside {source.name}&rsquo;s own document, in your own session, which is why
            Dusky never holds the site&rsquo;s credentials and never sees a login. Nothing is
            proxied through a server of ours. That is the security model, not a limitation: the tab
            staying open is the same thing as the permission being yours to withdraw.
          </p>
        </details>

        {!link.webmcp && <p className={styles.warn}>{ENABLE_HINT}</p>}

        {!session ? (
          <section className={styles.startCard}>
            <h1 className={styles.h1}>Start a session</h1>
            <button type="button" className={styles.primary} onClick={start}>
              Try it now, no glasses
            </button>
            <p className={styles.hint}>
              Dusky mints a pairing code and opens the Display below, running the same build the
              glasses run. Arrow keys and Enter, or just click.
            </p>
            <form
              className={styles.pair}
              onSubmit={(e) => {
                e.preventDefault();
                if (isCode(typed)) pairGlasses(typed);
              }}
            >
              <label className={styles.label} htmlFor="code">
                Or pair a real pair of glasses
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
              <p className={styles.hint}>The six letters on the lens.</p>
            </form>
          </section>
        ) : (
          <>
            {/*
              One strip, not a definition list.
              
              These are four short facts and they were set as a two-column
              table of uppercase labels, which took a block the height of the
              hero to say four words. Read left to right they are a status
              line, which is what they are.
            */}
            <div className={styles.bar}>
              <div className={styles.facts}>
                <span className={styles.fact}>
                  <span className={styles.factKey}>session</span>
                  <span className={styles.mono}>{session}</span>
                </span>
                <span className={styles.fact}>
                  <span className={styles.factKey}>relay</span>
                  <span className={styles.mono} data-state={link.link}>
                    {link.link}
                  </span>
                </span>
                <span className={styles.fact}>
                  <span className={styles.factKey}>actions found</span>
                  <span className={styles.mono}>{link.tools.length}</span>
                </span>
                {/* Dusky consumes other sites' tools everywhere else. Here it is
                    also a provider, so an agent in this browser can drive the
                    glasses through the same protocol. */}
                <span className={styles.fact}>
                  <span className={styles.factKey}>Dusky&rsquo;s own tools</span>
                  <span className={styles.mono} data-state={link.provides ? "open" : "offline"}>
                    {link.provides ? "registered for this browser agent" : "not registered"}
                  </span>
                </span>
              </div>
              <div className={styles.sources}>
                <span className={styles.sourcesLabel}>Point Dusky at</span>
                {SOURCES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={styles.sourceBtn}
                    data-on={s.id === source.id}
                    onClick={() => switchSource(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.grid}>
              <section className={styles.lensCol}>
                <h2 className={styles.h2}>
                  What the wearer sees
                  <span className={styles.note}>600 x 600, the real Display build</span>
                </h2>
                {mode === "embedded" ? (
                  <>
                    <div className={styles.stage}>
                      <iframe
                        ref={lens}
                        className={styles.lens}
                        title="Dusky on the glasses"
                        src={`${DISPLAY_URL}/?session=${session}`}
                      />
                    </div>
                    <details className={styles.aside}>
                      <summary className={styles.asideSummary}>How to drive it</summary>
                      <p className={styles.asideBody}>
                        Click the panel to give it the arrow keys, or click a choice directly. On
                        the glasses these are Neural Band pinches and temple swipes, which the OS
                        turns into exactly these six keys. There is no cursor and there is nothing
                        else to learn.
                      </p>
                    </details>
                  </>
                ) : (
                  <p className={styles.hint}>
                    Paired to glasses showing <strong>{session}</strong>. No panel is embedded here
                    on purpose: a session takes one Display, and a second would disconnect yours.
                  </p>
                )}

                {/*
                  Open, and collapsible.

                  Open because this list IS the argument: it is what the site
                  declared, and every screen on the lens came out of it.
                  Collapsible because somebody who has read it once should be
                  able to put it away and watch the panel instead.
                */}
                <details className={styles.section} open>
                  <summary className={styles.h2}>
                    Actions this source declared
                    <span className={styles.note}>from getTools, nothing written by hand</span>
                  </summary>
                  {/* A stable hook. Tests used to find this list by filtering for
                      an origin string that happened to be printed in every row,
                      which broke the moment the rows stopped printing it. */}
                  <ul className={styles.tools} data-testid="actions">
                    {link.tools.map((t, i) => {
                      const g = gate(t);
                      return (
                        <li key={`${t.origin}/${t.name}`} className={styles.tool}>
                          <span className={styles.idx}>{String(i + 1).padStart(2, "0")}</span>
                          <span className={styles.toolBody}>
                            <span className={styles.toolName}>{t.title ?? t.name}</span>
                            <span className={styles.toolDesc}>{t.description}</span>
                          </span>
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
                    {link.tools.length === 0 && (
                      <li className={styles.empty}>
                        No tools. A site has to name this exact origin in <code>exposedTo</code>{" "}
                        before the browser will show Dusky anything, so an empty list here usually
                        means that grant is missing or does not match, rather than that WebMCP is
                        broken.
                      </li>
                    )}
                  </ul>
                </details>
              </section>

              <section className={styles.siteCol}>
                <h2 className={styles.h2}>
                  {source.name}
                  <span className={styles.note}>{origins[0]}</span>
                </h2>
                {/*
                  allow="tools" delegates the WebMCP permissions policy to this
                  frame. Without it, and without the site naming our origin in
                  exposedTo, getTools returns nothing. That is the intended
                  security property.
                */}
                <iframe
                  className={styles.frame}
                  title={source.name}
                  src={`${source.url}?agent=${encodeURIComponent(location.origin)}`}
                  allow="tools"
                />

                <details className={styles.section} open>
                  <summary className={styles.h2}>
                    Protocol activity
                    <span className={styles.note}>every call, as it happens</span>
                  </summary>
                  <pre className={styles.log}>
                    {link.activity.length ? link.activity.join("\n") : "no calls yet"}
                  </pre>
                </details>
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
