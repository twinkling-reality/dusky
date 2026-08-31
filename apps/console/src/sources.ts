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
 * This list is the ONLY thing Dusky is told about a site: display metadata and
 * a URL to load. Nothing downstream reads it. The menu, the parameters, the
 * ceremony and the result summary are all derived from the tool schemas that
 * come back over WebMCP. Adding the third entry here required no site-specific
 * change to @dusky/frames, @dusky/policy or @dusky/session.
 *
 * A registry is not a per-site branch. The moment anything in this repository
 * behaves differently BECAUSE a site is one of these rather than another, that
 * has become a hardcoded integration and rule 1 in AGENTS.md is broken.
 */

const MARKET_URL = import.meta.env["VITE_MARKET_URL"] ?? "http://localhost:7801";
const RESERVATIONS_URL = import.meta.env["VITE_RESERVATIONS_URL"] ?? "http://localhost:7804";
const DISPATCH_URL = import.meta.env["VITE_DISPATCH_URL"] ?? "http://localhost:7805";

export interface Source {
  /** Stable key. Default-source keys may be used in the `?source=` query parameter. */
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
  {
    id: "dispatch",
    name: "Northstar Dispatch",
    url: DISPATCH_URL,
    blurb: "A communications desk. Four tools, contact lookups, drafts, and sent messages.",
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
  const params = new URLSearchParams(search);
  const runtime = runtimeSites(params.getAll("site"));
  if (runtime.length > 0) return runtime;

  const id = params.get("source");
  if (!id) return SOURCES;
  const only = SOURCES.find((s) => s.id === id);
  return only ? [only] : SOURCES;
}

/**
 * Turn user-supplied URLs into the same inert records as the demo fixtures.
 *
 * Each repeated `site` parameter is either a URL or a small JSON object with a
 * URL and optional display name. This is intentionally the whole extension
 * surface. Runtime sources never carry a tool list, policy, adapter, parser, or
 * result mapping. Those arrive from the site's WebMCP declaration.
 *
 * Public sites must use HTTPS. Plain HTTP is accepted only for loopback hosts,
 * which keeps local provider development possible without making a shared
 * console URL an active-content downgrade. Credentials and active URL schemes
 * are refused before an iframe is created.
 */
function runtimeSites(values: readonly string[]): readonly Source[] {
  const sites: Source[] = [];
  const origins = new Set<string>();

  for (const value of values) {
    const parsed = runtimeSite(value);
    if (!parsed) continue;
    const origin = originOf(parsed);
    if (origins.has(origin)) continue;
    origins.add(origin);
    sites.push(parsed);
  }

  return sites;
}

function runtimeSite(value: string): Source | null {
  let urlText = value.trim();
  let requestedName: unknown;

  if (urlText.startsWith("{")) {
    try {
      const record = JSON.parse(urlText) as unknown;
      if (!record || typeof record !== "object" || Array.isArray(record)) return null;
      const fields = record as Record<string, unknown>;
      if (typeof fields["url"] !== "string") return null;
      urlText = fields["url"].trim();
      requestedName = fields["name"];
    } catch {
      return null;
    }
  }

  if (urlText.length === 0 || urlText.length > 2_048) return null;

  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }

  if (url.username || url.password) return null;
  const loopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;

  const supplied = typeof requestedName === "string" ? safeName(requestedName) : "";
  const name = supplied || url.host;
  return {
    id: `runtime:${url.origin}`,
    name,
    url: url.toString(),
    blurb: "Runtime WebMCP source supplied in this console URL.",
  };
}

function safeName(value: string): string {
  const withoutControls = [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("");
  return withoutControls.replace(/\s+/g, " ").trim().slice(0, 48);
}
