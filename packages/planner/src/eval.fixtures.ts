import type { ToolDescriptor } from "@dusky/contracts";

/**
 * A corpus for measuring the numbers this package currently guesses.
 *
 * `AGENTS.md` says the shortlist size, the tier defaults and the budget are
 * "reasoned, not measured", and `NOTES.local.md` says to settle them with
 * evals rather than by taste. The first of those three needs no model and no
 * credential at all, which is what this file is for.
 *
 * The tools are the ones the two first-party sites actually register, copied
 * rather than imported because `packages/planner` must not depend on an app,
 * plus a few from other domains so a corpus of seven does not quietly become
 * a corpus about shopping.
 */

const t = (d: Partial<ToolDescriptor> & { name: string; description: string }): ToolDescriptor => ({
  origin: "https://shop.test",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: false, untrustedContentHint: false },
  ...d,
});

/* --------------------------------------------- Verdant Market, apps/market */

export const MARKET: ToolDescriptor[] = [
  t({
    name: "search_products",
    title: "Search catalog",
    description:
      "Search the product catalog by free text. Returns matching products with ids and prices.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "What are you looking for?" } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  }),
  t({
    name: "add_to_cart",
    title: "Add to cart",
    description: "Add a product to the shopping cart by product id. Charged at checkout.",
    inputSchema: {
      type: "object",
      properties: { product_id: { type: "string", description: "Which product?" } },
      required: ["product_id"],
    },
  }),
  t({
    name: "review_cart",
    title: "Review cart",
    description: "Look at what is currently in the cart. Does not change anything.",
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  }),
  t({
    name: "empty_cart",
    title: "Empty cart",
    description: "Remove everything from the cart. This cannot be undone.",
  }),
];

/* ------------------------------------- Amber & Oak, apps/reservations */

export const RESERVATIONS: ToolDescriptor[] = [
  t({
    name: "find_times",
    title: "Find a table",
    origin: "https://tables.test",
    description:
      "Look up open tables on a given day for a given number of people. " +
      "Returns available slots with ids and times. Holds nothing.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Which day?" },
        party_size: { type: "integer", enum: [1, 2, 3, 4], description: "How many people?" },
      },
      required: ["date", "party_size"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  }),
  t({
    name: "book_table",
    origin: "https://tables.test",
    description: "Hold a table under a booking. The restaurant confirms it immediately.",
    inputSchema: {
      type: "object",
      properties: {
        slot_id: { type: "string", description: "Which table?" },
        party_size: { type: "integer", enum: [1, 2, 3, 4], description: "How many people?" },
        outdoor_seating: { type: "boolean", description: "Sit outside?" },
        note: { type: "string", description: "Anything the kitchen should know?" },
      },
      required: ["slot_id", "party_size"],
    },
  }),
  t({
    name: "change_reservation",
    origin: "https://tables.test",
    description: "Move an existing booking to a different service time.",
    inputSchema: {
      type: "object",
      properties: {
        reservation_id: { type: "string", description: "Which reservation?" },
        slot_id: { type: "string", description: "Move it to when?" },
      },
      required: ["reservation_id", "slot_id"],
    },
  }),
];

/* ------------- Domains nobody here built a site for, to keep it honest */

export const OTHERS: ToolDescriptor[] = [
  t({
    name: "check_in",
    origin: "https://airline.test",
    description: "Check in for a booked flight and issue a boarding pass.",
    inputSchema: {
      type: "object",
      properties: { record_locator: { type: "string" } },
      required: ["record_locator"],
    },
  }),
  t({
    name: "flight_status",
    origin: "https://airline.test",
    description: "Look up whether a flight is on time. Changes nothing.",
    inputSchema: {
      type: "object",
      properties: { flight_number: { type: "string" } },
      required: ["flight_number"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  }),
  t({
    name: "list_messages",
    origin: "https://mail.test",
    description: "List recent messages in the inbox.",
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  }),
  t({
    name: "send_message",
    origin: "https://mail.test",
    description: "Send a message to somebody.",
    inputSchema: {
      type: "object",
      properties: { to: { type: "string" }, body: { type: "string" } },
      required: ["to", "body"],
    },
  }),
];

/** Everything at once, which is the case a shortlist actually exists for. */
export const ALL_TOOLS: ToolDescriptor[] = [...MARKET, ...RESERVATIONS, ...OTHERS];

/**
 * What a wearer might say, and which tool should be reachable afterwards.
 *
 * Written as things a person says out loud, not as paraphrases of the tool
 * names, because a corpus of paraphrases measures nothing: every ranker
 * scores those perfectly and the shortlist size would look free.
 */
export interface Labelled {
  intent: string;
  expect: string;
}

export const CORPUS: Labelled[] = [
  { intent: "find me some oat milk", expect: "search_products" },
  { intent: "do you have oranges", expect: "search_products" },
  { intent: "look for tomatoes", expect: "search_products" },
  { intent: "put the oat milk in my basket", expect: "add_to_cart" },
  { intent: "buy that one", expect: "add_to_cart" },
  { intent: "what have I got so far", expect: "review_cart" },
  { intent: "show me my cart", expect: "review_cart" },
  { intent: "start over, take it all out", expect: "empty_cart" },
  { intent: "clear the cart", expect: "empty_cart" },
  { intent: "is there a table free on friday", expect: "find_times" },
  { intent: "somewhere for four people tonight", expect: "find_times" },
  { intent: "book that one", expect: "book_table" },
  { intent: "hold the seven o clock", expect: "book_table" },
  { intent: "move my booking to eight", expect: "change_reservation" },
  { intent: "can I change my reservation", expect: "change_reservation" },
  { intent: "check me in for my flight", expect: "check_in" },
  { intent: "is my flight on time", expect: "flight_status" },
  { intent: "any new mail", expect: "list_messages" },
  { intent: "tell dana I am running late", expect: "send_message" },
];
