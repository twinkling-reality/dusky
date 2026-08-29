import { expect, type Page, test } from "@playwright/test";
import type { ToolDescriptor } from "../packages/contracts/src/index.ts";
import { type Planner, Session, type ToolRunner } from "../packages/session/src/index.ts";

const SITE = "http://localhost:7803/demo?start=1";
const TABLES = "http://localhost:7804";
const DISPATCH = "http://localhost:7805";
const ORIGINS = ["http://localhost:7801", TABLES, DISPATCH];

function normalizeSchema(raw: unknown): Record<string, unknown> | null {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * A Session runner backed by the real document.modelContext in Chrome.
 *
 * Handles stay in the browser because a registered tool contains a Window and
 * cannot be serialized. Descriptors cross into the test process, while every
 * invocation goes back through executeTool in the provider's own document.
 */
class BrowserRunner implements ToolRunner {
  constructor(private readonly page: Page) {}

  async discover(): Promise<ToolDescriptor[]> {
    const plain = await this.page.evaluate(async (origins) => {
      const doc = document as unknown as {
        modelContext: {
          getTools(options: { fromOrigins: string[] }): Promise<
            {
              name: string;
              title?: string;
              description?: string;
              origin: string;
              inputSchema?: unknown;
              annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
            }[]
          >;
        };
      };
      const tools = await doc.modelContext.getTools({ fromOrigins: origins });
      const accepted = tools.filter((tool) => origins.includes(tool.origin));
      (window as unknown as { __duskyTransferTools?: Map<string, unknown> }).__duskyTransferTools =
        new Map(accepted.map((tool) => [`${tool.origin} ${tool.name}`, tool]));
      return accepted.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description ?? "",
        origin: tool.origin,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      }));
    }, ORIGINS);

    return plain.map((tool) => ({
      name: tool.name,
      ...(tool.title?.trim() ? { title: tool.title.trim() } : {}),
      description: tool.description,
      origin: tool.origin,
      inputSchema: normalizeSchema(tool.inputSchema),
      annotations: {
        readOnlyHint: tool.annotations?.readOnlyHint === true,
        untrustedContentHint: tool.annotations?.untrustedContentHint === true,
      },
    }));
  }

  invoke(origin: string, name: string, args: Record<string, unknown>): Promise<string> {
    return this.page.evaluate(
      async ({ key, input }) => {
        const handles = (window as unknown as { __duskyTransferTools?: Map<string, unknown> })
          .__duskyTransferTools;
        const handle = handles?.get(key);
        if (!handle) throw new Error(`tool not held: ${key}`);
        const doc = document as unknown as {
          modelContext: {
            executeTool(tool: unknown, input: string): Promise<string>;
          };
        };
        // Chrome 151 requires JSON-string arguments. This is one invocation,
        // never a retry, including for writes.
        return doc.modelContext.executeTool(handle, JSON.stringify(input));
      },
      { key: `${origin} ${name}`, input: args },
    );
  }
}

const planner: Planner = {
  pickTool: async () => null,
  pickTools: async () => [
    {
      name: "book_table",
      args: { slot_id: "ao-m-1800", party_size: 4, outdoor_seating: false },
    },
    { name: "send_message", args: {} },
  ],
  planResolver: async (missing) =>
    missing === "contact_id" ? { name: "find_contacts", args: { query: "Dana" } } : null,
};

test("a reservation result crosses sites only after approval, then sends through WebMCP", async ({
  page,
}) => {
  await page.goto(SITE);
  const book = page.frameLocator('iframe[title="Amber & Oak"]').getByTestId("book");
  const outbox = page.frameLocator('iframe[title="Northstar Dispatch"]').getByTestId("outbox");
  await expect(book).toHaveText("none");
  await expect(outbox).toHaveText("none sent");
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);

  const session = new Session({
    source: "Dusky",
    siteName: (origin) =>
      origin === TABLES ? "Amber & Oak" : origin === DISPATCH ? "Northstar Dispatch" : origin,
    runner: new BrowserRunner(page),
    planner,
  });
  await session.start();

  const reservationGate = await session.submitText(
    "Reserve a table for four, then send the reservation details to Dana",
  );
  expect(reservationGate).toMatchObject({ kind: "confirm", source: "Amber & Oak" });
  await expect(book).toHaveText("none");

  const reservation = await session.handle("__confirm");
  expect(reservation).toMatchObject({ kind: "result", ok: true });
  await expect(book).toContainText("4 people");
  await expect(outbox).toHaveText("none sent");

  const contacts = await session.handle("__next");
  expect(contacts.kind).toBe("choose");
  const projections = await session.handle("ns-dana");
  if (projections.kind !== "choose") throw new Error("expected retained projection choices");
  const summary = projections.choices.find((choice) => choice.label === "Summary");
  if (!summary) throw new Error("expected a generic summary projection");

  const transfer = await session.handle(summary.id);
  expect(transfer).toMatchObject({
    kind: "transfer",
    from: "Amber & Oak",
    to: "Northstar Dispatch",
    argument: "Body",
  });
  if (transfer.kind !== "transfer") throw new Error("expected transfer approval");
  await expect(outbox).toHaveText("none sent");

  const sendGate = await session.handle("__share");
  expect(sendGate).toMatchObject({ kind: "confirm", source: "Northstar Dispatch" });
  await expect(outbox).toHaveText("none sent");

  const done = await session.handle("__confirm");
  expect(done).toMatchObject({ kind: "result", title: "Task complete", source: "Dusky" });
  if (done.kind !== "result") throw new Error("expected the final task result");
  expect(done.facts?.map((fact) => fact.label)).toEqual(["Amber & Oak", "Northstar Dispatch"]);
  await expect(outbox).toContainText(transfer.preview);
  await expect(outbox).toContainText("Dana");
});
