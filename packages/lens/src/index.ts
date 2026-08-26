/**
 * The 600x600 panel, as a component.
 *
 * This lives in a package rather than inside `apps/display` for one reason:
 * the website shows a wearer's frame next to the JSON Schema it was compiled
 * from, and a reproduction would prove nothing. What the website renders has
 * to be the same component the glasses render, or the comparison is a drawing
 * of an argument rather than the argument.
 *
 * It knows nothing about relays, sessions or WebMCP. Give it a frame, get a
 * panel; it calls back when someone chooses something.
 */
export { FrameView } from "./FrameView.js";
export { DPAD, type Dpad, type DpadOptions, useDpad } from "./useDpad.js";
