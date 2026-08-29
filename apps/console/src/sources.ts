/**
 * The partner sites this deployment holds.
 *
 * ALL of them, at once. Dusky used to be pointed at one site at a time, which
 * made it a remote control for whichever business you had selected; it is a
 * remote control for everything you are signed into. Nothing about that is a
 * new capability in the protocol: `getTools({ fromOrigins })` has always taken
 * a list and the bridge has always filtered answers to it. One line in the
 * console wrapped a single source in an array and that was the whole
 * restriction.
 *
 * This list is the ONLY thing Dusky is told about a site, and it is two
 * strings: a name to print and a URL to load. Nothing downstream reads it. The
 * menu, the parameters, the ceremony and the result summary are all derived
 * from the tool schemas that come back over WebMCP, which is why a second entry
 * here required no change to @dusky/frames, @dusky/policy or @dusky/session,
 * and why a third would not either.
 *
 * A registry is not a per-site branch. The moment anything in this repository
 * behaves differently BECAUSE a site is one of these rather than another, that
 * has become a hardcoded integration and rule 1 in AGENTS.md is broken.
 */

const MARKET_URL = import.meta.env["VITE_MARKET_URL"] ?? "http://localhost:7801";
const RESERVATIONS_URL = import.meta.env["VITE_RESERVATIONS_URL"] ?? "http://localhost:7804";

export interface Source {
  /** Stable key, used in the `?source=` query parameter. */
  id: string;
  /** What the wearer reads in the eyebrow of a frame about this site. */
  name: string;
  url: string;
  /** One line about what makes this site different, for the console UI. */
  blurb: string;
}

export const SOURCES: readonly Source[] = [
  {
    id: "market",
    name: "Verdant Market",
    url: MARKET_URL,
    blurb: "A shop. Four tools, every parameter a bare string, results about carts.",
  },
  {
    id: "reservations",
    name: "Amber & Oak",
    url: RESERVATIONS_URL,
    blurb: "A restaurant. Three tools, enums and a boolean, results about bookings.",
  },
];

/** The origin a site's tools will arrive from. What actually decides anything. */
export function originOf(source: Source): string {
  return new URL(source.url).origin;
}

/**
 * Which sites this window is holding.
 *
 * Every one of them, unless `?source=` narrows it to a single site.
 *
 * The narrowing is deliberately not offered as a control. It is not a mode a
 * visitor should have to understand, and a button that hides two thirds of what
 * Dusky can do argues against the thing the page is for. It survives because
 * two other callers genuinely need it: an end-to-end test that wants to make
 * assertions about one site's tools without another's arriving in the middle of
 * them, and anybody demonstrating a single site on a connection that will not
 * carry several iframes.
 *
 * An unknown id falls back to holding everything rather than to holding
 * nothing, because an empty menu is the one outcome a visitor cannot recover
 * from and a typo in a URL should not produce it.
 */
export function sitesFromQuery(search: string): readonly Source[] {
  const id = new URLSearchParams(search).get("source");
  if (!id) return SOURCES;
  const only = SOURCES.find((s) => s.id === id);
  return only ? [only] : SOURCES;
}
