import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DECISION_SCHEMA } from "./decision.js";
import { OpenAIModelClient, OpenAIResponseError } from "./openai.js";

/**
 * The OpenAI adapter exercised against a local Responses API stub.
 *
 * These tests verify the wire request, response-state handling, retry policy,
 * and timeout behavior without requiring a credential or calling a live model.
 */

type StubReply = {
  statusCode: number;
  delayMs: number;
  body: Record<string, unknown>;
};

let server: Server;
let baseURL: string;
let lastBody: Record<string, unknown> | null = null;
let requests = 0;
let reply: StubReply;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests += 1;
      lastBody = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      const current = reply;
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(current.statusCode, { "content-type": "application/json" });
        res.end(JSON.stringify(current.body));
      }, current.delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseURL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  lastBody = null;
  requests = 0;
  setDecision({ tool: "", arguments: "{}", next: [], confidence: "low" });
});

function client(options: ConstructorParameters<typeof OpenAIModelClient>[0] = {}) {
  return new OpenAIModelClient({
    client: new OpenAI({ apiKey: "stub-key", baseURL }),
    ...options,
  });
}

function request(tier: "fast" | "careful" = "fast", timeoutMs = 2_000) {
  return { tier, system: "SYSTEM", user: "Request: find oat milk", timeoutMs } as const;
}

function body(): Record<string, unknown> {
  if (!lastBody) throw new Error("no request was captured");
  return lastBody;
}

function setDecision(decision: Record<string, unknown>, status = "completed") {
  reply = {
    statusCode: 200,
    delayMs: 0,
    body: responseBody({
      status,
      content: [{ type: "output_text", text: JSON.stringify(decision), annotations: [] }],
    }),
  };
}

function responseBody({
  status,
  content,
  error = null,
}: {
  status: string;
  content: Record<string, unknown>[];
  error?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    id: "resp_stub",
    object: "response",
    created_at: 0,
    status,
    error,
    incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
    instructions: null,
    max_output_tokens: 1_024,
    model: String(lastBody?.["model"] ?? "stub-model"),
    output: [
      {
        id: "msg_stub",
        type: "message",
        status: status === "completed" ? "completed" : "incomplete",
        role: "assistant",
        content,
      },
    ],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: null,
    text: { format: { type: "json_schema" } },
    tool_choice: "auto",
    tools: [],
    top_p: null,
    truncation: "disabled",
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      total_tokens: 20,
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

describe("the Responses API request", () => {
  it("uses the fast model and exact strict structured-output shape", async () => {
    setDecision({
      tool: "search_products",
      arguments: '{"query":"oat milk"}',
      next: [],
      confidence: "high",
    });

    const decision = await client().decide(request());

    expect(decision).toEqual({
      tool: "search_products",
      arguments: '{"query":"oat milk"}',
      next: [],
      confidence: "high",
    });
    expect(body()).toEqual({
      model: "gpt-5.6-luna",
      instructions: "SYSTEM",
      input: "Request: find oat milk",
      store: false,
      max_output_tokens: 1_024,
      reasoning: { effort: "none" },
      text: {
        format: {
          type: "json_schema",
          name: "dusky_planner_decision",
          description: "A bounded proposal for Dusky's deterministic planner.",
          strict: true,
          schema: DECISION_SCHEMA,
        },
      },
    });
  });

  it("uses the careful model and preserves ordered multi-step decisions", async () => {
    setDecision({
      tool: "book_table",
      arguments: '{"party_size":4}',
      next: [
        { tool: "draft_message", arguments: '{"recipient":"Dana"}' },
        { tool: "send_message", arguments: "{}" },
      ],
      confidence: "high",
    });

    const decision = await client().decide(request("careful"));

    expect(body()).toMatchObject({
      model: "gpt-5.6-terra",
      max_output_tokens: 4_096,
      reasoning: { effort: "low" },
    });
    expect(decision.next).toEqual([
      { tool: "draft_message", arguments: '{"recipient":"Dana"}' },
      { tool: "send_message", arguments: "{}" },
    ]);
  });

  it("allows both tier model ids to be configured", async () => {
    const configured = client({ fastModel: "fast-override", carefulModel: "careful-override" });
    await configured.decide(request("fast"));
    expect(body()["model"]).toBe("fast-override");
    await configured.decide(request("careful"));
    expect(body()["model"]).toBe("careful-override");
  });
});

describe("safe declines", () => {
  it("turns a refusal into a decline", async () => {
    reply.body = responseBody({
      status: "completed",
      content: [{ type: "refusal", refusal: "I cannot help with that." }],
    });
    await expect(client().decide(request())).resolves.toEqual({
      tool: "",
      arguments: "{}",
      next: [],
      confidence: "low",
    });
  });

  it("turns an incomplete response into a decline", async () => {
    setDecision(
      { tool: "search_products", arguments: "{}", next: [], confidence: "high" },
      "incomplete",
    );
    await expect(client().decide(request())).resolves.toEqual({
      tool: "",
      arguments: "{}",
      next: [],
      confidence: "low",
    });
  });

  it("turns malformed structured content into a decline", async () => {
    reply.body = responseBody({
      status: "completed",
      content: [{ type: "output_text", text: "not json", annotations: [] }],
    });
    await expect(client().decide(request())).resolves.toEqual({
      tool: "",
      arguments: "{}",
      next: [],
      confidence: "low",
    });
  });
});

describe("observable failures and deadlines", () => {
  it("keeps an in-band service failure observable", async () => {
    reply.body = responseBody({
      status: "failed",
      content: [],
      error: { code: "server_error", message: "service failed" },
    });
    await expect(client().decide(request())).rejects.toBeInstanceOf(OpenAIResponseError);
  });

  it("keeps an authentication failure observable", async () => {
    reply.statusCode = 401;
    reply.body = {
      error: {
        message: "invalid credential",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    };
    await expect(client().decide(request())).rejects.toBeInstanceOf(OpenAI.AuthenticationError);
  });

  it("keeps a transport failure observable", async () => {
    const unavailable = new OpenAIModelClient({
      client: new OpenAI({ apiKey: "stub-key", baseURL: "http://127.0.0.1:1" }),
    });
    await expect(unavailable.decide(request("fast", 100))).rejects.toBeInstanceOf(
      OpenAI.APIConnectionError,
    );
  });

  it("does not retry a failed request inside the SDK", async () => {
    reply.statusCode = 500;
    reply.body = { error: { message: "try again", type: "server_error", code: "server_error" } };
    await expect(client().decide(request())).rejects.toBeInstanceOf(OpenAI.InternalServerError);
    expect(requests).toBe(1);
  });

  it("passes the planner timeout to the SDK without retrying it", async () => {
    reply.delayMs = 250;
    await expect(client().decide(request("fast", 25))).rejects.toBeInstanceOf(
      OpenAI.APIConnectionTimeoutError,
    );
    expect(requests).toBe(1);
  });
});
