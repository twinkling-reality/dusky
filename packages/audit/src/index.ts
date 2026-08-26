/**
 * Where the audit trail lives.
 *
 * The trail is a product feature, not plumbing. It is how a wearer answers
 * "what did it actually do" after the fact, and how anyone checks that the
 * claim "the model proposes, code disposes" is true rather than merely
 * asserted: a refusal is a recorded event here, not a silent `null`.
 *
 * It used to be an array on `SessionActor`, which meant it lasted exactly as
 * long as the process. A deploy erased the record of what someone had just
 * done, which was discovered by deploying seconds after a real purchase on
 * real glasses and losing the evidence of it.
 *
 * `AuditStore` is the seam. `MemoryAuditStore` is the default and behaves like
 * the old array. `FileAuditStore` appends to JSON Lines and survives a
 * restart wherever its directory does. A database implementation would be a
 * third file and no change anywhere else.
 */

import type { AuditEntry } from "@dusky/contracts";

export interface AuditQuery {
  /** Most recent first. Defaults to everything the store kept. */
  limit?: number;
  /** Only these kinds, for a diagnostics view that wants one story. */
  kinds?: AuditEntry["kind"][];
}

/**
 * Append only, by design. Nothing in Dusky may edit or delete an entry,
 * because a trail that can be rewritten answers no question worth asking.
 *
 * `append` is synchronous from the caller's point of view. A session must
 * never wait on storage to show a wearer their next frame, so an
 * implementation that does I/O buffers it and reports failure out of band.
 */
export interface AuditStore {
  append(entry: AuditEntry): void;
  read(sessionId: string, query?: AuditQuery): Promise<AuditEntry[]>;
  /** Flush anything buffered. Called on shutdown, and by tests. */
  flush?(): Promise<void>;
}

function match(entry: AuditEntry, query: AuditQuery | undefined): boolean {
  if (!query?.kinds?.length) return true;
  return query.kinds.includes(entry.kind);
}

function tail(entries: AuditEntry[], query: AuditQuery | undefined): AuditEntry[] {
  const kept = entries.filter((e) => match(e, query));
  const limit = query?.limit;
  return limit && limit > 0 && kept.length > limit ? kept.slice(kept.length - limit) : kept;
}

/**
 * The default. Bounded per session, because the key space is pairing codes
 * and an unbounded map keyed on anything a stranger can create is a memory
 * leak with extra steps.
 */
export class MemoryAuditStore implements AuditStore {
  private readonly bySession = new Map<string, AuditEntry[]>();

  constructor(
    private readonly perSession = 500,
    private readonly maxSessions = 1000,
  ) {}

  append(entry: AuditEntry): void {
    let list = this.bySession.get(entry.sessionId);
    if (!list) {
      list = [];
      this.bySession.set(entry.sessionId, list);
      if (this.bySession.size > this.maxSessions) {
        const oldest = this.bySession.keys().next();
        if (!oldest.done && oldest.value !== entry.sessionId) this.bySession.delete(oldest.value);
      }
    }
    list.push(entry);
    if (list.length > this.perSession) list.shift();
  }

  async read(sessionId: string, query?: AuditQuery): Promise<AuditEntry[]> {
    return tail(this.bySession.get(sessionId) ?? [], query);
  }
}

/* ------------------------------------------------------------------ files */

/** The filesystem calls this store needs, so it can be tested without one. */
export interface AuditFs {
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>;
  appendFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  // Expiry only. `mtimeMs` is the whole of what a `Stats` is consulted for,
  // so `node:fs/promises` satisfies this without an adapter.
  readdir(dir: string): Promise<string[]>;
  stat(path: string): Promise<{ mtimeMs: number }>;
  unlink(path: string): Promise<void>;
}

/** The shape a pairing code has, and therefore the shape a trail file has. */
const CODE = /^[A-Z0-9]{1,32}$/;
const SUFFIX = ".jsonl";

/**
 * How long a trail outlives the session that wrote it.
 *
 * The question this answers is "what did it actually do", and that gets asked
 * within days of the thing happening, not within months. A week outlives a
 * demo, a weekend and a judging pass, which is the longest anyone here has
 * needed to look back.
 *
 * It is deliberately much longer than `IDLE_TTL_MS` on the Hub. A live session
 * being forgotten and its record being forgotten are different events, and the
 * whole reason the trail is on a disk is that the second must come long after
 * the first.
 */
export const TRAIL_TTL_MS = 7 * 24 * 60 * 60_000;

export interface FileAuditStoreOptions {
  dir: string;
  fs: AuditFs;
  /** Reported rather than thrown: a wearer's frame must not wait on a disk. */
  onError?: (err: Error) => void;
}

/**
 * One JSON Lines file per session, appended to and never rewritten.
 *
 * JSONL because the format is append-only by nature, survives a process dying
 * mid-write with at most one truncated line, and can be read by anything.
 *
 * Writes are queued so `append` returns immediately and entries land in the
 * order they happened. Durability across a DEPLOY, as opposed to a crash,
 * depends on the directory outliving the container; see DEPLOY.md.
 */
export class FileAuditStore implements AuditStore {
  private queue: Promise<void> = Promise.resolve();
  private ready: Promise<unknown> | null = null;

  constructor(private readonly o: FileAuditStoreOptions) {}

  /**
   * Pairing codes become filenames, and they arrive from outside, so nothing
   * but the characters a code can legitimately contain is allowed through.
   */
  private path(sessionId: string): string | null {
    if (!CODE.test(sessionId)) return null;
    return `${this.o.dir}/${sessionId}${SUFFIX}`;
  }

  append(entry: AuditEntry): void {
    const file = this.path(entry.sessionId);
    if (!file) return;
    this.ready ??= this.o.fs.mkdir(this.o.dir, { recursive: true });
    this.queue = this.queue
      .then(() => this.ready)
      .then(() => this.o.fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8"))
      .catch((err: unknown) => {
        // Losing an audit line must never take a wearer's session with it.
        this.o.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
  }

  async read(sessionId: string, query?: AuditQuery): Promise<AuditEntry[]> {
    const file = this.path(sessionId);
    if (!file) return [];
    await this.flush();
    let raw: string;
    try {
      raw = await this.o.fs.readFile(file, "utf8");
    } catch {
      return [];
    }
    const entries: AuditEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // A torn final line from a process that died mid-write. Everything
        // before it is still true, which is the point of the format.
      }
    }
    return tail(entries, query);
  }

  /**
   * Forget the trails of sessions nobody has touched for `olderThanMs`.
   *
   * Nothing in Dusky may edit or delete an ENTRY, and this does not: it
   * expires whole session files, uniformly, by age, under a policy stated in
   * one place. That is retention rather than revision. Without it the
   * directory only ever grows, and its key space is pairing codes, which
   * anyone who can reach the relay can invent. `Hub.sweep` fixed exactly this
   * shape of leak in memory and wrote the rule down; the disk was still
   * carrying one.
   *
   * Two things are load-bearing.
   *
   * It runs THROUGH the write queue rather than beside it. Codes are six
   * letters and get reused, so a sweep reading the directory independently
   * could stat a file last written a month ago, have a new session under that
   * same code append to it, and then unlink a trail seconds old.
   *
   * It considers only names of the exact shape this store writes, which is the
   * same check `path` makes on the way in. The directory is a mounted volume
   * and may hold things Dusky did not put there.
   *
   * Failure is reported, never thrown. A relay that cannot tidy its disk is
   * still a relay; nothing here is worth ending a session over.
   */
  async sweep(at: number = Date.now(), olderThanMs: number = TRAIL_TTL_MS): Promise<number> {
    let removed = 0;
    this.queue = this.queue
      .then(() => (this.ready ??= this.o.fs.mkdir(this.o.dir, { recursive: true })))
      .then(async () => {
        for (const name of await this.o.fs.readdir(this.o.dir)) {
          if (!name.endsWith(SUFFIX)) continue;
          if (!CODE.test(name.slice(0, -SUFFIX.length))) continue;
          const file = `${this.o.dir}/${name}`;
          try {
            const { mtimeMs } = await this.o.fs.stat(file);
            if (at - mtimeMs < olderThanMs) continue;
            await this.o.fs.unlink(file);
            removed += 1;
          } catch (err: unknown) {
            // One unreadable file must not stop the rest being reclaimed.
            this.o.onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        }
      })
      .catch((err: unknown) => {
        this.o.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    await this.queue;
    return removed;
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}

/**
 * Writes to both, reads from the durable one, falling back to memory.
 *
 * This is what a relay actually wants: reads stay instant and survive a
 * disk that is slow, missing or read-only, while the file is what survives
 * the process. Neither store can make the other fail.
 */
export class TeeAuditStore implements AuditStore {
  constructor(
    private readonly memory: AuditStore,
    private readonly durable: AuditStore,
  ) {}

  append(entry: AuditEntry): void {
    this.memory.append(entry);
    this.durable.append(entry);
  }

  async read(sessionId: string, query?: AuditQuery): Promise<AuditEntry[]> {
    const durable = await this.durable.read(sessionId, query).catch(() => []);
    if (durable.length > 0) return durable;
    return this.memory.read(sessionId, query);
  }

  async flush(): Promise<void> {
    await this.durable.flush?.();
  }
}
