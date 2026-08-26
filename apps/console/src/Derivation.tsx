import type { DisplayFrame, ToolDescriptor } from "@dusky/contracts";
import { factsFromResult, isOperable, label, outcomeFromResult, parameters } from "@dusky/frames";
import { FrameView } from "@dusky/lens";
import { gate } from "@dusky/policy";
import { Session, type ToolRunner } from "@dusky/session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * This was briefly split into a hook and two views, because the panel sat in
 * a cell on the front page while the boxes lived in a drawer underneath it.
 * A live panel on its own only proves that something moves. Standing next to
 * the JSON Schema it was derived from, with the schema editable, it proves
 * the thing this page exists to prove, so the two halves are back together
 * and the split that kept them in sync is gone with them.
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
      {/* A segmented control and one line about the current choice, rather
          than four bordered cards each carrying its own paragraph. Only one of
          those paragraphs is ever the relevant one, and the other three were
          noise sitting above the thing they were describing. */}
      <div className={styles.presets}>
        <fieldset className={styles.segments}>
          <legend className={styles.srOnly}>Example schemas</legend>
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

      {/* Schema in, screens out, side by side. The whole point is that these
          two are the same machine seen from either end. */}
      <div className={styles.derive}>
        <div className={styles.col}>
          <h3 className={styles.h3}>
            What the site declared
            <span className={styles.tag}>editable</span>
          </h3>
          <textarea
            className={styles.code}
            value={toolText}
            spellCheck={false}
            rows={14}
            onChange={(e) => setToolText(e.target.value)}
            aria-label="Tool definition"
          />
          <p className={styles.foot}>
            No <code>origin</code>: the browser supplies that, not the site. Here,{" "}
            <code>{preset.origin}</code>.
          </p>

          <h3 className={styles.h3}>
            What it returns
            <span className={styles.tag}>editable</span>
          </h3>
          <textarea
            className={styles.code}
            value={resultText}
            spellCheck={false}
            rows={6}
            onChange={(e) => setResultText(e.target.value)}
            aria-label="Tool result"
          />
        </div>

        <div className={styles.col}>
          <h3 className={styles.h3}>
            What the wearer sees
            <span className={styles.tag}>live, 600 x 600</span>
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
                  headingLevel={2}
                  onChoose={(id) => void session.current?.handle(id)}
                  onBack={() => void session.current?.handle("__cancel")}
                  onText={(v) => void session.current?.submitText(v)}
                />
              </div>
            )}
          </div>
          <p className={styles.foot}>
            The same component the glasses run. Click a choice, or edit the schema and watch it
            answer.
          </p>
        </div>
      </div>

      <div className={styles.readout}>
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
                    ? "a required parameter cannot be collected on six keys, so it is left off the menu"
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
        </div>

        <div className={styles.col}>
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
              <li className={styles.none}>nothing readable, so the wearer is shown the raw text</li>
            )}
          </ul>
        </div>
      </div>
    </div>
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
