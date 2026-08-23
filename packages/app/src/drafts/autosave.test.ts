import { describe, expect, test } from "vitest";
import { MockDraftsSource } from "./mock-source";
import { DraftVersionConflictError } from "./source";

/**
 * The scratchpad editor coalesces keystrokes behind one in-flight save. This
 * pins the reason it has to: firing a write per keystroke races the
 * optimistic-concurrency check, and every write after the first carries a stale
 * base version, so characters are dropped rather than saved.
 */

type WriteOutcome = "ok" | "conflict" | "other";

async function attemptWrite(input: {
  source: MockDraftsSource;
  artifactId: string;
  baseVersion: number;
  body: string;
}): Promise<WriteOutcome> {
  try {
    await input.source.update({
      artifactId: input.artifactId,
      baseVersion: input.baseVersion,
      body: input.body,
    });
    return "ok";
  } catch (error) {
    return error instanceof DraftVersionConflictError ? "conflict" : "other";
  }
}

/**
 * Mirrors the editor's debounce: a pause earns a write, a keystroke does not.
 * `version` is the optimistic-concurrency token, so one write per character
 * makes it climb by hundreds while typing a paragraph.
 */
function debouncingWriter(
  source: MockDraftsSource,
  artifactId: string,
  startVersion: number,
  quietMs: number,
) {
  let version = startVersion;
  let latest: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const write = async () => {
    if (latest === null) return;
    const body = latest;
    latest = null;
    const saved = await source.update({ artifactId, baseVersion: version, body });
    version = saved.version;
  };

  return {
    type(next: string) {
      latest = next;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        chain = chain.then(write);
      }, quietMs);
    },
    async settle() {
      await new Promise((resolve) => setTimeout(resolve, quietMs * 3));
      await chain;
    },
  };
}

/** Mirrors the editor: newest text wins, one write in flight, version carried forward. */
function coalescingWriter(source: MockDraftsSource, artifactId: string, startVersion: number) {
  let version = startVersion;
  let latest: string | null = null;
  let chain: Promise<void> = Promise.resolve();

  const write = async () => {
    if (latest === null) return;
    const body = latest;
    latest = null;
    const saved = await source.update({ artifactId, baseVersion: version, body });
    version = saved.version;
  };

  return {
    type(next: string): Promise<void> {
      latest = next;
      chain = chain.then(write);
      return chain;
    },
    settle(): Promise<void> {
      return chain;
    },
  };
}

describe("autosave under rapid typing", () => {
  test("writing once per keystroke without coalescing loses characters", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();

    // Started together on purpose: that concurrency is what the race needs.
    const results = await Promise.all(
      ["a", "ab", "abc", "abcd"].map((body) =>
        attemptWrite({ source, artifactId: created.id, baseVersion: created.version, body }),
      ),
    );

    // Only the first write matches the base version; the rest are refused, and a
    // UI that swallowed those rejections would have silently dropped the text.
    expect(results.filter((entry) => entry === "ok")).toHaveLength(1);
    expect(results.filter((entry) => entry === "conflict")).toHaveLength(3);
    expect((await source.get(created.id))?.body).toBe("a");
  });

  test("coalescing behind one in-flight save keeps the final text", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();
    const writer = coalescingWriter(source, created.id, created.version);

    void writer.type("下");
    void writer.type("下一");
    void writer.type("下一阶");
    void writer.type("下一阶段");
    await writer.settle();

    expect((await source.get(created.id))?.body).toBe("下一阶段");
  });

  test("coalescing collapses intermediate keystrokes instead of writing each one", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();
    const writer = coalescingWriter(source, created.id, created.version);

    for (const body of ["a", "ab", "abc", "abcd", "abcde"]) void writer.type(body);
    await writer.settle();

    const saved = await source.get(created.id);
    expect(saved?.body).toBe("abcde");
    // Five keystrokes, fewer writes: the first goes out immediately and the rest
    // collapse into follow-ups that each carry the newest text at the time.
    expect(saved?.version).toBeLessThan(created.version + 5);
  });

  test("typing a word bumps the version once, not once per character", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();
    const writer = debouncingWriter(source, created.id, created.version, 20);

    for (const body of ["i", "in", "inc", "incr", "increm", "increment"]) writer.type(body);
    await writer.settle();

    const saved = await source.get(created.id);
    expect(saved?.body).toBe("increment");
    // Nine keystrokes, one pause, one write.
    expect(saved?.version).toBe(created.version + 1);
  });

  test("a pause between words earns a second write", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();
    const writer = debouncingWriter(source, created.id, created.version, 20);

    writer.type("first");
    await writer.settle();
    writer.type("first second");
    await writer.settle();

    const saved = await source.get(created.id);
    expect(saved?.body).toBe("first second");
    expect(saved?.version).toBe(created.version + 2);
  });

  test("a conflict from another client is surfaced, not swallowed", async () => {
    const source = new MockDraftsSource();
    const created = await source.create();

    // Somebody else advances the draft while this editor still holds the old version.
    await source.update({ artifactId: created.id, baseVersion: created.version, body: "theirs" });

    await expect(
      source.update({ artifactId: created.id, baseVersion: created.version, body: "mine" }),
    ).rejects.toBeInstanceOf(DraftVersionConflictError);
    expect((await source.get(created.id))?.body).toBe("theirs");
  });
});
