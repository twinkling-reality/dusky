import { registerTools } from "@dusky/webmcp";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./App.module.css";
import { DAYS, MAX_PARTY, type Reservation, reference, SLOTS, TIMES } from "./availability.js";

/**
 * Amber & Oak is a second first-party WebMCP test service.
 *
 * It exists to be a site Dusky has never seen. Verdant Market sells things,
 * this one holds tables, and the two share no vocabulary: a shop returns
 * `cart_total`, this returns `reservation_id` and `party_size`. If a wearer
 * can drive both with no change inside Dusky, then the interface really is
 * derived from tool schemas rather than written against a site.
 *
 * The schemas are also chosen to reach parts of the frame compiler that
 * Verdant Market never touches. Every parameter over there is a bare string,
 * so the enum, integer-enum and boolean branches of `paramKind` have never
 * been visible to anyone. Here they are, and the frames they produce differ
 * mechanically rather than cosmetically.
 *
 * Like the market, this is labelled a test environment everywhere it is
 * visible. No table is actually held.
 */

const DEFAULT_AGENT_ORIGIN = import.meta.env["VITE_DUSKY_ORIGIN"] ?? "http://localhost:7803";

/**
 * Where to send somebody who arrived here directly.
 *
 * This page is a prop. It is built to be seen inside Dusky's demo, in a panel
 * a few hundred pixels wide, and standing on its own it tells a visitor
 * nothing about what it is or how they got here.
 */
const DUSKY_ORIGIN = DEFAULT_AGENT_ORIGIN;

/** Party sizes as an enum, because the room's largest table is what bounds it. */
const PARTY_SIZES = Array.from({ length: MAX_PARTY }, (_, i) => i + 1);

export function App() {
  const [book, setBook] = useState<Reservation[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<"pending" | "ready" | "unavailable">("pending");

  // The tools close over the book, so keep a ref the callbacks can read
  // without forcing a re-registration on every booking.
  const bookRef = useRef<Reservation[]>(book);
  bookRef.current = book;

  const note = useCallback((line: string) => {
    setLog((l) => [...l.slice(-40), line]);
  }, []);

  useEffect(() => {
    // Created synchronously so a StrictMode double-invoke cannot leave the
    // first registration pass alive long enough to collide with the second.
    const lifetime = new AbortController();

    registerTools(
      [
        {
          name: "find_times",
          // A title the site supplies wins over anything derived from the
          // name. The other two tools omit it on purpose, so both paths
          // through `label()` are visible in one menu.
          title: "Find a table",
          description:
            "Look up open tables on a given day for a given number of people. " +
            "Returns available slots with ids and times. Holds nothing.",
          inputSchema: {
            type: "object",
            properties: {
              date: {
                type: "string",
                enum: DAYS,
                description: "Which day?",
              },
              party_size: {
                type: "integer",
                enum: PARTY_SIZES,
                description: "How many people?",
              },
            },
            required: ["date", "party_size"],
          },
          annotations: { readOnlyHint: true },
          execute: async ({ date, party_size }) => {
            const day = String(date ?? "");
            const seats = Number(party_size ?? 0);
            const slots = SLOTS.filter((s) => s.day === day && s.seats >= seats).map((s) => ({
              id: s.id,
              name: s.name,
              seats: s.seats,
            }));
            note(`find_times("${day}", ${seats}) -> ${slots.length} slots`);
            return JSON.stringify({ slots });
          },
        },
        {
          name: "book_table",
          description: "Hold a table under a booking. The restaurant confirms it immediately.",
          inputSchema: {
            type: "object",
            properties: {
              slot_id: { type: "string", description: "Which table?" },
              party_size: {
                type: "integer",
                enum: PARTY_SIZES,
                description: "How many people?",
              },
              outdoor_seating: { type: "boolean", description: "Sit outside?" },
              // Declared but not required, so a wearer is never asked for it.
              // It is here because a schema's `required` list is load-bearing
              // and worth being able to see doing its job.
              note: { type: "string", description: "Anything the kitchen should know?" },
            },
            required: ["slot_id", "party_size", "outdoor_seating"],
          },
          annotations: { readOnlyHint: false },
          execute: async ({ slot_id, party_size, outdoor_seating, note: kitchen }) => {
            const slot = SLOTS.find((s) => s.id === slot_id);
            // Thrown, not returned. The market's add_to_cart fails the same
            // way; change_reservation below fails the OTHER way. Dusky has to
            // read both, and only one of them looks like an error.
            if (!slot) throw new Error(`no such table: ${String(slot_id)}`);
            const held: Reservation = {
              id: reference(bookRef.current.length + 1),
              slot_id: slot.id,
              day: slot.day,
              time: slot.name,
              party_size: Number(party_size ?? 0),
              outdoor: outdoor_seating === true,
              ...(typeof kitchen === "string" && kitchen.trim() ? { note: kitchen.trim() } : {}),
            };
            setBook((b) => [...b, held]);
            note(`book_table("${slot.id}") -> ${held.id}`);
            return JSON.stringify({
              ok: true,
              reservation_id: held.id,
              party_size: held.party_size,
              date: held.day,
              time: held.time,
              outdoor: held.outdoor,
            });
          },
        },
        {
          name: "change_reservation",
          description: "Move an existing booking to a different service time.",
          inputSchema: {
            type: "object",
            properties: {
              reservation_id: { type: "string", description: "Which reservation?" },
              new_time: {
                type: "string",
                enum: TIMES,
                description: "Move it to when?",
              },
            },
            required: ["reservation_id", "new_time"],
          },
          annotations: { readOnlyHint: false },
          execute: async ({ reservation_id, new_time }) => {
            const id = String(reservation_id ?? "").toUpperCase();
            const existing = bookRef.current.find((r) => r.id === id);
            // RETURNED, not thrown. A site answering `{"ok": false}` has
            // returned a result and that result is a failure, which is the
            // distinction `outcomeFromResult` exists to make. Verdant Market
            // never produces one, so nothing else in this repository exercises
            // it against a real browser.
            if (!existing) {
              note(`change_reservation("${id}") -> unknown reservation`);
              return JSON.stringify({ ok: false, error: `No booking called ${id}.` });
            }
            const time = String(new_time ?? existing.time);
            setBook((b) => b.map((r) => (r.id === id ? { ...r, time } : r)));
            note(`change_reservation("${id}") -> ${existing.time} to ${time}`);
            return JSON.stringify({
              ok: true,
              reservation_id: id,
              party_size: existing.party_size,
              date: existing.day,
              time,
              changed_from: existing.time,
            });
          },
        },
      ],
      { exposedTo: [DEFAULT_AGENT_ORIGIN], signal: lifetime.signal },
    )
      .then(() => {
        if (lifetime.signal.aborted) return;
        setStatus("ready");
        note(`registered 3 tools, exposedTo ${DEFAULT_AGENT_ORIGIN}`);
      })
      .catch((err: unknown) => {
        if (lifetime.signal.aborted) return;
        setStatus("unavailable");
        note(err instanceof Error ? err.message : String(err));
      });

    return () => lifetime.abort();
  }, [note]);

  return (
    <main className={styles.page}>
      <p className={styles.banner}>Test environment &middot; no table is actually held</p>

      <header className={styles.head}>
        <h1 className={styles.title}>Amber &amp; Oak</h1>
        <p className={styles.sub}>
          A first-party WebMCP service with nothing in common with a shop. It exists so Dusky can be
          pointed at a vocabulary it has never seen: slots and bookings rather than products and
          carts. Nothing here is reserved.
        </p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.h2}>The book</h2>
        <ul className={styles.list}>
          {DAYS.map((day) => (
            <li key={day} className={styles.row}>
              <span className={styles.day}>{day}</span>
              <span className={styles.num}>
                {SLOTS.filter((s) => s.day === day)
                  .map((s) => s.name)
                  .join("  ")}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Reservations</h2>
        <p className={styles.held} data-testid="book">
          {book.length ? (
            book.map((r) => (
              <span key={r.id} className={styles.heldRow}>
                <strong>{r.id}</strong>
                <span>
                  {" "}
                  {r.time}, {r.day}, {r.party_size} {r.party_size === 1 ? "person" : "people"}
                  {r.outdoor ? ", outside" : ""}
                </span>
              </span>
            ))
          ) : (
            <>none</>
          )}
        </p>
      </section>

      <p className={styles.origin}>
        Part of <a href={DUSKY_ORIGIN}>Dusky</a>, which reads the tools this page declares and turns
        them into an interface for a pair of glasses. You are most likely meant to be looking at
        this inside Dusky rather than on its own.
      </p>

      <section className={styles.section}>
        <h2 className={styles.h2}>
          Tool activity
          <span className={styles.status} data-status={status}>
            {status === "ready" ? "3 tools registered" : status}
          </span>
        </h2>
        <pre className={styles.log}>{log.length ? log.join("\n") : "waiting for an agent"}</pre>
      </section>
    </main>
  );
}
