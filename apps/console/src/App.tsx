import { gate } from "@dusky/policy";
import { ENABLE_HINT } from "@dusky/webmcp";
import { useMemo, useState } from "react";
import styles from "./App.module.css";
import { sourceFromQuery } from "./sources.js";
import { useConsoleLink } from "./useConsoleLink.js";

/**
 * The Dusky operator console.
 *
 * This is not the product's centre of gravity, and it should not try to be.
 * Its job is to hold the partner site in an allow="tools" frame, execute what
 * the session asks for, and show exactly what happened so nothing has to be
 * taken on trust.
 */

const RELAY_URL = import.meta.env["VITE_RELAY_URL"] ?? "ws://localhost:7900/console";
const DISPLAY_URL = import.meta.env["VITE_DISPLAY_URL"] ?? "http://localhost:7802";

export function App() {
  const [code, setCode] = useState("");
  const [paired, setPaired] = useState<string | null>(null);
  // Which partner site this console is holding. Two strings from a registry:
  // a name to print and a URL to frame. Everything the wearer sees still comes
  // from the tool schemas that site registers, not from which entry this is.
  const source = useMemo(() => sourceFromQuery(location.search), []);
  const origins = useMemo(() => [new URL(source.url).origin], [source]);
  const link = useConsoleLink(RELAY_URL, paired ?? "", origins, paired !== null);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <span className={styles.wordmark}>Dusky</span>
        <p className={styles.lede}>
          A browser for a web made of tools instead of pages. Actions run in the partner
          site&rsquo;s own document; the glasses decide.
        </p>
      </header>

      {!link.webmcp && <p className={styles.warn}>{ENABLE_HINT}</p>}

      <div className={styles.grid}>
        <section className={styles.col}>
          <h2 className={styles.h2}>Session</h2>
          {paired ? (
            <dl className={styles.kv}>
              <dt>Code</dt>
              <dd className={styles.mono}>{paired}</dd>
              <dt>Relay</dt>
              <dd className={styles.mono} data-state={link.link}>
                {link.link}
              </dd>
              <dt>Source</dt>
              <dd>{source.name}</dd>
              <dt>Origin</dt>
              <dd className={styles.mono}>{origins[0]}</dd>
              {/* Dusky is a WebMCP consumer everywhere else. Here it is also a
                  provider, so an agent in this browser can drive the glasses. */}
              <dt>Dusky tools</dt>
              <dd className={styles.mono} data-state={link.provides ? "open" : "offline"}>
                {link.provides ? "registered for this browser agent" : "not registered"}
              </dd>
            </dl>
          ) : (
            <form
              className={styles.pair}
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) setPaired(code.trim().toUpperCase());
              }}
            >
              <label className={styles.label} htmlFor="code">
                Pairing code from your glasses
              </label>
              <div className={styles.pairRow}>
                <input
                  id="code"
                  className={styles.input}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className={styles.btn} type="submit">
                  Pair
                </button>
              </div>
              <p className={styles.hint}>
                No glasses? Open the{" "}
                <a href={DISPLAY_URL} target="_blank" rel="noreferrer">
                  Display
                </a>{" "}
                in another tab: it runs the same build, driven by arrow keys and Enter.
              </p>
            </form>
          )}

          <h2 className={styles.h2}>
            Available actions
            <span className={styles.count}>{link.tools.length}</span>
          </h2>
          <ul className={styles.tools}>
            {link.tools.map((t, i) => {
              const g = gate(t);
              return (
                <li key={`${t.origin}/${t.name}`} className={styles.tool}>
                  <span className={styles.idx}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={styles.toolBody}>
                    <span className={styles.toolName}>{t.title ?? t.name}</span>
                    <span className={styles.toolDesc}>{t.description}</span>
                    <span className={styles.toolOrigin}>{t.origin}</span>
                  </span>
                  <span className={styles.chip} data-consequence={g.consequence} title={g.reason}>
                    {g.requiresConfirmation ? "gated" : "read"}
                  </span>
                </li>
              );
            })}
            {link.tools.length === 0 && (
              <li className={styles.empty}>
                {paired ? "No tools exposed to this origin yet." : "Pair to discover tools."}
              </li>
            )}
          </ul>
        </section>

        <section className={styles.col}>
          <h2 className={styles.h2}>Partner site</h2>
          {/*
            allow="tools" delegates the WebMCP permissions policy to this frame.
            Without it, and without the site naming our origin in exposedTo,
            getTools returns nothing. That is the intended security property.
          */}
          <iframe
            className={styles.frame}
            title={source.name}
            src={`${source.url}?agent=${encodeURIComponent(location.origin)}`}
            allow="tools"
          />

          <h2 className={styles.h2}>Protocol activity</h2>
          <pre className={styles.log}>
            {link.activity.length ? link.activity.join("\n") : "no calls yet"}
          </pre>
        </section>
      </div>
    </div>
  );
}
