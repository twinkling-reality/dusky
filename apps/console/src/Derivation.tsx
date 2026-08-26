import type { DisplayFrame, ToolDescriptor } from "@dusky/contracts";
import { factsFromResult, isOperable, label, outcomeFromResult, parameters } from "@dusky/frames";
import { FrameView } from "@dusky/lens";
import { gate } from "@dusky/policy";
import { Session, type ToolRunner } from "@dusky/session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./Derivation.module.css";
import { PRESETS, type Preset } from "./presets.js";

/**
 * The schema on the left, the screens it compiled to on the right.
 *
 * Two working demos still ask you to BELIEVE nothing is hardcoded. This asks
 * for nothing: the panel here is the same `FrameView` the glasses run, driven
 * by the same `Session` state machine, over the same `@dusky/frames`
 * compiler. The only thing missing is the transport, because a tool runner
 * that answers from a text box needs no network.
 *
 * Which means the box is editable, and that is the whole argument. Change a
 * type to an enum and the composer becomes buttons while you watch. Paste a
 * schema from a site nobody here has ever seen and it compiles anyway.
 * Hardcoded output cannot respond to an edit.
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

  const choose = useCallback((id: string) => {
    void session.current?.handle(id);
  }, []);
  const text = useCallback((v: string) => {
    void session.current?.submitText(v);
  }, []);
  const back = useCallback(() => {
    void session.current?.handle("__cancel");
  }, []);

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
    <section className={styles.wrap}>
      <header className={styles.head}>
        <h2 className={styles.h2}>What the site declared, and what Dusky made of it</h2>
        <p className={styles.lede}>
          The panel on the right is the component the glasses run, driven by the same state machine,
          over the same compiler. Nothing is drawn for this page. Change the schema and watch the
          screens change: that is the entire claim, and it costs you no trust.
        </p>
      </header>

      <div className={styles.presets}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.preset}
            data-on={p.id === preset.id}
            onClick={() => pick(p)}
          >
            <span className={styles.presetName}>{p.name}</span>
            <span className={styles.presetPoint}>{p.point}</span>
          </button>
        ))}
      </div>

      <div className={styles.cols}>
        <div className={styles.col}>
          <h3 className={styles.h3}>
            The tool, as the site registered it
            <span className={styles.tag}>editable</span>
          </h3>
          <textarea
            className={styles.code}
            value={toolText}
            spellCheck={false}
            rows={18}
            onChange={(e) => setToolText(e.target.value)}
            aria-label="Tool definition"
          />
          <p className={styles.foot}>
            <code>origin</code> is not in there on purpose. A site does not get to say where it came
            from; the browser supplies it, which is why it is the one field on a tool that can be
            trusted. Here it is <code>{preset.origin}</code>.
          </p>

          <h3 className={styles.h3}>
            What the site returns when it runs
            <span className={styles.tag}>editable</span>
          </h3>
          <textarea
            className={styles.code}
            value={resultText}
            spellCheck={false}
            rows={7}
            onChange={(e) => setResultText(e.target.value)}
            aria-label="Tool result"
          />
        </div>

        <div className={styles.col}>
          <h3 className={styles.h3}>Every step, and the function that took it</h3>
          {parsed.error ? (
            <p className={styles.err}>{parsed.error}</p>
          ) : (
            <dl className={styles.steps}>
              <Step fn="label(tool)" pkg="frames" value={tool ? label(tool) : ""} />
              <Step
                fn="isOperable(tool)"
                pkg="frames"
                value={String(tool ? isOperable(tool) : false)}
                note={
                  tool && !isOperable(tool)
                    ? "a required parameter cannot be collected on six keys, so this tool is left off the menu rather than offered as a dead control"
                    : undefined
                }
              />
              <Step fn="gate(tool).consequence" pkg="policy" value={g?.consequence ?? ""} />
              <Step
                fn="gate(tool).requiresConfirmation"
                pkg="policy"
                value={String(g?.requiresConfirmation ?? false)}
              />
              <Step fn="gate(tool).reason" pkg="policy" value={g?.reason ?? ""} />
              <Step fn="outcomeFromResult(raw).ok" pkg="frames" value={String(outcome.ok)} />
            </dl>
          )}

          <h3 className={styles.h3}>parameters(tool)</h3>
          <ul className={styles.params}>
            {params.map((p) => (
              <li key={p.name} className={styles.param}>
                <code>{p.name}</code>
                <span className={styles.kind} data-kind={p.kind}>
                  {p.kind}
                </span>
                <span className={styles.req}>{p.required ? "required" : "optional"}</span>
                <span className={styles.becomes}>{becomes(p.kind, p.required)}</span>
              </li>
            ))}
            {params.length === 0 && <li className={styles.none}>no parameters declared</li>}
          </ul>

          <h3 className={styles.h3}>factsFromResult(raw)</h3>
          <ul className={styles.params}>
            {facts.map((f) => (
              <li key={f.label} className={styles.fact}>
                <code>{f.label}</code>
                <span className={styles.becomes}>{f.value}</span>
              </li>
            ))}
            {facts.length === 0 && (
              <li className={styles.none}>
                nothing readable, so the wearer is shown the raw text rather than invented structure
              </li>
            )}
          </ul>
        </div>

        <div className={styles.col}>
          <h3 className={styles.h3}>
            On the glasses
            <span className={styles.tag}>600 x 600, shown at 80%</span>
          </h3>
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
                  onChoose={choose}
                  onBack={back}
                  onText={text}
                />
              </div>
            )}
          </div>
          <p className={styles.foot}>
            Click through it. Anything the policy layer gated stops for a confirmation here exactly
            as it would on someone's face, because it is the same code deciding.
          </p>
        </div>
      </div>
    </section>
  );
}

function Step({ fn, pkg, value, note }: { fn: string; pkg: string; value: string; note?: string }) {
  return (
    <div className={styles.step}>
      <dt className={styles.stepFn}>
        <code>{fn}</code>
        <span className={styles.pkg}>@dusky/{pkg}</span>
      </dt>
      <dd className={styles.stepVal}>
        {value}
        {note && <span className={styles.stepNote}>{note}</span>}
      </dd>
    </div>
  );
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
