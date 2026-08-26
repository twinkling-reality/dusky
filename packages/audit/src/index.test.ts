import type { AuditEntry } from "@dusky/contracts";
import { describe, expect, it } from "vitest";
import {
  type AuditFs,
  FileAuditStore,
  MemoryAuditStore,
  TeeAuditStore,
  TRAIL_TTL_MS,
} from "./index.js";

const entry = (p: Partial<AuditEntry> = {}): AuditEntry => ({
  at: "2026-08-26T13:20:35.963Z",
  sessionId: "JNKCBX",
  kind: "invoke",
  ...p,
});

/**
 * An in-memory filesystem, so the store is tested without touching a disk.
 *
 * It carries modification times because that is what expiry is decided on, and
 * a clock the test moves by hand, because a sweep that could only be tested by
 * waiting a week would not be tested.
 */
function fakeFs() {
  const files = new Map<string, string>();
  const mtimes = new Map<string, number>();
  const dirs: string[] = [];
  let clock = 0;
  let failNext: Error | null = null;
  const fs: AuditFs = {
    async mkdir(dir) {
      dirs.push(dir);
      return undefined;
    },
    async appendFile(path, data) {
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      files.set(path, (files.get(path) ?? "") + data);
      mtimes.set(path, clock);
    },
    async readFile(path) {
      const v = files.get(path);
      if (v === undefined) throw new Error("ENOENT");
      return v;
    },
    async readdir(dir) {
      const prefix = `${dir}/`;
      return [...files.keys()]
        .filter((f) => f.startsWith(prefix))
        .map((f) => f.slice(prefix.length));
    },
    async stat(path) {
      const m = mtimes.get(path);
      if (m === undefined) throw new Error("ENOENT");
      return { mtimeMs: m };
    },
    async unlink(path) {
      files.delete(path);
      mtimes.delete(path);
    },
  };
  const place = (name: string, mtimeMs: number) => {
    files.set(`/var/data/audit/${name}`, "{}\n");
    mtimes.set(`/var/data/audit/${name}`, mtimeMs);
  };
  return {
    fs,
    files,
    dirs,
    mtimes,
    place,
    tick: (t: number) => {
      clock = t;
    },
    fail: (e: Error) => (failNext = e),
  };
}

describe("keeping a trail in memory", () => {
  it("keeps entries per session, in the order they happened", async () => {
    const s = new MemoryAuditStore();
    s.append(entry({ kind: "discover" }));
    s.append(entry({ kind: "gate", toolName: "add_to_cart" }));
    s.append(entry({ sessionId: "OTHER", kind: "invoke" }));

    const mine = await s.read("JNKCBX");
    expect(mine.map((e) => e.kind)).toEqual(["discover", "gate"]);
    expect(await s.read("OTHER")).toHaveLength(1);
  });

  it("stays bounded, because the key space is codes strangers can mint", async () => {
    const s = new MemoryAuditStore(3);
    for (let i = 0; i < 10; i += 1) s.append(entry({ detail: { i } }));
    const kept = await s.read("JNKCBX");
    expect(kept).toHaveLength(3);
    // The oldest are dropped, so the most recent story is the one that lasts.
    expect(kept[2]?.detail).toEqual({ i: 9 });
  });

  it("reads back only the kinds a diagnostics view asked for", async () => {
    const s = new MemoryAuditStore();
    s.append(entry({ kind: "plan" }));
    s.append(entry({ kind: "gate" }));
    s.append(entry({ kind: "result" }));
    const gates = await s.read("JNKCBX", { kinds: ["plan", "gate"] });
    expect(gates.map((e) => e.kind)).toEqual(["plan", "gate"]);
  });

  it("returns nothing for a session it never saw, rather than throwing", async () => {
    expect(await new MemoryAuditStore().read("NOBODY")).toEqual([]);
  });
});

describe("keeping a trail on disk", () => {
  it("appends one line per entry and reads them back", async () => {
    const { fs, files } = fakeFs();
    const s = new FileAuditStore({ dir: "/var/data/audit", fs });
    s.append(entry({ kind: "discover" }));
    s.append(entry({ kind: "invoke", toolName: "add_to_cart" }));
    await s.flush();

    const written = files.get("/var/data/audit/JNKCBX.jsonl") ?? "";
    expect(written.trim().split("\n")).toHaveLength(2);
    expect((await s.read("JNKCBX")).map((e) => e.kind)).toEqual(["discover", "invoke"]);
  });

  it("survives a line torn in half by a process dying mid-write", async () => {
    const { fs, files } = fakeFs();
    files.set(
      "/var/data/audit/JNKCBX.jsonl",
      `${JSON.stringify(entry({ kind: "gate" }))}\n{"at":"2026-08-2`,
    );
    const s = new FileAuditStore({ dir: "/var/data/audit", fs });
    // Everything before the tear is still true, which is why the format is
    // one JSON object per line rather than one JSON array per file.
    expect((await s.read("JNKCBX")).map((e) => e.kind)).toEqual(["gate"]);
  });

  /**
   * A pairing code becomes a filename and arrives from outside the process.
   * Anything that is not a code is refused rather than sanitised, because
   * sanitising invites an argument about whether the sanitiser is complete.
   */
  it("refuses to turn a hostile session id into a path", async () => {
    const { fs, files } = fakeFs();
    const s = new FileAuditStore({ dir: "/var/data/audit", fs });
    for (const id of ["../../etc/passwd", "a/b", "..", "with space", ""]) {
      s.append(entry({ sessionId: id }));
      expect(await s.read(id)).toEqual([]);
    }
    await s.flush();
    expect(files.size).toBe(0);
  });

  it("reports a failed write instead of taking the session down with it", async () => {
    const { fs } = fakeFs();
    const seen: Error[] = [];
    const s = new FileAuditStore({ dir: "/var/data/audit", fs, onError: (e) => seen.push(e) });
    fs.appendFile = async () => {
      throw new Error("EROFS: read-only file system");
    };
    // A wearer's next frame must never wait on a disk, so this cannot throw.
    expect(() => s.append(entry())).not.toThrow();
    await s.flush();
    expect(seen.map((e) => e.message)).toEqual(["EROFS: read-only file system"]);
  });
});

/**
 * Forgetting a trail once it is old enough.
 *
 * The trail is append-only and nothing may edit or delete an ENTRY, which is
 * what makes it worth reading. Expiring a whole session's file after a stated
 * window is a different act: it is retention policy applied uniformly by age,
 * not history being rewritten. The distinction matters because the alternative
 * is a directory that only ever grows, keyed on pairing codes anyone reaching
 * the relay can invent, which is the leak `Hub.sweep` already fixed in memory
 * and which the disk was still carrying.
 */
describe("forgetting a trail that is old enough", () => {
  const DAY = 24 * 60 * 60_000;
  const NOW = 100 * DAY;

  it("removes a trail nothing has touched for longer than the window", async () => {
    const { fs, place, files } = fakeFs();
    place("JNKCBX.jsonl", NOW - 30 * DAY);
    place("FRESHR.jsonl", NOW - 1 * DAY);
    const s = new FileAuditStore({ dir: "/var/data/audit", fs });

    expect(await s.sweep(NOW, 7 * DAY)).toBe(1);
    expect([...files.keys()]).toEqual(["/var/data/audit/FRESHR.jsonl"]);
  });

  it("keeps everything when nothing has aged out", async () => {
    const { fs, place, files } = fakeFs();
    place("JNKCBX.jsonl", NOW - 6 * DAY);
    const s = new FileAuditStore({ dir: "/var/data/audit", fs });

    expect(await s.sweep(NOW, 7 * DAY)).toBe(0);
    expect(files.size).toBe(1);
  });

  /**
   * Codes are six letters and get reused, in this repository constantly. A
   * sweep that read the directory outside the write queue could stat a file
   * last touched a month ago, have a new session under the same code append to
   * it, and then unlink a trail that is seconds old.
   */
  it("does not delete a trail a session has just started writing again", async () => {
    const { fs, place, files, tick } = fakeFs();
    place("JNKCBX.jsonl", NOW - 30 * DAY);
    const s = new FileAuditStore({ dir: "/var/data/audit", fs });

    // Queued, deliberately not awaited: this is the race.
    tick(NOW);
    s.append(entry({ kind: "discover" }));

    expect(await s.sweep(NOW, 7 * DAY)).toBe(0);
    expect(files.has("/var/data/audit/JNKCBX.jsonl")).toBe(true);
  });

  /**
   * The directory is a mounted volume that may hold things this store did not
   * write. Only the exact shape it produces is a candidate, which is the same
   * rule `path` applies on the way in.
   */
  it("never removes a file it did not write", async () => {
    const { fs, place, files } = fakeFs();
    for (const name of [
      "README.md",
      "notes.txt",
      "jnkcbx.jsonl",
      "JNKCBX.jsonl.bak",
      "with space.jsonl",
      ".jsonl",
    ]) {
      place(name, NOW - 90 * DAY);
    }
    place("JNKCBX.jsonl", NOW - 90 * DAY);
    const s = new FileAuditStore({ dir: "/var/data/audit", fs });

    expect(await s.sweep(NOW, 7 * DAY)).toBe(1);
    expect([...files.keys()].map((f) => f.replace("/var/data/audit/", "")).sort()).toEqual([
      ".jsonl",
      "JNKCBX.jsonl.bak",
      "README.md",
      "jnkcbx.jsonl",
      "notes.txt",
      "with space.jsonl",
    ]);
  });

  it("reports a disk it cannot sweep instead of throwing at the relay", async () => {
    const { fs, place, files } = fakeFs();
    place("JNKCBX.jsonl", NOW - 30 * DAY);
    const seen: Error[] = [];
    const s = new FileAuditStore({ dir: "/var/data/audit", fs, onError: (e) => seen.push(e) });
    fs.unlink = async () => {
      throw new Error("EACCES: permission denied");
    };

    // A relay must survive a disk it cannot write to, the same way `append`
    // does. Nothing here is worth ending a session over.
    await expect(s.sweep(NOW, 7 * DAY)).resolves.toBe(0);
    expect(seen.map((e) => e.message)).toEqual(["EACCES: permission denied"]);
    expect(files.size).toBe(1);
  });

  it("has a default window, so a caller cannot forget to state one", async () => {
    const { fs, place, files } = fakeFs();
    place("OLDONE.jsonl", NOW - 400 * DAY);
    place("RECENT.jsonl", NOW - 1 * DAY);
    const s = new FileAuditStore({ dir: "/var/data/audit", fs });

    expect(TRAIL_TTL_MS).toBeGreaterThan(DAY);
    expect(await s.sweep(NOW)).toBe(1);
    expect(files.has("/var/data/audit/RECENT.jsonl")).toBe(true);
  });
});

describe("writing to both", () => {
  it("prefers the durable copy and falls back to memory", async () => {
    const { fs } = fakeFs();
    const memory = new MemoryAuditStore();
    const file = new FileAuditStore({ dir: "/var/data/audit", fs });
    const tee = new TeeAuditStore(memory, file);

    tee.append(entry({ kind: "discover" }));
    await tee.flush();
    expect((await tee.read("JNKCBX")).map((e) => e.kind)).toEqual(["discover"]);

    // A disk that is gone must not lose the running session's trail.
    const broken = new TeeAuditStore(memory, {
      append: () => {},
      read: async () => {
        throw new Error("disk vanished");
      },
    });
    expect((await broken.read("JNKCBX")).map((e) => e.kind)).toEqual(["discover"]);
  });
});
