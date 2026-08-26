import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@dusky/audit": pkg("audit"),
      "@dusky/contracts": pkg("contracts"),
      "@dusky/policy": pkg("policy"),
      "@dusky/frames": pkg("frames"),
      "@dusky/webmcp": pkg("webmcp"),
      "@dusky/planner": pkg("planner"),
      "@dusky/session": pkg("session"),
      "@dusky/tokens": pkg("tokens"),
    },
  },
  test: { include: ["packages/**/*.test.ts", "apps/**/*.test.ts"] },
});
