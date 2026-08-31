import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Shared behavior cannot know which bundled fixture or runtime proof provider
 * happened to expose a tool. Examples in comments are useful field evidence,
 * so this checks the executable source after comments are removed rather than
 * banning the words from the repository.
 */
describe("shared behavior stays independent of every proof provider", () => {
  const directories = [
    new URL("./", import.meta.url),
    new URL("../../session/src/", import.meta.url),
    new URL("../../policy/src/", import.meta.url),
    new URL("../../planner/src/", import.meta.url),
  ];
  const files = directories.flatMap((directory) =>
    readdirSync(directory)
      .filter(
        (name) =>
          name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".fixtures.ts"),
      )
      .map((name) => new URL(name, directory)),
  );
  const executable = files
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("contains no brand, complete tool name, or provider-only result key", () => {
    const sourceVocabulary = [
      "Verdant Market",
      "Amber & Oak",
      "Northstar Dispatch",
      "Canopy Lab",
      "search_products",
      "add_to_cart",
      "review_cart",
      "empty_cart",
      "find_times",
      "book_table",
      "change_reservation",
      "find_contacts",
      "review_messages",
      "draft_message",
      "send_message",
      "estimate_shade",
      "cart_total",
      "reservation_id",
      "party_size",
      "message_id",
      "survey_zone",
      "shade_percent",
      "canopy_condition",
    ];

    for (const term of sourceVocabulary) expect(executable).not.toContain(term);
  });

  it("cannot import an application or its source registry", () => {
    const imports = [...executable.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    );

    for (const specifier of imports) {
      expect(specifier).not.toMatch(/^@dusky\/app-/);
      expect(specifier).not.toMatch(/(?:^|\/)apps\//);
      expect(specifier).not.toMatch(/(?:^|\/)sources(?:\.[cm]?[jt]s)?$/);
    }
  });
});
