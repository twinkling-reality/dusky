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
 * now a dropdown hanging off its own button, and the button carries the answer:
 * "Requirements" when everything is met, and the failing line verbatim when it
 * is not. Nothing opens by itself. A panel that appeared unbidden over the
 * product was louder than the thing it was reporting on, and the shut button
 * already says which part is missing.
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
  /** The thing being checked, as a short noun. */
  subject: string;
  /**
   * This browser's answer, in two or three words.
   *
   * Printed beside the subject, so a line reads "WebMCP  not enabled" and is
   * done. Every line used to carry a sentence explaining why it was on the
   * list at all, which tripled the panel to say nothing anybody had asked.
   */
  status: string;
  state: State;
  /** One directive, and only when there is something to do. */
  fix?: ReactNode;
  detail?: string;
}

const FLAG = "chrome://flags/#enable-webmcp-testing";

/** Stated before anything is probed, so the list never appears out of nowhere. */
const PENDING: Requirement[] = [
  { id: "api", subject: "WebMCP", status: "checking", state: "checking" },
  { id: "works", subject: "Tool registration", status: "checking", state: "checking" },
  { id: "relay", subject: "Relay", status: "checking", state: "checking" },
];

export interface Probe {
  reqs: Requirement[];
  /** The verdict for THIS browser, which is what the button's mark draws. */
  verdict: State;
  /**
   * What the button says.
   *
   * "Requirements" while everything is met, and the first unmet line verbatim
   * when it is not, so a browser that cannot run Dusky is told which part is
   * missing without opening anything. This panel no longer opens itself, and
   * that is only safe while the shut state carries the answer.
   */
  headline: string;
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
      subject: "WebMCP",
      status: present ? "enabled" : "not enabled",
      state: present ? "ok" : "bad",
      fix: (
        <>
          Turn on <code>{FLAG}</code> and restart Chrome. The ChatGPT desktop browser has it on
          already.
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
          subject: "Tool registration",
          status: seen ? "working" : "not working",
          state: seen ? "ok" : "bad",
          fix: <>Restart Chrome. The flag is set but does not take effect until you do.</>,
        });
      } catch (err) {
        out.push({
          id: "works",
          subject: "Tool registration",
          status: "failing",
          state: "bad",
          detail: err instanceof Error ? err.message : String(err),
          fix: <>Restart Chrome, then reload this page.</>,
        });
      } finally {
        lifetime.abort();
      }
    } else {
      // Nothing to probe against. Saying so beats inventing either answer.
      out.push({
        id: "works",
        subject: "Tool registration",
        status: "not tested",
        state: "unknown",
        fix: <>Nothing to test against until WebMCP is on.</>,
      });
    }

    // 3. Is the relay up? It holds the session, so nothing works without it.
    try {
      const res = await fetch(RELAY_HTTP, { cache: "no-store" });
      const body = (await res.json()) as { ok?: boolean };
      out.push({
        id: "relay",
        subject: "Relay",
        status: body.ok === true ? "connected" : "unhealthy",
        state: body.ok === true ? "ok" : "bad",
        fix: <>It answered but not healthily. Try again in a minute.</>,
      });
    } catch (err) {
      out.push({
        id: "relay",
        subject: "Relay",
        status: "no answer",
        state: "bad",
        detail: `${RELAY_HTTP} ${err instanceof Error ? err.message : String(err)}`,
        fix: (
          <>
            Running Dusky locally? Start it with <code>pnpm dev</code>.
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
  const first = reqs.find((r) => r.state === "bad");
  const headline = first ? `${first.subject} ${first.status}` : "Requirements";

  return { reqs, verdict, headline, unmet, met, busy, run };
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
 * The mark never carries words. Everywhere it appears the state is already in
 * text beside it, on the row as a status and on the button as its own label, so
 * a title here would be the same thing said twice to a screen reader.
 */
function Mark({ state, className }: { state: State; className?: string }) {
  const common = {
    className,
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
      <svg {...common} aria-hidden="true">
        <circle cx="8" cy="8" r="6.4" />
        <path d="M5.2 8.2 7.1 10.1 10.9 5.9" />
      </svg>
    );
  }
  if (state === "bad") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M8 1.9 15 14.2H1z" />
        <path d="M8 6.2v3.1" />
        <path d="M8 11.7h.01" />
      </svg>
    );
  }
  if (state === "unknown") {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="8" cy="8" r="6.4" />
        <path d="M5.4 8h5.2" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" strokeDasharray="2.6 2.6" />
    </svg>
  );
}

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
      /*
        The visible text is the whole name when something is wrong, because it
        IS the failure. Met and still-checking both read "Requirements", which
        the mark tells apart and nothing else would, so those two say which
        they are here.
      */
      aria-label={
        probe.verdict === "bad"
          ? probe.headline
          : probe.verdict === "checking"
            ? "Requirements, checking"
            : "Requirements, all met"
      }
    >
      {probe.headline}
      <Mark state={probe.verdict} className={styles.mark} />
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
 * A heading with a count, two round controls, and one line per requirement:
 * what was checked, what this browser answered, and one instruction under
 * whichever line needs one. Nothing collapses, because with the prose gone
 * there is nothing left worth hiding.
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
          /*
            One line, and a directive under it when there is something to do.

            Every line used to be a disclosure holding a sentence about why the
            requirement exists and a second one about how to fix it, so a
            browser missing one thing got four paragraphs and had to read all
            of them to find the one instruction. A met line is now three words
            and no body at all.
          */
          <li key={r.id} className={styles.item} data-state={r.state}>
            <p className={styles.row}>
              <Mark state={r.state} className={styles.mark} />
              <span className={styles.need}>{r.subject}</span>
              <span className={styles.status} data-state={r.state}>
                {r.status}
              </span>
            </p>
            {r.state !== "ok" && r.fix && <p className={styles.fix}>{r.fix}</p>}
            {r.state !== "ok" && r.detail && <p className={styles.detail}>{r.detail}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
