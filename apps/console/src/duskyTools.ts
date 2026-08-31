import type { AgentReply, AgentRequest } from "@dusky/contracts";
import type { ProvidedTool } from "@dusky/webmcp";

/**
 * Dusky's own WebMCP tools.
 *
 * Everywhere else in this repository Dusky is a CONSUMER of WebMCP. Here it is
 * a provider, which is what lets an agent in ChatGPT's built-in browser drive
 * a pair of glasses from the surface the person is already sitting in. Same
 * protocol, both directions, one product.
 *
 * Three rules shape this file.
 *
 * NO SESSION IDENTIFIER, ANYWHERE. `AgentRequest` has no field for one and
 * these tools declare no parameter for one. The session is whichever session
 * THIS console page is paired to, which the caller cannot influence. A tool
 * that accepted a session id would let anyone able to reach it drive any
 * session whose pairing code they could guess, and pairing codes are six
 * characters because a wearer has to read them off a lens.
 *
 * THE SERVER DECIDES, NOT THIS FILE. Every tool forwards to the relay and
 * reports what comes back. The relay owns the task state, so the relay is what
 * refuses a task that would interrupt a pending confirmation. Enforcing that
 * here instead would put the rule in the layer an attacker is already in.
 *
 * ONLY WHAT DUSKY ACTUALLY IS. Four tools, each answering a question an agent
 * genuinely has: is anyone there, what can they do, here is something to do,
 * stop. `get_active_task` and `connect_display` are deliberately absent: the
 * first is the same question as `get_display_status`, and the second describes
 * a flow that does not exist, since the glasses mint the pairing code and the
 * browser joins it rather than the other way round.
 */

export interface DuskyToolDeps {
  /** Forwards to the relay, which owns the session state and the rules. */
  ask: (request: AgentRequest) => Promise<AgentReply>;
  /** Local activity log, so a human watching the console sees agent traffic. */
  note: (line: string) => void;
}

/**
 * `executeTool` resolves to a DOMString, so structure travels as JSON. A
 * refusal is returned as a value rather than thrown: an agent that is told
 * WHY it was refused can explain it to the person, while an exception just
 * looks like Dusky is broken.
 */
function reply(r: AgentReply): string {
  return JSON.stringify(r.ok ? { ok: true, ...r.value } : { ok: false, error: r.error });
}

export function duskyTools({ ask, note }: DuskyToolDeps): ProvidedTool[] {
  const run = async (request: AgentRequest): Promise<string> => {
    note(`agent -> ${request.op}${request.op === "task" ? `(${request.text})` : "()"}`);
    const r = await ask(request);
    note(`  <- ${r.ok ? "ok" : `refused: ${r.error}`}`);
    return reply(r);
  };

  return [
    {
      name: "get_display_status",
      title: "Check the glasses",
      description:
        "Report whether a pair of Meta Ray-Ban Display glasses is connected to this Dusky " +
        "session, what is currently on the display, and whether Dusky can accept a new task " +
        "right now. Call this before sending a task.",
      inputSchema: { type: "object", properties: {} },
      annotations: {
        readOnlyHint: true,
        // What is on the display is built from a third-party site's tool
        // schemas, so this relays text that site wrote. Saying so is the
        // honest thing to do when handing it to another agent to read.
        untrustedContentHint: true,
      },
      execute: () => run({ op: "status" }),
    },
    {
      name: "list_display_actions",
      title: "List what the wearer can do",
      description:
        "List every action declared by every website this Dusky session is holding, with " +
        "the site each one belongs to, the consequence Dusky assigns it, and whether it " +
        "will stop for the wearer's approval. The sites are unrelated to each other, so one " +
        "task may reasonably span several of them. Use this to know what is possible before " +
        "describing options to someone.",
      inputSchema: { type: "object", properties: {} },
      annotations: {
        readOnlyHint: true,
        // Names and titles here come from the partner site, not from Dusky.
        untrustedContentHint: true,
      },
      execute: () => run({ op: "actions" }),
    },
    {
      name: "send_task_to_display",
      title: "Send a task to the glasses",
      description:
        "Hand the wearer something to act on, in plain words, for example 'find oat milk' " +
        "or 'book a table and add oat milk to my cart'. Dusky chooses the matching end " +
        "actions from any connected websites and puts them on the glasses in order. You are " +
        "not performing the actions: each action Dusky does not classify as read-only stops " +
        "for approval from the wearer, and you cannot approve it for them. Refused, with " +
        "a reason, if no glasses are connected or the wearer is already mid-decision.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "What the wearer wants, in their own words.",
          },
        },
        required: ["text"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => run({ op: "task", text: String(input["text"] ?? "") }),
    },
    {
      name: "cancel_active_task",
      title: "Cancel what the glasses are doing",
      description:
        "Clear pending choices and future task steps. If a provider invocation was already " +
        "sent, Dusky cannot recall it and will report that it may still finish.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => run({ op: "cancel" }),
    },
  ];
}
