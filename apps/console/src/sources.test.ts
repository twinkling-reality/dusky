import { describe, expect, it } from "vitest";
import { originOf, SOURCES, sitesFromQuery } from "./sources.js";

/**
 * The one line that used to decide how much of the web Dusky could reach.
 *
 * It had no test at all. Every guarantee about which sites a window holds lived
 * in Playwright specs that take a minute to run, which is a slow way to find
 * out that a query parameter stopped meaning what it meant.
 */
describe("which sites a window holds", () => {
  it("holds every site when nothing narrows it", () => {
    expect(sitesFromQuery("")).toEqual(SOURCES);
    expect(sitesFromQuery("session=ABCDEF&mode=glasses")).toEqual(SOURCES);
  });

  it("narrows to one site when asked by id", () => {
    const held = sitesFromQuery("source=reservations");
    expect(held.map((s) => s.id)).toEqual(["reservations"]);
  });

  /**
   * Falling back to everything rather than to nothing.
   *
   * An empty menu is the one outcome a visitor cannot recover from, and the
   * failure looks identical to a site that granted nothing. A typo in a shared
   * link must not produce it.
   */
  it("holds everything when the id is not one of ours", () => {
    expect(sitesFromQuery("source=nowhere")).toEqual(SOURCES);
    expect(sitesFromQuery("source=")).toEqual(SOURCES);
  });

  it("names an origin per site, and they are all distinct", () => {
    const origins = SOURCES.map(originOf);
    expect(new Set(origins).size, "two sites sharing an origin cannot be told apart").toBe(
      origins.length,
    );
    for (const o of origins) expect(new URL(o).origin).toBe(o);
  });

  /**
   * The registry is a list of names and URLs and nothing else.
   *
   * Anything downstream reading a site by id would be the per-site branch rule
   * 1 forbids, so this asserts the shape stays inert.
   */
  it("tells Dusky nothing about a site beyond what to print and what to load", () => {
    for (const s of SOURCES) {
      expect(Object.keys(s).sort()).toEqual(["blurb", "id", "name", "url"]);
    }
  });
});
