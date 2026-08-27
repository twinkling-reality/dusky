import type { DisplayFrame, ToolDescriptor } from "@dusky/contracts";
import { factsFromResult, isOperable, label, outcomeFromResult, parameters } from "@dusky/frames";
import { FrameView } from "@dusky/lens";
import { gate } from "@dusky/policy";
import { Session, type ToolRunner } from "@dusky/session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./Derivation.module.css";
import { CONTRAST, PRESETS, type Preset, type Side } from "./presets.js";

/**
 * The figures for the read on /method.
 *
 * Each one is the same `FrameView` the glasses run, driven by the same
 * `Session` state machine, over the same `@dusky/frames` compiler and the same
 * `@dusky/policy` gate. The only thing missing is the transport, because a tool
 * runner that answers from a text box needs no network. That substitution is
 * what makes the last one editable, and an editable declaration is the whole
 * argument: a hardcoded interface cannot answer an edit.
 *
 * They are figures rather than a layout. Four rebuilds of this page put the
 * demonstrations in a grid, a matrix, three columns, two columns, and every
 * time the labels needed to explain the grid became the thing nobody could
 * read. A figure needs no labels because the sentence above it introduced it.
 * The page that arranges them is Method.tsx; this file only makes them.
 *
 * `useCompiled` is a hook because the page holds several of these at once. This
 * file was once split into a hook and two views for a different reason, to let
 * a panel sit on the front page while the boxes lived in a drawer under it, and
 * that split was a mistake because it let the two halves of one argument drift
 * apart. Several instances of one machine on one page is not that.
 */

/** A runner that answers from a text box. No network, no browser API, no site. */
function textRunner(tool: ToolDescriptor, result: string): ToolRunner {
  return {
    discover: async () => [tool],
    invoke: async () => result,
  };
}

interface Parsed {
  tool: ToolDescriptor | null;
  error: string | null;
}

/**
 * Read the editable text as a tool.
 *
 * `origin` is NOT part of the editable text, and that is deliberate: a site
 * does not get to say where it came from. The browser supplies it, which is
 * why it is the one field on a tool that can be trusted.
 */
function parseTool(text: string, origin: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { tool: null, error: err instanceof Error ? err.message : "not JSON" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { tool: null, error: "a tool has to be a JSON object" };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o["name"] !== "string" || o["name"].trim() === "") {
    return { tool: null, error: "a tool needs a name" };
  }
  const ann = (o["annotations"] ?? {}) as Record<string, unknown>;
  const schema = o["inputSchema"];
  const title = typeof o["title"] === "string" && o["title"].trim() ? o["title"].trim() : undefined;
  return {
    error: null,
    tool: {
      name: o["name"],
      ...(title !== undefined ? { title } : {}),
      description: typeof o["description"] === "string" ? o["description"] : "",
      origin,
      inputSchema:
        typeof schema === "object" && schema !== null && !Array.isArray(schema)
          ? (schema as Record<string, unknown>)
          : null,
      annotations: {
        readOnlyHint: ann["readOnlyHint"] === true,
        untrustedContentHint: ann["untrustedContentHint"] === true,
      },
    },
  };
}

/** One declaration, compiled, with the frames it produced. */
function useCompiled(
  toolText: string,
  resultText: string,
  origin: string,
  site: string,
  enter: boolean,
) {
  const [frame, setFrame] = useState<DisplayFrame | null>(null);
  const [frameKey, setFrameKey] = useState("0");
  const session = useRef<Session | null>(null);
  const seq = useRef(0);

  const parsed = useMemo(() => parseTool(toolText, origin), [toolText, origin]);
  const tool = parsed.tool;

  const show = useCallback((f: DisplayFrame) => {
    seq.current += 1;
    setFrameKey(String(seq.current));
    setFrame(f);
  }, []);

  // A new declaration is a new machine. This is the real Session from
  // @dusky/session, not a reimplementation of it, so anything true on the
  // glasses is true here: the gate, the ordering, the result reading.
  useEffect(() => {
    if (!tool) return;
    const s = new Session({
      source: site,
      runner: textRunner(tool, resultText),
      onTransition: (f) => show(f),
    });
    session.current = s;
    void s.start().then((first) => {
      show(first);
      /*
       * Straight into the tool, for the comparison panels only.
       *
       * The menu is real and it is derived, but a menu holding ONE action is
       * the weakest frame this product has: it reads as a stub, and it is the
       * frame that made the whole panel look hardcoded. The screen worth
       * showing beside a declaration is the screen that declaration produced.
       * The sandbox keeps its menu, because there the tool's own label is
       * part of what is being demonstrated.
       */
      if (!enter || first.kind !== "idle") return;
      const only = first.choices[0];
      if (first.choices.length === 1 && only) void s.handle(only.id);
    });
    return () => {
      session.current = null;
    };
  }, [tool, resultText, site, show, enter]);

  return { frame, frameKey, session, parsed, tool };
}

/** The glasses, at the one size that is not ours to choose. */
function Lens({
  frame,
  frameKey,
  session,
  testId,
}: {
  frame: DisplayFrame | null;
  frameKey: string;
  session: { current: Session | null };
  testId?: string;
}) {
  return (
    <div className={styles.stage} data-testid={testId}>
      {frame && (
        <div className={styles.panel}>
          {/* keyboard={false}: the D-pad listener sits on `document`, and a
              widget swallowing every arrow key would break the page around it,
              let alone three of them fighting over the same keys. Click the
              choices instead. */}
          <FrameView
            frame={frame}
            frameKey={frameKey}
            keyboard={false}
            headingLevel={2}
            onChoose={(id) => void session.current?.handle(id)}
            onBack={() => void session.current?.handle("__cancel")}
            onText={(v) => void session.current?.submitText(v)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A figure showing what a site published.
 *
 * Read-only, and only the part the sentence above it is talking about. Printing
 * the whole declaration here would bury the four lines that are the point.
 */
export function Published({ code }: { code: string }) {
  return <pre className={styles.published}>{code}</pre>;
}

/** A figure showing what that declaration became on the glasses. */
export function Screen({ side }: { side: Side }) {
  const c = useCompiled(side.tool, CONTRAST.result, CONTRAST.origin, CONTRAST.site, true);
  return <Lens frame={c.frame} frameKey={c.frameKey} session={c.session} />;
}

/**
 * The last figure: a declaration you can change, and the screen answering.
 *
 * It answers the objection the other figures cannot, which is that we wrote
 * both sides of every comparison on this page.
 *
 * It was the only thing here that never became a figure. It kept the chrome of
 * the tool it started as: two textareas with browser scrollbars, resize grips,
 * JSON clipped at the edge, and a six row data table underneath. Three of those
 * were answering questions nobody on this page had asked.
 *
 * The result box is gone. Nobody needs to edit what a site sends back, and it
 * was carrying half the weight of the figure while being the least interesting
 * thing on it. The table is gone too, replaced by the one sentence it was
 * spelling out, generated by the same `gate` the wearer's screen consults.
 */
export function Sandbox() {
  const [preset, setPreset] = useState<Preset>(PRESETS[0] as Preset);
  const [toolText, setToolText] = useState(preset.tool);

  const { frame, frameKey, session, parsed, tool } = useCompiled(
    toolText,
    preset.result,
    preset.origin,
    preset.site,
    false,
  );

  const pick = (p: Preset) => {
    setPreset(p);
    setToolText(p.tool);
  };

  const g = tool ? gate(tool) : null;

  return (
    <div className={styles.sandbox}>
      <fieldset className={styles.segments}>
        <legend className={styles.srOnly}>Example declarations</legend>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.preset}
            data-on={p.id === preset.id}
            aria-pressed={p.id === preset.id}
            onClick={() => pick(p)}
          >
            {p.name}
          </button>
        ))}
      </fieldset>

      <div className={styles.pipe}>
        <textarea
          className={styles.code}
          value={toolText}
          spellCheck={false}
          rows={18}
          onChange={(e) => setToolText(e.target.value)}
          aria-label="Tool definition"
        />

        <div className={styles.col}>
          <Lens frame={frame} frameKey={frameKey} session={session} testId="sandbox-panel" />
          {parsed.error ? (
            <p className={styles.err}>{parsed.error}</p>
          ) : (
            g && (
              <p className={styles.verdict}>
                Dusky read this as <strong>{g.consequence}</strong>, so it{" "}
                {g.requiresConfirmation ? "stops for a human" : "runs without asking"}: {g.reason}.
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** Booleans read as answers here, not as literals. */
function yesNo(v: boolean): string {
  return v ? "yes" : "no";
}

/** What a parameter of this kind turns into, in one phrase. */
function becomes(kind: string, required: boolean): string {
  if (!required) return "never asked for";
  switch (kind) {
    case "enum":
      return "one button per declared value";
    case "boolean":
      return "Yes and No";
    case "text":
      return "the on-glasses composer";
    case "number":
      return "the composer, committed as a number";
    default:
      return "cannot be collected on six keys";
  }
}
