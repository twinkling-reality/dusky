/**
 * What Amber & Oak has to sell, which is time in a room.
 *
 * The shape here is deliberately unlike a product catalog. There is no price,
 * no sku and no cart, because the point of this service is to be a site whose
 * vocabulary Dusky has never met.
 */

export type DayKey = "today" | "tomorrow" | "this weekend";

/** The days the book will take. Mirrored by find_times' `date` enum. */
export const DAYS: readonly DayKey[] = ["today", "tomorrow", "this weekend"];

/** Every service the room runs. Mirrored by change_reservation's `new_time`. */
export const TIMES = ["6:00 PM", "7:30 PM", "9:00 PM"] as const;

/** The largest table in the room, which is what bounds the party_size enum. */
export const MAX_PARTY = 4;

export interface Slot {
  /** Opaque, and the only field a wearer should never have to read out loud. */
  id: string;
  /** What a human calls this slot. */
  name: string;
  day: DayKey;
  seats: number;
}

export const SLOTS: readonly Slot[] = [
  { id: "ao-t-1800", name: "6:00 PM", day: "today", seats: 2 },
  { id: "ao-t-2100", name: "9:00 PM", day: "today", seats: 4 },
  { id: "ao-m-1800", name: "6:00 PM", day: "tomorrow", seats: 4 },
  { id: "ao-m-1930", name: "7:30 PM", day: "tomorrow", seats: 2 },
  { id: "ao-m-2100", name: "9:00 PM", day: "tomorrow", seats: 4 },
  { id: "ao-w-1800", name: "6:00 PM", day: "this weekend", seats: 4 },
  { id: "ao-w-1930", name: "7:30 PM", day: "this weekend", seats: 4 },
];

export interface Reservation {
  id: string;
  slot_id: string;
  day: DayKey;
  time: string;
  party_size: number;
  outdoor: boolean;
  note?: string;
}

/**
 * A booking reference, which a human reads off a lens and types back in when
 * they want to change it.
 *
 * A fixed letter prefix followed by digits only, so there is no character
 * position where a letter and a digit could be confused for each other. The
 * pairing code reached the same place from the opposite direction by dropping
 * digits entirely; see the note in apps/display/src/App.tsx.
 */
export function reference(n: number): string {
  return `AO-${String(4416 + n).padStart(4, "0")}`;
}
