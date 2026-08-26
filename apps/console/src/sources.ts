/**
 * The partner sites this deployment can be pointed at.
 *
 * This list is the ONLY thing Dusky is told about a source, and it is two
 * strings: a name to print and a URL to load. Nothing downstream reads it.
 * The menu, the parameters, the ceremony and the result summary are all
 * derived from the tool schemas that come back over WebMCP, which is why a
 * second entry here required no change to @dusky/frames, @dusky/policy or
 * @dusky/session.
 *
 * A registry is not a per-site branch. The moment anything in this repository
 * behaves differently BECAUSE a source is one of these rather than another,
 * that has become a hardcoded integration and rule 1 in AGENTS.md is broken.
 */

const MARKET_URL = import.meta.env["VITE_MARKET_URL"] ?? "http://localhost:7801";
const RESERVATIONS_URL = import.meta.env["VITE_RESERVATIONS_URL"] ?? "http://localhost:7804";

export interface Source {
  /** Stable key, used in the `?source=` query parameter. */
  id: string;
  /** What the wearer sees in the frame's eyebrow. */
  name: string;
  url: string;
  /** One line about what makes this source different, for the console UI. */
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

export const DEFAULT_SOURCE: Source = SOURCES[0] as Source;

/** Resolve `?source=` against the registry, falling back rather than failing. */
export function sourceFromQuery(search: string): Source {
  const id = new URLSearchParams(search).get("source");
  return SOURCES.find((s) => s.id === id) ?? DEFAULT_SOURCE;
}
