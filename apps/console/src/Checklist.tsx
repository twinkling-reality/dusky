import { isWebMcpAvailable, registerTools } from "@dusky/webmcp";
import { useCallback, useEffect, useState } from "react";
import styles from "./Checklist.module.css";

/**
 * What has to be true before Dusky can do anything, and what to do about each
 * thing that is not.
 *
 * Every item here is PROBED rather than assumed, because the failures this
 * catches all look identical from the outside: an empty menu. A red dot with
 * no remedy would just be a more decorative way of saying it is broken.
 *
 * It collapses to a single line once everything passes, because a checklist
 * that stays expanded after it has nothing left to tell you is furniture.
 */

const RELAY_HTTP = httpFromWs(import.meta.env["VITE_RELAY_URL"] ?? "ws://localhost:7900/console");

/** The relay's health endpoint lives on the same host as its socket. */
function httpFromWs(ws: string): string {
  try {
    const u = new URL(ws);
    u.protocol = u.protocol === "wss:" ? "https:" : "http:";
    u.pathname = "/health";
    u.search = "";
    return u.toString();
  } catch {
    return "http://localhost:7900/health";
  }
}

type State = "checking" | "ok" | "bad";

interface Check {
  id: string;
  label: string;
  state: State;
  /** What to actually do. Never just "failed". */
  fix?: React.ReactNode;
  detail?: string;
}

const FLAG = "chrome://flags/#enable-webmcp-testing";

export function Checklist() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [open, setOpen] = useState(false);

  const run = useCallback(async () => {
    const out: Check[] = [];

    // 1. Is the API there at all?
    const present = isWebMcpAvailable();
    out.push({
      id: "api",
      label: "This browser speaks WebMCP",
      state: present ? "ok" : "bad",
      fix: (
        <>
          Use Chrome 149 or later with <code>{FLAG}</code> enabled, or the ChatGPT desktop app's
          built-in browser, which has it on by default. Dusky consumes another site's tools, and
          only a browser can grant that.
        </>
      ),
    });

    // 2. Does it WORK? A half-enabled flag leaves the object in place and
    //    fails on the first real call, which looks like Dusky being broken.
    if (present) {
      const probe = "dusky_selftest";
      const lifetime = new AbortController();
      try {
        await registerTools(
          [
            {
              name: probe,
              title: "Dusky self test",
              description: "Registered for a moment to confirm this browser can see its own tools.",
              inputSchema: { type: "object", properties: {} },
              annotations: { readOnlyHint: true },
              execute: async () => "ok",
            },
          ],
          { exposedTo: [location.origin], signal: lifetime.signal },
        );
        const mc = (
          document as unknown as { modelContext: { getTools(): Promise<{ name: string }[]> } }
        ).modelContext;
        const seen = (await mc.getTools()).some((t) => t.name === probe);
        out.push({
          id: "works",
          label: "Tools can be registered and read back",
          state: seen ? "ok" : "bad",
          fix: (
            <>
              The API is present but did not return a tool this page just registered. That usually
              means the flag is set but the browser needs a full restart, not just a new tab.
            </>
          ),
        });
      } catch (err) {
        out.push({
          id: "works",
          label: "Tools can be registered and read back",
          state: "bad",
          detail: err instanceof Error ? err.message : String(err),
          fix: <>Restart the browser after enabling the flag, then reload this page.</>,
        });
      } finally {
        lifetime.abort();
      }
    }

    // 3. Is the relay up? It holds the session, so nothing works without it.
    try {
      const res = await fetch(RELAY_HTTP, { cache: "no-store" });
      const body = (await res.json()) as { ok?: boolean };
      out.push({
        id: "relay",
        label: "Dusky's session relay is reachable",
        state: body.ok === true ? "ok" : "bad",
        fix: <>The relay answered but not with a healthy response. Try again in a minute.</>,
      });
    } catch (err) {
      out.push({
        id: "relay",
        label: "Dusky's session relay is reachable",
        state: "bad",
        detail: err instanceof Error ? err.message : String(err),
        fix: (
          <>
            The relay at <code>{RELAY_HTTP}</code> did not answer. It holds the session that joins
            the glasses to this browser, so nothing will pair until it does. If you are running
            Dusky locally, start it with <code>pnpm dev</code>.
          </>
        ),
      });
    }

    setChecks(out);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  if (checks.length === 0) {
    return <p className={styles.line}>Checking this browser...</p>;
  }

  const bad = checks.filter((c) => c.state === "bad");
  const allGood = bad.length === 0;

  // Green and quiet, or open on exactly the things that are wrong.
  if (allGood && !open) {
    return (
      <p className={styles.line} data-state="ok">
        <span className={styles.dot} data-state="ok" aria-hidden="true" />
        Everything this needs is working in this browser.
        <button type="button" className={styles.toggle} onClick={() => setOpen(true)}>
          show the checks
        </button>
      </p>
    );
  }

  return (
    <section className={styles.wrap} data-state={allGood ? "ok" : "bad"}>
      <header className={styles.head}>
        <h2 className={styles.h2}>
          {allGood ? "All clear" : `${bad.length} thing${bad.length === 1 ? "" : "s"} to fix first`}
        </h2>
        <button type="button" className={styles.toggle} onClick={() => void run()}>
          check again
        </button>
      </header>
      <ul className={styles.list}>
        {checks.map((c) => (
          <li key={c.id} className={styles.item} data-state={c.state}>
            <span className={styles.dot} data-state={c.state} aria-hidden="true" />
            <div className={styles.body}>
              <span className={styles.label}>{c.label}</span>
              {c.state === "bad" && (
                <>
                  <p className={styles.fix}>{c.fix}</p>
                  {c.detail && <p className={styles.detail}>{c.detail}</p>}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {allGood && (
        <button type="button" className={styles.toggle} onClick={() => setOpen(false)}>
          hide
        </button>
      )}
    </section>
  );
}
