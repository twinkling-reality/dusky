import type { Choice, DisplayFrame } from "@dusky/contracts";
import { type Ref, useRef, useState } from "react";
import styles from "./FrameView.module.css";
import { useDpad } from "./useDpad.js";

/**
 * Renders one DisplayFrame at 600x600 on an additive waveguide.
 *
 * Two rules drive every style decision here:
 *
 *   1. Black emits no light, so the ground is genuinely transparent against
 *      the room. This is not a dark theme and must never be inverted.
 *   2. There is no scrolling and no cursor. Everything must fit, and every
 *      interactive element must be reachable by focus alone.
 */

interface Props {
  frame: DisplayFrame;
  frameKey: string;
  onChoose: (choiceId: string) => void;
  onBack: () => void;
  onText?: (value: string) => void;
  /**
   * The heading level for the frame's title.
   *
   * `1` is right on the glasses and in the Display tab, where the panel is
   * the whole document. Embedded in an ordinary page it is not: a second
   * `h1` competes with the page's own, and anyone navigating by headings
   * lands in the middle of a widget.
   */
  headingLevel?: 1 | 2;
  /**
   * Whether this panel owns the arrow keys.
   *
   * True on the glasses and in the Display tab, where the panel IS the page.
   * False when a panel is embedded in an ordinary document, because the D-pad
   * listener sits on `document` and a preview widget silently swallowing
   * every arrow key would break the page around it.
   */
  keyboard?: boolean;
}

function choicesOf(frame: DisplayFrame): Choice[] {
  return "choices" in frame ? frame.choices : [];
}

export function FrameView({
  frame,
  frameKey,
  onChoose,
  onBack,
  onText,
  keyboard = true,
  headingLevel = 1,
}: Props) {
  const choices = choicesOf(frame);
  const Title = headingLevel === 1 ? "h1" : "h2";

  const { index, register } = useDpad({
    count: choices.length,
    frameKey,
    enabled: keyboard,
    onSelect: (i) => {
      const c = choices[i];
      if (c) onChoose(c.id);
    },
    onBack,
  });

  return (
    <div className={styles.screen} data-kind={frame.kind}>
      <header className={styles.top}>
        <span>{frame.source}</span>
        <span>{statusWord(frame)}</span>
      </header>

      <div className={styles.body}>
        {frame.kind === "working" ? (
          <Title className={styles.title}>
            <span className={styles.pulse} aria-hidden="true" />
            {frame.title}
          </Title>
        ) : frame.kind === "result" ? (
          <Title className={styles.title}>
            <span className={frame.ok ? styles.ok : styles.bad} aria-hidden="true">
              {frame.ok ? "✓" : "✗"}
            </span>{" "}
            {frame.title}
          </Title>
        ) : (
          <Title className={styles.title}>{frame.title}</Title>
        )}

        {frame.kind === "confirm" && (
          <>
            {/* A tool with no arguments has nothing to name here, and the
                title above already carries its label. */}
            {frame.target && <p className={styles.target}>{frame.target}</p>}
            {frame.consequence && <p className={styles.consequence}>{frame.consequence}</p>}
          </>
        )}

        {frame.kind === "result" && frame.facts && frame.facts.length > 0 && (
          <dl className={styles.facts}>
            {frame.facts.map((f) => (
              <div key={f.label} className={styles.fact}>
                <dt className={styles.factLabel}>{f.label}</dt>
                <dd className={styles.factValue}>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Only when nothing could be structured, so the wearer still sees
            what the site said rather than an empty frame. */}
        {frame.kind === "result" && !frame.facts?.length && frame.detail && (
          <p className={styles.detail}>{frame.detail}</p>
        )}

        {frame.kind === "error" && frame.detail && <p className={styles.detail}>{frame.detail}</p>}
      </div>

      {choices.length > 0 && (
        <ul className={styles.list}>
          {choices.map((c, i) => (
            <li key={c.id}>
              {c.id === "__compose" && onText ? (
                /*
                 * Keyed on the frame, not on the choice id.
                 *
                 * The choice id is "__compose" on every frame that offers a
                 * composer, so two free-text parameters in a row reconciled
                 * to the SAME Composer instance: `sent` was still true from
                 * the first answer and the first answer's text was still in
                 * the field, so the second question could not be answered at
                 * all. Escape, which throws away every answer so far, was the
                 * only way out. A planner masks this because the busy frame
                 * in between unmounts the list, and the planner is off by
                 * default, so the shipping configuration was the broken one.
                 */
                <Composer
                  key={frameKey}
                  ref={register(i)}
                  placeholder={c.label}
                  focused={index === i}
                  onCommit={onText}
                />
              ) : (
                <button
                  ref={register(i)}
                  type="button"
                  className={styles.choice}
                  data-tone={c.tone ?? "default"}
                  data-focused={index === i}
                  onClick={() => onChoose(c.id)}
                >
                  <span className={styles.label}>{c.label}</span>
                  {c.meta && <span className={styles.meta}>{c.meta}</span>}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {"note" in frame && frame.note && <p className={styles.note}>{frame.note}</p>}
    </div>
  );
}

/**
 * Free-text entry on the glasses.
 *
 * On Meta Ray-Ban Display the wearer focuses the field and taps, which opens
 * the on-device composer (handwriting or dictation); the composer commits the
 * whole string at once. In a desktop browser the same field is typed into
 * character by character. Both must produce exactly ONE submission, so the
 * value is held locally and committed on Enter or on `change`, never on every
 * keystroke.
 */
function Composer({
  ref,
  placeholder,
  focused,
  onCommit,
}: {
  ref: Ref<HTMLInputElement>;
  placeholder: string;
  focused: boolean;
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  // Enter commits and the frame changes, which unmounts a focused input and
  // can fire blur on the way out. Exactly one submission must escape.
  const sent = useRef(false);

  const commit = (raw: string) => {
    if (sent.current) return;
    const v = raw.trim();
    if (!v) return;
    sent.current = true;
    onCommit(v);
  };

  return (
    <input
      ref={ref}
      className={styles.compose}
      type="text"
      placeholder={placeholder}
      value={value}
      data-focused={focused}
      onChange={(e) => setValue(e.currentTarget.value)}
      // Fires when the on-glasses composer commits, and on blur in a browser.
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        // The D-pad listener sits on `document`; React delegates at the root,
        // so stopping propagation here prevents Enter from also being read as
        // a menu selection.
        e.stopPropagation();
        e.preventDefault();
        commit(e.currentTarget.value);
      }}
    />
  );
}

function statusWord(frame: DisplayFrame): string {
  switch (frame.kind) {
    case "idle":
      return "ready";
    case "working":
      return "working";
    case "choose":
      return "choose";
    case "confirm":
      return "confirm";
    case "result":
      return frame.ok ? "done" : "failed";
    case "error":
      return "error";
  }
}
