import type { DisplayFrame, ToolDescriptor } from "@dusky/contracts";
import { factsFromResult, isOperable, label, outcomeFromResult, parameters } from "@dusky/frames";
import { FrameView } from "@dusky/lens";
import { gate } from "@dusky/policy";
import { Session, type ToolRunner } from "@dusky/session";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./Derivation.module.css";
import { CONTRAST, PRESETS, type Preset, type Side } from "./presets.js";

/**
 * The proof: a demonstration, and then a sandbox.
 *
 * The panel is the same `FrameView` the glasses run, driven by the same
 * `Session` state machine, over the same `@dusky/frames` compiler and the same
 * `@dusky/policy` gate. The only thing missing is the transport, because a tool
 * runner that answers from a text box needs no network. That substitution is
 * what makes the box editable, and the editable box is the argument: a
 * hardcoded interface cannot answer an edit.
 *
 * The demonstration exists because the argument was INERT. The page asked a
 * visitor to hand-edit JSON before anything moved, so a reader who did not type
 * saw three static boxes and concluded, reasonably, that the black square was a
 * mockup somebody had drawn next to some code. Two panels compiled from two
 * declarations that differ by one property need nothing from anybody: the claim
 * is read rather than performed.
 *
 * The sandbox below is what answers the obvious objection, that we authored
 * both sides of the comparison.
 *
 * `useCompiled` is a hook because three panels on this page need the same
 * machine. This file was once split into a hook and two views for a different
 * reason, to let the panel sit on the front page while the boxes lived in a
 * drawer under it, and that split was a mistake because it let the two halves
 * of one argument drift apart. Three instances of one machine on one page is
 * not that.
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

/** One half of the comparison: the property, the screen, and the reason. */
function Half({ side, label }: { side: Side; label: string }) {
  const c = useCompiled(side.tool, CONTRAST.result, CONTRAST.origin, CONTRAST.site, true);
  return (
    <div className={styles.half}>
      <span className={styles.halfLabel}>{label}</span>
      <pre className={styles.snippet}>{side.code}</pre>
      <Lens frame={c.frame} frameKey={c.frameKey} session={c.session} />
      <p className={styles.says}>{side.says}</p>
    </div>
  );
}

export function Derivation() {
  const [preset, setPreset] = useState<Preset>(PRESETS[0] as Preset);
  const [toolText, setToolText] = useState(preset.tool);
  const [resultText, setResultText] = useState(preset.result);

  const { frame, frameKey, session, parsed, tool } = useCompiled(
    toolText,
    resultText,
    preset.origin,
    preset.site,
    false,
  );

  const pick = (p: Preset) => {
    setPreset(p);
    setToolText(p.tool);
    setResultText(p.result);
  };

  const g = tool ? gate(tool) : null;
  const params = tool ? parameters(tool) : [];
  const outcome = outcomeFromResult(resultText);
  const facts = factsFromResult(resultText);

  return (
    <div className={styles.wrap}>
      {/*
        The demonstration. No headline over it: the caption says what you are
        looking at, and a headline above a caption is one of them too many.
      */}
      <section className={styles.contrast}>
        <p className={styles.caption}>
          One tool, declared twice. Everything else is identical, down to the code that draws these
          two screens.
        </p>
        <div className={styles.halves}>
          <Half side={CONTRAST.before} label="As Verdant Market declared it" />
          <Half side={CONTRAST.after} label={`With one property added to ${CONTRAST.field}`} />
        </div>
      </section>

      <section className={styles.sandbox}>
        <header className={styles.sandboxHead}>
          <h2 className={styles.h2}>Try it on something else</h2>
          <p className={styles.sub}>
            Four declarations from four unrelated domains, and a box you can type your own into.
            Nothing below is a special case; it is the same compiler answering whatever it is given.
          </p>
        </header>

        <div className={styles.presets}>
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
          <p className={styles.presetPoint}>{preset.point}</p>
        </div>

        <div className={styles.pipe}>
          <div className={styles.col}>
            <label className={styles.field} htmlFor="tool">
              what {preset.site} declared
            </label>
            <textarea
              id="tool"
              className={styles.code}
              value={toolText}
              spellCheck={false}
              rows={15}
              onChange={(e) => setToolText(e.target.value)}
              aria-label="Tool definition"
            />
            <p className={styles.foot}>
              No <code>origin</code>: the browser supplies that, not the site, which is why it is
              the one field on a tool that can be trusted. A site also has to name Dusky&rsquo;s
              origin in <code>exposedTo</code> before the browser hands over anything at all.
            </p>

            <label className={styles.field} htmlFor="result">
              what it answers with
            </label>
            <textarea
              id="result"
              className={styles.code}
              value={resultText}
              spellCheck={false}
              rows={6}
              onChange={(e) => setResultText(e.target.value)}
              aria-label="Tool result"
            />

            <h3 className={styles.h3}>What Dusky worked out</h3>
            {parsed.error ? (
              <p className={styles.err}>{parsed.error}</p>
            ) : (
              <dl className={styles.facts}>
                <Fact
                  label="Called"
                  fn="label(tool)"
                  pkg="frames"
                  value={tool ? label(tool) : ""}
                />
                <Fact
                  label="Can be driven on six keys"
                  fn="isOperable(tool)"
                  pkg="frames"
                  value={yesNo(tool ? isOperable(tool) : false)}
                  note={
                    tool && !isOperable(tool)
                      ? "a required parameter cannot be collected on six keys, so it is left off the menu"
                      : undefined
                  }
                />
                <Fact
                  label="Consequence"
                  fn="gate(tool).consequence"
                  pkg="policy"
                  value={g?.consequence ?? ""}
                />
                <Fact
                  label="Stops for a human"
                  fn="gate(tool).requiresConfirmation"
                  pkg="policy"
                  value={yesNo(g?.requiresConfirmation ?? false)}
                  note={g?.reason}
                />
                <Fact label="It will ask for" fn="parameters(tool)" pkg="frames">
                  {params.length === 0 ? (
                    <span className={styles.none}>nothing</span>
                  ) : (
                    <ul className={styles.rows}>
                      {params.map((p) => (
                        <li key={p.name} className={styles.row}>
                          <code>{p.name}</code>
                          <span className={styles.kind} data-kind={p.kind}>
                            {p.kind}
                          </span>
                          <span className={styles.becomes}>{becomes(p.kind, p.required)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Fact>
                <Fact label="It will report" fn="factsFromResult(raw)" pkg="frames">
                  {facts.length === 0 ? (
                    <span className={styles.none}>
                      nothing readable, so the wearer is shown the raw text
                    </span>
                  ) : (
                    <ul className={styles.rows}>
                      {facts.map((f) => (
                        <li key={f.label} className={styles.row}>
                          <code>{f.label}</code>
                          <span className={styles.becomes}>{f.value}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Fact>
                <Fact
                  label="Counted a success"
                  fn="outcomeFromResult(raw).ok"
                  pkg="frames"
                  value={yesNo(outcome.ok)}
                />
              </dl>
            )}
          </div>

          <div className={styles.col}>
            <span className={styles.field}>what the wearer sees</span>
            <Lens frame={frame} frameKey={frameKey} session={session} testId="sandbox-panel" />
            <p className={styles.foot}>
              The component the glasses run, over the same compiler and the same state machine.
              Click a choice, or change the declaration and watch this answer.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * One thing Dusky worked out, and the function that worked it out.
 *
 * The label a reader can use comes first and the function name sits under it in
 * mono. It used to be the other way round, which meant the page introduced
 * every one of its own answers with a symbol only somebody holding the source
 * could read.
 */
function Fact({
  label: name,
  fn,
  pkg,
  value,
  note,
  children,
}: {
  label: string;
  fn: string;
  pkg: string;
  value?: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factKey}>
        <span className={styles.factLabel}>{name}</span>
        <code className={styles.factFn}>
          {fn} <span className={styles.pkg}>@dusky/{pkg}</span>
        </code>
      </dt>
      <dd className={styles.factVal}>
        {children ?? value}
        {note && <span className={styles.factNote}>{note}</span>}
      </dd>
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
