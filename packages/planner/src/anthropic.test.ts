import { createServer, type Server } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnthropicModelClient } from "./anthropic.js";

/**
 * The adapter, exercised against a stub that speaks the Messages API wire
 * format.
 *
 * This is not a test of the model. It is a test of the REQUEST, and it exists
 * because "it typechecks" and "it sends what I meant" are different claims.
 * It needs no credential, so it runs in CI, and it fails loudly if an SDK
 * upgrade changes the body shape underneath us.
 */

let server: Server;
let baseURL: string;
let lastBody: Record<string, unknown> | null = null;
let reply = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastBody = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_stub",
          type: "message",
          role: "assistant",
          model: String(lastBody["model"]),
          content: [{ type: "text", text: reply }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  baseURL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => {
  server.close();
});

const client = () =>
  new AnthropicModelClient({
    client: new Anthropic({ apiKey: "stub-key", baseURL }),
  });

const answer = (o: Record<string, unknown>) => {
  reply = JSON.stringify(o);
};

/** The last captured request body, asserted present so the tests read cleanly. */
const body = (): Record<string, unknown> => {
  if (!lastBody) throw new Error("no request was captured");
  return lastBody;
};

const outputConfig = (): Record<string, unknown> =>
  body()["output_config"] as Record<string, unknown>;

describe("the request the adapter builds", () => {
  it("asks for the answer schema and keeps the output small", async () => {
    answer({
      tool: "search_products",
      arguments: '{"query":"oat milk"}',
      next: [],
      confidence: "high",
    });
    const d = await client().decide({
      tier: "fast",
      system: "SYSTEM",
      user: "Request: find oat milk",
      timeoutMs: 2_000,
    });

    expect(d).toEqual({
      tool: "search_products",
      arguments: '{"query":"oat milk"}',
      next: [],
      confidence: "high",
    });

    expect(body()).toMatchObject({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: "SYSTEM",
      messages: [{ role: "user", content: "Request: find oat milk" }],
    });
    const output = outputConfig();
    const format = output["format"] as Record<string, unknown>;
    expect(format["type"]).toBe("json_schema");
    expect(format["schema"]).toMatchObject({
      type: "object",
      required: ["tool", "arguments", "next", "confidence"],
    });
    // Haiku 4.5 rejects output_config.effort, so the fast tier must not send it.
    expect(output["effort"]).toBeUndefined();
  });

  it("sends the same schema for the careful tier, at its own model and effort", async () => {
    answer({ tool: "", arguments: "{}", next: [], confidence: "low" });
    const fastSchema = (outputConfig()["format"] as Record<string, unknown>)["schema"];

    await client().decide({ tier: "careful", system: "S", user: "U", timeoutMs: 2_000 });
    const output = outputConfig();

    expect(body()["model"]).toBe("claude-sonnet-5");
    expect(output["effort"]).toBe("low");
    // One schema across both tiers and every planning path, so the API's
    // 24-hour schema cache is hit rather than recompiled per request.
    expect((output["format"] as Record<string, unknown>)["schema"]).toEqual(fastSchema);
  });

  it("reads an ordered multi-action answer from the same stable schema", async () => {
    answer({
      tool: "book_table",
      arguments: '{"party_size":2}',
      next: [{ tool: "add_to_cart", arguments: '{"product_id":"oat-1"}' }],
      confidence: "high",
    });
    const decision = await client().decide({
      tier: "fast",
      system: "SYSTEM",
      user: "Request: book a table and add oat milk",
      timeoutMs: 2_000,
    });
    expect(decision.next).toEqual([{ tool: "add_to_cart", arguments: '{"product_id":"oat-1"}' }]);
  });

  it("honours a tier override, so a deployment can run one model for both", async () => {
    answer({ tool: "", arguments: "{}", next: [], confidence: "low" });
    const c = new AnthropicModelClient({
      client: new Anthropic({ apiKey: "stub-key", baseURL }),
      fast: { model: "claude-sonnet-5", effort: "medium", maxTokens: 256 },
    });
    await c.decide({ tier: "fast", system: "S", user: "U", timeoutMs: 2_000 });
    expect(body()).toMatchObject({ model: "claude-sonnet-5", max_tokens: 256 });
  });
});

describe("an answer the adapter cannot use", () => {
  it("declines rather than throwing when the model returns nothing parseable", async () => {
    reply = "this is not the JSON you asked for";
    const d = await client().decide({ tier: "fast", system: "S", user: "U", timeoutMs: 2_000 });
    expect(d).toEqual({ tool: "", arguments: "{}", next: [], confidence: "low" });
  });

  it("declines an answer with malformed structured fields", async () => {
    answer({ tool: "search_products", arguments: "{}", next: [], confidence: "certain" });
    const d = await client().decide({ tier: "fast", system: "S", user: "U", timeoutMs: 2_000 });
    expect(d).toEqual({ tool: "", arguments: "{}", next: [], confidence: "low" });
  });
});

describe("a failure the wearer should hear about", () => {
  it("lets a transport or quota error through, so the planner can escalate", async () => {
    const failing = new AnthropicModelClient({
      client: new Anthropic({
        apiKey: "stub-key",
        // A port nothing is listening on: a connection error, not a bad answer.
        baseURL: "http://127.0.0.1:1",
      }),
    });
    await expect(
      failing.decide({ tier: "fast", system: "S", user: "U", timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(Anthropic.APIError);
  });
});
