import { createRoot } from "react-dom/client";
import "../../apps/display/src/display.css";
import type { DisplayFrame, ToolDescriptor } from "../../packages/contracts/src/index.ts";
import {
  confirmFrame,
  parameters,
  paramFrame,
  resultFrame,
  transferFrame,
} from "../../packages/frames/src/index.ts";
import { FrameView } from "../../packages/lens/src/index.ts";
import "../../packages/tokens/src/tokens.css";

const summary = "Reservation AO-824, Tuesday at 6:00 PM, 4 people, indoors";
const sendTool: ToolDescriptor = {
  name: "send_message",
  title: "Send message",
  description: "Send a message to a contact.",
  origin: "https://communications.example",
  inputSchema: {
    type: "object",
    properties: {
      contact_id: { type: "string" },
      body: { type: "string" },
    },
    required: ["contact_id", "body"],
  },
  annotations: { readOnlyHint: false, untrustedContentHint: false },
};
const contactTool: ToolDescriptor = {
  ...sendTool,
  name: "find_contacts",
  title: "Find a contact",
  description: "Look up people by name.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Who are you looking for?" },
    },
    required: ["query"],
  },
  annotations: { readOnlyHint: true, untrustedContentHint: false },
};
const contactQuery = parameters(contactTool)[0];
if (!contactQuery) throw new Error("missing contact query fixture");

const frames: Record<string, DisplayFrame> = {
  parameter: paramFrame("Northstar Dispatch", contactTool, contactQuery),
  transfer: transferFrame("Dusky", "Amber & Oak", "Northstar Dispatch", "body", summary),
  confirmation: confirmFrame("Northstar Dispatch", sendTool, `Dana: ${summary}`, "write"),
  progress: resultFrame("Amber & Oak", "Reservation confirmed", {
    ok: true,
    facts: [
      { label: "Reservation", value: "AO-824" },
      { label: "Party", value: "4 people" },
    ],
    next: { label: "Send message", index: 2, total: 2 },
  }),
  final: resultFrame("Dusky", "Task complete", {
    ok: true,
    facts: [
      { label: "Amber & Oak", value: "Reservation AO-824 confirmed" },
      { label: "Northstar Dispatch", value: "Message sent to Dana" },
    ],
  }),
};

const fixture = new URLSearchParams(location.search).get("fixture") ?? "transfer";
const frame = frames[fixture] ?? frames["transfer"];
if (!frame) throw new Error("missing frame fixture");

createRoot(document.getElementById("root")!).render(
  <FrameView
    frame={frame}
    frameKey={fixture}
    keyboard={false}
    onChoose={() => {}}
    onBack={() => {}}
    onText={() => {}}
  />,
);
