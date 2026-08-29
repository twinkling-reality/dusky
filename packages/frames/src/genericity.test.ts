import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Shared behavior cannot know which first-party source happened to expose a
 * tool. Examples in comments are useful field evidence, so this checks the
 * executable source after comments are removed rather than banning the words
 * from the repository.
 */
describe("shared behavior stays independent of every first-party source", () => {
  it("contains no brand, complete tool name, or source-only result key", () => {
    const files = [
      new URL("./index.ts", import.meta.url),
      new URL("../../session/src/index.ts", import.meta.url),
      new URL("../../policy/src/index.ts", import.meta.url),
      new URL("../../planner/src/planner.ts", import.meta.url),
      new URL("../../planner/src/rank.ts", import.meta.url),
      new URL("../../planner/src/cards.ts", import.meta.url),
    ];
    const executable = files
      .map((file) => readFileSync(file, "utf8"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const sourceVocabulary = [
      "Verdant Market",
      "Amber & Oak",
      "Northstar Dispatch",
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
      "cart_total",
      "reservation_id",
      "party_size",
      "message_id",
    ];

    for (const term of sourceVocabulary) expect(executable).not.toContain(term);
  });
});
