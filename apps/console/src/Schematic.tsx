import styles from "./Schematic.module.css";

/**
 * Meta Ray-Ban Display, drawn rather than rendered.
 *
 * A front elevation in the register of a parts drawing: hairlines, a centre
 * line, a datum, and no shading. That is a deliberate refusal. A photoreal
 * render of somebody else's hardware would be a picture of a thing we do not
 * make, and on a page whose entire argument is "nothing here is drawn for
 * this page", the one illustration had better be legible as an illustration.
 *
 * The right lens is the display side and is called out. What is actually on
 * it is not in here: it is a live panel, sitting in the callout this drawing
 * points at.
 */
/** One rim. The other is this path mirrored about the drawing's centre line. */
const RIM =
  "M60 58 H182 a8 8 0 0 1 8 8 V98 a22 22 0 0 1 -22 22 H74 " +
  "a22 22 0 0 1 -22 -22 V66 a8 8 0 0 1 8 -8 Z";

export function Schematic() {
  return (
    <svg
      className={styles.svg}
      viewBox="0 0 460 176"
      fill="none"
      role="img"
      aria-label="Meta Ray-Ban Display, front elevation. The right lens carries the display."
    >
      <title>Meta Ray-Ban Display, front elevation</title>

      {/* Datum and centre line: the marks a drawing uses to say where things
          are measured from. They are structure, not decoration. */}
      <g className={styles.construction}>
        <line x1="14" y1="89" x2="446" y2="89" strokeDasharray="2 6" />
        <line x1="230" y1="30" x2="230" y2="150" strokeDasharray="2 6" />
      </g>

      <g className={styles.frame}>
        {/* Hinges. A temple runs away from the viewer, so a front elevation
            sees a stub rather than an arm. Drawing the whole arm here would
            be drawing a view this is not. */}
        <path d="M52 68 L34 63" />
        <path d="M408 68 L426 63" />

        {/* Bridge, sitting below the brow line the way a keyhole bridge does. */}
        <path d="M190 62 Q210 78 230 78 Q250 78 270 62" />

        {/* Left rim. */}
        <path d={RIM} />
      </g>

      {/* The display side, drawn heavier because it is the subject. The path
          is the same one, mirrored about the centre line. */}
      <g className={styles.lens}>
        <path d={RIM} transform="translate(460, 0) scale(-1, 1)" />
      </g>

      {/* The leader. Diagonal, then horizontal, the way a drawing calls out a
          part. It lives in here rather than beside the drawing so that it
          starts exactly on the thing it points at rather than near it. */}
      <g className={styles.leader}>
        <path d="M340 108 L398 66 L458 66" />
      </g>
      <circle className={styles.node} cx="340" cy="108" r="3.5" />
    </svg>
  );
}
