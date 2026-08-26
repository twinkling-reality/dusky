import { type ReactNode, useId } from "react";
import styles from "./Callout.module.css";

/**
 * A labelled panel, in the manner of an annotation on a drawing.
 *
 * The pill sits ON the top edge rather than above it, which is what makes it
 * read as a label attached to a part rather than as a heading sitting over a
 * box. Everything else is deliberately quiet so the label and the content
 * carry it.
 *
 * `open` callouts are always shown. The rest are real <button> elements with
 * aria-expanded, because a page arguing that six keys are enough to operate
 * anything cannot have a front door that needs a mouse.
 */
interface Props {
  label: string;
  children: ReactNode;
  /** Fixed open: no toggle, no button, nothing to discover. */
  pinned?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  /** One line shown next to the label when collapsed. */
  teaser?: string;
}

export function Callout({ label, children, pinned, expanded, onToggle, teaser }: Props) {
  const id = useId();
  const open = pinned || expanded;

  return (
    <section className={styles.wrap} data-open={open}>
      <span className={styles.pill}>{label}</span>

      {pinned ? (
        <div className={styles.body}>{children}</div>
      ) : (
        <>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded === true}
            aria-controls={id}
            onClick={onToggle}
          >
            <span className={styles.teaser}>{teaser}</span>
            <span className={styles.chevron} aria-hidden="true" data-open={open} />
          </button>
          <div className={styles.body} id={id} hidden={!expanded}>
            {children}
          </div>
        </>
      )}
    </section>
  );
}
