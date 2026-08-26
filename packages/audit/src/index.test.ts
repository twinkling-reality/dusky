import type { AuditEntry } from "@dusky/contracts";
import { describe, expect, it } from "vitest";
import { type AuditFs, FileAuditStore, MemoryAuditStore, TeeAuditStore } from "./index.js";

const entry = (p: Partial<AuditEntry> = {}): AuditEntry => ({
  at: "2026-08-26T13:20:35.963Z",
  sessionId: "JNKCBX",
  kind: "invoke",
  ...p,
});

/** An in-memory filesystem, so the store is tested without touching a disk. */
function fakeFs() {
  const files = new Map<string, string>();
  const dirs: string[] = [];
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
    },
    async readFile(path) {
      const v = files.get(path);
      if (v === undefined) throw new Error("ENOENT");
      return v;
    },
  };
  return { fs, files, dirs, fail: (e: Error) => (failNext = e) };
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
