import { registerTools } from "@dusky/webmcp";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./App.module.css";

const DEFAULT_AGENT_ORIGIN = import.meta.env["VITE_DUSKY_ORIGIN"] ?? "http://localhost:7803";
const DUSKY_ORIGIN = DEFAULT_AGENT_ORIGIN;

interface Contact {
  id: string;
  name: string;
  channel: "text" | "email";
  address: string;
}

interface Message {
  id: string;
  contact_id: string;
  recipient: string;
  body: string;
  channel: string;
  status: "draft" | "sent";
}

const CONTACTS: readonly Contact[] = [
  { id: "ns-dana", name: "Dana", channel: "text", address: "+1 555 0142" },
  { id: "ns-iman", name: "Iman", channel: "email", address: "iman@example.test" },
  { id: "ns-ravi", name: "Ravi", channel: "text", address: "+1 555 0188" },
];

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<"pending" | "ready" | "unavailable">("pending");
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const note = useCallback((line: string) => {
    setLog((current) => [...current.slice(-40), line]);
  }, []);

  useEffect(() => {
    const agentOrigin = new URLSearchParams(location.search).get("agent") ?? DEFAULT_AGENT_ORIGIN;
    const lifetime = new AbortController();
    const contact = (id: unknown) => CONTACTS.find((entry) => entry.id === String(id ?? ""));
    const nextId = (prefix: string) =>
      `${prefix}-${String(messagesRef.current.length + 1).padStart(3, "0")}`;

    registerTools(
      [
        {
          name: "find_contacts",
          title: "Find a contact",
          description: "Look up people by name. Returns contact ids, names, and channels.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", description: "Who are you looking for?" } },
            required: ["query"],
          },
          annotations: { readOnlyHint: true },
          execute: async ({ query }) => {
            const q = String(query ?? "")
              .trim()
              .toLowerCase();
            const contacts = CONTACTS.filter(
              (entry) =>
                entry.name.toLowerCase().includes(q) || entry.address.toLowerCase().includes(q),
            ).map(({ id, name, channel }) => ({ id, name, channel }));
            note(`find_contacts(${q.length} query chars) -> ${contacts.length} contacts`);
            return JSON.stringify({ contacts });
          },
        },
        {
          name: "review_messages",
          title: "Review messages",
          description: "Read recent drafts and sent messages for one contact. Changes nothing.",
          inputSchema: {
            type: "object",
            properties: {
              contact_id: { type: "string", description: "Whose messages?" },
            },
            required: ["contact_id"],
          },
          annotations: { readOnlyHint: true },
          execute: async ({ contact_id }) => {
            const id = String(contact_id ?? "");
            const results = messagesRef.current
              .filter((message) => message.contact_id === id)
              .map((message) => ({
                id: message.id,
                text: message.body,
                status: message.status,
              }));
            note(`review_messages(contact selected) -> ${results.length} messages`);
            return JSON.stringify({ results });
          },
        },
        {
          name: "draft_message",
          title: "Draft message",
          description: "Save message text for a contact without sending it.",
          inputSchema: {
            type: "object",
            properties: {
              contact_id: { type: "string", description: "Who is this for?" },
              body: { type: "string", description: "What exact text should be saved?" },
            },
            required: ["contact_id", "body"],
          },
          annotations: { readOnlyHint: false },
          execute: async ({ contact_id, body }) => {
            const recipient = contact(contact_id);
            if (!recipient)
              return JSON.stringify({ ok: false, error: "That contact is unavailable." });
            const message: Message = {
              id: nextId("DRF"),
              contact_id: recipient.id,
              recipient: recipient.name,
              body: String(body ?? ""),
              channel: recipient.channel,
              status: "draft",
            };
            setMessages((current) => [...current, message]);
            note(`draft_message(contact selected, ${message.body.length} chars) -> ${message.id}`);
            return JSON.stringify({
              ok: true,
              draft_id: message.id,
              recipient: message.recipient,
              channel: message.channel,
              character_count: message.body.length,
            });
          },
        },
        {
          name: "send_message",
          title: "Send message",
          description: "Send exact message text to one contact by contact id.",
          inputSchema: {
            type: "object",
            properties: {
              contact_id: { type: "string", description: "Who should receive it?" },
              body: { type: "string", description: "What exact text should be sent?" },
            },
            required: ["contact_id", "body"],
          },
          annotations: { readOnlyHint: false },
          execute: async ({ contact_id, body }) => {
            const recipient = contact(contact_id);
            if (!recipient)
              return JSON.stringify({ ok: false, error: "That contact is unavailable." });
            const message: Message = {
              id: nextId("MSG"),
              contact_id: recipient.id,
              recipient: recipient.name,
              body: String(body ?? ""),
              channel: recipient.channel,
              status: "sent",
            };
            setMessages((current) => [...current, message]);
            note(`send_message(contact selected, ${message.body.length} chars) -> ${message.id}`);
            return JSON.stringify({
              ok: true,
              message_id: message.id,
              recipient: message.recipient,
              channel: message.channel,
              status: message.status,
            });
          },
        },
      ],
      { exposedTo: [agentOrigin], signal: lifetime.signal },
    )
      .then(() => {
        if (lifetime.signal.aborted) return;
        setStatus("ready");
        note(`registered 4 tools, exposedTo ${agentOrigin}`);
      })
      .catch((error: unknown) => {
        if (lifetime.signal.aborted) return;
        setStatus("unavailable");
        note(error instanceof Error ? error.message : String(error));
      });

    return () => lifetime.abort();
  }, [note]);

  return (
    <main className={styles.page}>
      <p className={styles.banner}>Test environment &middot; nothing is actually delivered</p>
      <header className={styles.head}>
        <span className={styles.route} aria-hidden="true" />
        <div>
          <h1 className={styles.title}>Northstar Dispatch</h1>
          <p className={styles.sub}>
            A small communications desk for contacts, drafts, and sent messages. It shares no
            product, cart, table, slot, or booking vocabulary with the other sites in Dusky.
          </p>
        </div>
      </header>

      <div className={styles.board}>
        <section className={styles.panel}>
          <h2 className={styles.h2}>
            Contacts <span className={styles.count}>{CONTACTS.length}</span>
          </h2>
          <ul className={styles.contacts}>
            {CONTACTS.map((entry) => (
              <li key={entry.id} className={styles.contact}>
                <span className={styles.name}>{entry.name}</span>
                <span className={styles.channel}>{entry.channel}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.h2}>
            Outbox <span className={styles.count}>{messages.length}</span>
          </h2>
          <div data-testid="outbox">
            {messages.length ? (
              <ul className={styles.messages}>
                {messages.map((message) => (
                  <li key={message.id} className={styles.message}>
                    <span className={styles.name}>{message.recipient}</span>
                    <span className={styles.body}>{message.body}</span>
                    <span className={styles.meta}>
                      {message.status} via {message.channel} &middot; {message.id}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>none sent</p>
            )}
          </div>
        </section>
      </div>

      <p className={styles.origin}>
        Part of <a href={DUSKY_ORIGIN}>Dusky</a>. The browser reads the tools this page declares;
        the page never receives another site&apos;s result unless the wearer approves that transfer.
      </p>

      <section className={styles.activity}>
        <h2 className={styles.h2}>
          Tool activity
          <span className={styles.status} data-status={status}>
            {status === "ready" ? "4 tools registered" : status}
          </span>
        </h2>
        <pre className={styles.log}>{log.length ? log.join("\n") : "waiting for an agent"}</pre>
      </section>
    </main>
  );
}
