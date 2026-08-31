import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A provider chooses who may consume its tools. The embedding page does not.
 *
 * The fixtures once read `?agent=` and reflected it into `exposedTo`, which
 * made the browser's authorization boundary caller-controlled. Keep this as a
 * source audit because all three providers must obey the same rule even though
 * they remain independent applications.
 */
describe("provider authorization", () => {
  it("comes only from trusted provider configuration", () => {
    const providers = [
      new URL("../../market/src/App.tsx", import.meta.url),
      new URL("../../reservations/src/App.tsx", import.meta.url),
      new URL("../../dispatch/src/App.tsx", import.meta.url),
    ];

    for (const provider of providers) {
      const source = readFileSync(provider, "utf8");
      expect(source).not.toContain('.get("agent")');
      expect(source).toContain("exposedTo: [DEFAULT_AGENT_ORIGIN]");
    }

    const workspace = readFileSync(new URL("./Workspace.tsx", import.meta.url), "utf8");
    expect(workspace).not.toContain("?agent=");
  });
});
