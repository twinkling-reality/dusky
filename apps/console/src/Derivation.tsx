import type { DisplayFrame, ToolDescriptor } from "@dusky/contracts";
import { factsFromResult, isOperable, label, outcomeFromResult, parameters } from "@dusky/frames";
import { FrameView } from "@dusky/lens";
import { gate } from "@dusky/policy";
import { Session, type ToolRunner } from "@dusky/session";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./Derivation.module.css";
import { PRESETS, type Preset } from "./presets.js";

/**
 * The schema, and the screens it compiled to, in one place.
 *
 * The panel here is the same `FrameView` the glasses run, driven by the same
 * `Session` state machine, over the same `@dusky/frames` compiler. The only
 * thing missing is the transport, because a tool runner that answers from a
 * text box needs no network. Which is what makes the box editable, and the
 * editable box is the whole argument: a hardcoded interface cannot answer an
 * edit.
 *
 * It reads left to right, and that ordering is the whole design.
 *
 * Declared, derived, displayed. The middle column used to sit at the BOTTOM of
 * the page, eight hundred pixels below the two things it connects, under
 * headings that were the names of the functions that produced them. So the two
 * boxes had nothing visible between them, and the panel on the right read as a
 * mock somebody had drawn next to some code. Standing between them, in words a
 * reader owns, it is the only thing on the page that explains what the other
 * two have to do with each other.
 *
 * The function names are still printed, under the plain-language label rather
 * than instead of it. They are what make the claim checkable: every value here
 * names the exported function that produced it, and none of those functions
 * knows what site it is looking at.
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

export function Derivation() {
  const [preset, setPreset] = useState<Preset>(PRESETS[0] as Preset);
  const [toolText, setToolText] = useState(preset.tool);
  const [resultText, setResultText] = useState(preset.result);
  const [frame, setFrame] = useState<DisplayFrame | null>(null);
  const [frameKey, setFrameKey] = useState("0");
  const session = useRef<Session | null>(null);
  const seq = useRef(0);

  const parsed = useMemo(() => parseTool(toolText, preset.origin), [toolText, preset.origin]);
  const tool = parsed.tool;

  const show = useCallback((f: DisplayFrame) => {
    seq.current += 1;
    setFrameKey(String(seq.current));
    setFrame(f);
  }, []);

  // A new schema is a new machine. This is the real Session from
  // @dusky/session, not a reimplementation of it, so anything true on the
  // glasses is true here: the gate, the ordering, the result reading.
  useEffect(() => {
    if (!tool) return;
    const s = new Session({
      source: new URL(preset.origin).host,
      runner: textRunner(tool, resultText),
      onTransition: (f) => show(f),
    });
    session.current = s;
    void s.start().then(show);
    return () => {
      session.current = null;
    };
  }, [tool, resultText, preset.origin, show]);

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
      {/* Four declarations worth looking at, and one line about the one in the
          boxes. Cards saying the same thing sat above this and duplicated it. */}
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
        <section className={styles.col}>
          <Head n="01" title="Declared" note="by the site, over WebMCP" tag="editable" />
          <label className={styles.field} htmlFor="tool">
            tool
          </label>
          <textarea
            id="tool"
            className={styles.code}
            value={toolText}
            spellCheck={false}
            rows={16}
            onChange={(e) => setToolText(e.target.value)}
            aria-label="Tool definition"
          />
          <p className={styles.foot}>
            No <code>origin</code>: the browser supplies that, not the site, which is why it is the
            one field on a tool that can be trusted. A site also has to name Dusky&rsquo;s origin in{" "}
            <code>exposedTo</code> before the browser hands over anything at all.
          </p>

          <label className={styles.field} htmlFor="result">
            result
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
        </section>

        <section className={styles.col}>
          <Head n="02" title="Derived" note="no model, no network, no site in the code" />
          {parsed.error ? (
            <p className={styles.err}>{parsed.error}</p>
          ) : (
            <dl className={styles.facts}>
              <Fact label="Called" fn="label(tool)" pkg="frames" value={tool ? label(tool) : ""} />
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
        </section>

        <section className={styles.col}>
          <Head n="03" title="Displayed" note="the real build, 600 x 600" tag="live" />
          <div className={styles.stage}>
            {frame && (
              <div className={styles.panel}>
                {/* keyboard={false}: the D-pad listener sits on `document`, and
                    a widget swallowing every arrow key would break the page
                    around it. Click the choices instead. */}
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
          <p className={styles.foot}>
            The component the glasses run, over the same compiler and the same state machine. Click
            a choice, or change the declaration and watch this answer.
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * A column heading: where it comes in the sequence, what it is, and what it is
 * made of. Three of these, and read across they are the whole page.
 */
function Head({ n, title, note, tag }: { n: string; title: string; note: string; tag?: string }) {
  return (
    <header className={styles.head}>
      <span className={styles.n}>{n}</span>
      <h2 className={styles.h2}>{title}</h2>
      {tag && <span className={styles.tag}>{tag}</span>}
      <span className={styles.note}>{note}</span>
    </header>
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
