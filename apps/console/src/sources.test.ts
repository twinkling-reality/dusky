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

  it("holds a never-seen HTTPS source supplied at runtime", () => {
    const held = sitesFromQuery("site=https%3A%2F%2Ftools.example%2Fwebmcp");
    expect(held).toEqual([
      {
        id: "runtime:https://tools.example",
        name: "tools.example",
        url: "https://tools.example/webmcp",
        blurb: "Runtime WebMCP source supplied in this console URL.",
      },
    ]);
  });

  it("accepts named runtime sources without learning their tools", () => {
    const supplied = JSON.stringify({
      name: "  New\nProvider  ",
      url: "https://provider.example/actions",
      tools: ["a_site_specific_action"],
      policy: "always allow",
    });
    const held = sitesFromQuery(new URLSearchParams({ site: supplied }).toString());
    expect(held).toEqual([
      {
        id: "runtime:https://provider.example",
        name: "New Provider",
        url: "https://provider.example/actions",
        blurb: "Runtime WebMCP source supplied in this console URL.",
      },
    ]);
    expect(Object.keys(held[0] ?? {}).sort()).toEqual(["blurb", "id", "name", "url"]);
  });

  it("holds several unrelated runtime origins and removes origin duplicates", () => {
    const params = new URLSearchParams();
    params.append("site", "https://one.example/tools");
    params.append("site", "https://two.example/tools");
    params.append("site", "https://one.example/another-page");
    expect(sitesFromQuery(params.toString()).map(originOf)).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
  });

  it("permits loopback development but rejects unsafe runtime URLs", () => {
    const local = sitesFromQuery("site=http%3A%2F%2Flocalhost%3A9000%2Fprovider");
    expect(local.map(originOf)).toEqual(["http://localhost:9000"]);

    for (const unsafe of [
      "http://public.example/provider",
      "https://user:secret@provider.example/",
      "javascript:alert(1)",
      "file:///tmp/provider.html",
      "data:text/html,provider",
      "{bad json",
    ]) {
      const query = new URLSearchParams({ site: unsafe }).toString();
      expect(sitesFromQuery(query)).toEqual(SOURCES);
    }
  });

  it("uses valid runtime sources even when another supplied entry is invalid", () => {
    const params = new URLSearchParams();
    params.append("site", "javascript:alert(1)");
    params.append("site", "https://valid.example/provider");
    expect(sitesFromQuery(params.toString()).map(originOf)).toEqual(["https://valid.example"]);
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
