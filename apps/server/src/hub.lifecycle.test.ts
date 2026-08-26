import { describe, expect, it } from "vitest";
import { Hub } from "./hub.js";

/**
 * The relay is a long-running process and a pairing code is something a
 * stranger can invent. Both of those are true at once, which is what makes
 * session lifecycle a real concern rather than housekeeping.
 */

class FakeSocket {
  readyState = 1;
  readonly sent: string[] = [];
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
  }
}
describe("session lifecycle", () => {
  const MINUTE = 60_000;

  it("forgets a session nothing is connected to", () => {
    const hub = new Hub(undefined, undefined, () => 0);
    hub.get("ABCDEF", "Shop");
    expect(hub.list()).toEqual(["ABCDEF"]);

    // Same instant: far too early to forget anything.
    expect(hub.sweep(0)).toBe(0);
    expect(hub.list()).toEqual(["ABCDEF"]);

    expect(hub.sweep(60 * MINUTE)).toBe(1);
    expect(hub.list(), "an idle session was kept forever").toEqual([]);
  });

  it("never forgets a session somebody is still wearing", () => {
    const hub = new Hub(undefined, undefined, () => 0);
    const actor = hub.get("ABCDEF", "Shop");
    actor.attachDisplay(new FakeSocket() as never);

    expect(hub.sweep(60 * MINUTE), "dropped a session with a live display").toBe(0);
    expect(hub.list()).toEqual(["ABCDEF"]);
  });

  it("forgets it once the glasses go away", () => {
    const hub = new Hub(undefined, undefined, () => 0);
    const actor = hub.get("ABCDEF", "Shop");
    const sock = new FakeSocket();
    actor.attachDisplay(sock as never);
    actor.detachDisplay(sock as never);

    expect(hub.sweep(60 * MINUTE)).toBe(1);
  });

  it("keeps a session alive while it is being used, even with no socket", () => {
    const hub = new Hub(undefined, undefined, () => 0);
    const actor = hub.get("ABCDEF", "Shop");
    actor.touch(59 * MINUTE);
    expect(hub.sweep(60 * MINUTE), "activity did not hold the session open").toBe(0);
  });
});
