import { isWebMcpAvailable, registerTools } from "@dusky/webmcp";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Requirements.module.css";

/**
 * What has to be true before Dusky can do anything, stated as requirements and
 * then PROBED against the browser reading them.
 *
 * Stated rather than only tested, because a visitor decides whether to open
 * Dusky before anything has had a chance to fail, and "you need Chrome 149
 * with a flag" is the single most useful sentence on this page for somebody
 * who does not have it.
 *
 * Probed rather than only stated, because every failure here looks identical
 * from the outside: an empty menu. A line with no remedy would just be a more
 * decorative way of saying it is broken.
 *
 * It used to be a permanent cell of the sheet, which meant a browser that met
 * all three requirements spent a third of the front door being told so. It is
 * now a dropdown hanging off its own button, plus one rule that keeps the old
 * guarantee: it OPENS ITSELF when a requirement comes back unmet. Nobody has to
 * press anything to be told the thing they need to know, and nobody who is
 * already fine has to read it.
 *
 * It hangs off the button rather than floating over the picture. A panel placed
 * somewhere pleasing on the stage is a panel with no visible relationship to
 * the thing that opened it, and it covered the product for exactly the visitors
 * who most needed to see what they were being asked to install a browser for.
 *
 * The probe is split from the presentation because two surfaces need the same
 * verdict at once: the button carries the state, and the dropdown carries the
 * remedy.
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

/**
 * `unknown` is not a softer `bad`. A requirement that could not be tested
 * here has not failed, and painting it red would be asserting a result from
 * not having run one.
 */
export type State = "checking" | "ok" | "bad" | "unknown";

export interface Requirement {
  id: string;
  /**
   * The requirement as a statement that is either true or false here.
   *
   * Short, and in words a stranger owns. "Chrome 149+ with the WebMCP flag"
   * named the remedy rather than the requirement, which meant the line read as
   * an instruction to somebody who did not yet know why they were being given
   * one. The remedy is in `fix`, one click down, where it belongs.
   */
  need: string;
  state: State;
  /** Why it is on the list at all. One line, shown whatever the state. */
  means: string;
  /** What to actually do about it. Never just "failed". */
  fix?: ReactNode;
  detail?: string;
}

const FLAG = "chrome://flags/#enable-webmcp-testing";

/** Why each line is on the list. Stated once, used by the probe and the panel. */
const MEANS = {
  api: "Dusky reads another site's tools out of your own session. Only the browser can hand those over.",
  works:
    "The flag can be set and the API still fail on the first real call, which looks like Dusky being broken.",
  relay:
    "The relay holds the session that joins the glasses to this tab. Nothing pairs without it.",
} as const;

/** Stated before anything is probed, so the list never appears out of nowhere. */
const PENDING: Requirement[] = [
  { id: "api", need: "This browser speaks WebMCP", state: "checking", means: MEANS.api },
  { id: "works", need: "Tools register and read back", state: "checking", means: MEANS.works },
  { id: "relay", need: "Dusky's relay answers", state: "checking", means: MEANS.relay },
];

export interface Probe {
  reqs: Requirement[];
  /** The verdict for THIS browser, which is what the button's mark draws. */
  verdict: State;
  unmet: number;
  /** Met over total, which is what the panel's header counts. */
  met: number;
  busy: boolean;
  run: () => void;
}

export function useRequirements(): Probe {
  const [reqs, setReqs] = useState<Requirement[]>(PENDING);
  const [busy, setBusy] = useState(false);
  /*
   * Which run is allowed to publish its answer.
   *
   * StrictMode calls this twice on mount, and the two probes do not have to
   * agree: `document.modelContext` can be absent for the first and present for
   * the next, so the first run finished "1 unmet", opened the panel on its own,
   * and then the second run quietly replaced the list with three green lines
   * underneath an alarm nobody could explain. Only the newest run writes.
   */
  const seq = useRef(0);

  const run = useCallback(async () => {
    const mine = ++seq.current;
    setBusy(true);
    setReqs(PENDING);
    const out: Requirement[] = [];

    // 1. Is the API there at all?
    const present = isWebMcpAvailable();
    out.push({
      id: "api",
      need: "This browser speaks WebMCP",
      means: MEANS.api,
      state: present ? "ok" : "bad",
      fix: (
        <>
          Enable <code>{FLAG}</code> and restart the browser, or use the ChatGPT desktop app&rsquo;s
          built-in browser, which has it on by default. Dusky consumes another site&rsquo;s tools,
          and only a browser can grant that.
        </>
      ),
    });

    // 2. Does it WORK? A half-enabled flag leaves the object in place and
    //    fails on the first real call, which looks like Dusky being broken.
    if (present) {
      /*
       * Named per run, not once. StrictMode probes twice and the two overlap:
       * a fixed name made the second registration a duplicate, the second run
       * recorded the failure, and a browser that meets every requirement was
       * told it met none of them. The registry is the thing being tested here,
       * so the test must not be what collides in it.
       */
      const probe = `dusky_selftest_${mine}`;
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
          need: "Tools register and read back",
          means: MEANS.works,
          state: seen ? "ok" : "bad",
          fix: (
            <>
              The API is present but did not return a tool this page just registered. That usually
              means the flag is set and the browser has not been fully restarted since.
            </>
          ),
        });
      } catch (err) {
        out.push({
          id: "works",
          need: "Tools register and read back",
          means: MEANS.works,
          state: "bad",
          detail: err instanceof Error ? err.message : String(err),
          fix: <>Restart the browser after enabling the flag, then reload this page.</>,
        });
      } finally {
        lifetime.abort();
      }
    } else {
      // Nothing to probe against. Saying so beats inventing either answer.
      out.push({
        id: "works",
        need: "Tools register and read back",
        means: MEANS.works,
        state: "unknown",
        fix: <>Nothing to test against until the line above passes.</>,
      });
    }

    // 3. Is the relay up? It holds the session, so nothing works without it.
    try {
      const res = await fetch(RELAY_HTTP, { cache: "no-store" });
      const body = (await res.json()) as { ok?: boolean };
      out.push({
        id: "relay",
        need: "Dusky's relay answers",
        means: MEANS.relay,
        state: body.ok === true ? "ok" : "bad",
        fix: <>The relay answered but not with a healthy response. Try again in a minute.</>,
      });
    } catch (err) {
      out.push({
        id: "relay",
        need: "Dusky's relay answers",
        means: MEANS.relay,
        state: "bad",
        detail: err instanceof Error ? err.message : String(err),
        fix: (
          <>
            <code>{RELAY_HTTP}</code> did not answer. It holds the session that joins the glasses to
            this browser, so nothing will pair until it does. Running Dusky locally? Start it with{" "}
            <code>pnpm dev</code>.
          </>
        ),
      });
    }

    if (seq.current !== mine) return;
    setReqs(out);
    setBusy(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const unmet = reqs.filter((r) => r.state === "bad").length;
  const met = reqs.filter((r) => r.state === "ok").length;
  const checking = reqs.some((r) => r.state === "checking");
  const verdict: State = checking ? "checking" : unmet > 0 ? "bad" : "ok";

  return { reqs, verdict, unmet, met, busy, run };
}

/**
 * The verdict as a mark rather than as a coloured dot.
 *
 * A dot says only that something is one of three colours, which leaves anyone
 * who cannot separate red from green with no information at all. These say
 * which state they are in by their SHAPE first: a tick, a warning triangle, a
 * dash for the one that was never tested, a broken ring while it is still
 * being worked out. Colour is confirmation, not the message.
 *
 * The mark carries its own words in a <title>, which is why there is no visually
 * hidden span beside it. A picture and a caption saying the same thing is the
 * same thing said twice to a screen reader.
 */
function Mark({ state, label, className }: { state: State; label: string; className?: string }) {
  const common = {
    className,
    role: "img",
    viewBox: "0 0 16 16",
    width: 15,
    height: 15,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    focusable: false,
    "data-state": state,
  };
  if (state === "ok") {
    return (
      <svg {...common}>
        <title>{label}</title>
        <circle cx="8" cy="8" r="6.4" />
        <path d="M5.2 8.2 7.1 10.1 10.9 5.9" />
      </svg>
    );
  }
  if (state === "bad") {
    return (
      <svg {...common}>
        <title>{label}</title>
        <path d="M8 1.9 15 14.2H1z" />
        <path d="M8 6.2v3.1" />
        <path d="M8 11.7h.01" />
      </svg>
    );
  }
  if (state === "unknown") {
    return (
      <svg {...common}>
        <title>{label}</title>
        <circle cx="8" cy="8" r="6.4" />
        <path d="M5.4 8h5.2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <title>{label}</title>
      <circle cx="8" cy="8" r="6.4" strokeDasharray="2.6 2.6" />
    </svg>
  );
}

/** The state in words, for the mark that draws it. */
const SAYS: Record<State, string> = {
  checking: "checking",
  ok: "met",
  bad: "unmet",
  unknown: "not testable here",
};

/**
 * The button that opens the dropdown, carrying the verdict as a mark.
 *
 * The mark is here rather than only inside the dropdown so a met requirement
 * costs the page an icon instead of a cell. It is also why the dropdown can
 * stay shut: the answer is already on screen, and only the remedy is behind a
 * click.
 */
export function RequirementsButton({
  probe,
  open,
  onToggle,
  className,
}: {
  probe: Probe;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="requirements"
      data-state={probe.verdict}
    >
      Requirements
      <Mark
        state={probe.verdict}
        label={
          probe.verdict === "checking"
            ? "checking"
            : probe.unmet > 0
              ? `${probe.unmet} unmet in this browser`
              : "all met in this browser"
        }
        className={styles.mark}
      />
    </button>
  );
}

/** A round outline button. Nothing filled until a pointer is on it. */
function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.icon}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 16 16"
        width="13"
        height="13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable={false}
      >
        {children}
      </svg>
    </button>
  );
}

/**
 * The dropdown.
 *
 * Positioned by whatever wraps it, which is always the button's own anchor, so
 * this file never decides where on the page it lands.
 *
 * A heading with a count, two round controls, and one line per requirement that
 * opens for the detail. Every requirement used to print its whole remedy at
 * once, so the panel was four paragraphs deep and the two lines that had passed
 * were the same size as the one that had not.
 */
export function RequirementsPanel({ probe, onClose }: { probe: Probe; onClose: () => void }) {
  const { reqs, verdict, met, busy, run } = probe;

  /*
   * Escape closes it, and so does a click anywhere that is not it. A panel that
   * appears on its own has to be dismissible without hunting for the one pixel
   * that dismisses it. `pointerdown` rather than `click`, so a press that
   * starts outside cannot land on something inside it on the way up.
   */
  const box = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const el = box.current;
      if (!el) return;
      const t = e.target as Node | null;
      // The trigger is outside this box and toggles on its own click. Letting
      // this fire too would close and reopen in the same gesture.
      if (
        t &&
        (el.contains(t) || (t instanceof Element && t.closest("[aria-controls=requirements]")))
      )
        return;
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
    <section
      id="requirements"
      ref={box}
      className={styles.panel}
      data-state={verdict}
      data-squircle=""
      aria-label="Requirements"
    >
      <header className={styles.head}>
        <h2 className={styles.title}>Requirements</h2>
        <span className={styles.count} data-state={verdict}>
          {busy ? "checking" : `${met}/${reqs.length}`}
        </span>
        <div className={styles.controls}>
          <IconButton label="Check again" onClick={() => void run()} disabled={busy}>
            <path d="M13.6 6.8A5.8 5.8 0 1 0 13 10.6" />
            <path d="M13.9 3.1v3.8h-3.8" />
          </IconButton>
          <IconButton label="Close" onClick={onClose}>
            <path d="m4.6 4.6 6.8 6.8M11.4 4.6l-6.8 6.8" />
          </IconButton>
        </div>
      </header>

      <ul className={styles.list}>
        {reqs.map((r) => (
          <li key={r.id}>
            {/*
              Open when it is not met, shut when it is.

              The remedy is the only thing on this panel anybody needs, and it
              belongs to whichever line failed. A met requirement still has to
              be READABLE, because a list that only shows failures is a list
              nobody read in time, but it does not have to be legible from
              across the room.
            */}
            <details className={styles.item} data-state={r.state} open={r.state !== "ok"}>
              <summary className={styles.itemHead}>
                <Mark state={r.state} label={SAYS[r.state]} className={styles.mark} />
                <span className={styles.need}>{r.need}</span>
                <span className={styles.chev} aria-hidden="true" />
              </summary>
              <div className={styles.body}>
                <p className={styles.means}>{r.means}</p>
                {r.state !== "ok" && r.fix && <p className={styles.fix}>{r.fix}</p>}
                {r.state !== "ok" && r.detail && <p className={styles.detail}>{r.detail}</p>}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
