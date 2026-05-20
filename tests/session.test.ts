import { describe, expect, it } from "vitest";
import {
  buildMintPayload,
  SessionTracker,
  type ChangeAtom,
  type SessionSnapshot,
} from "../src/session";

function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const ins = (n: number): ChangeAtom => ({ insertedLength: n, removedLength: 0 });
const del = (n: number): ChangeAtom => ({ insertedLength: 0, removedLength: n });
const rep = (i: number, r: number): ChangeAtom => ({ insertedLength: i, removedLength: r });

describe("SessionTracker", () => {
  describe("onChange", () => {
    it("ignores an empty atom batch entirely (no session created)", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", []);
      expect(t.hasSession("a.md")).toBe(false);
    });

    it("creates a fresh session on the first change", () => {
      const clock = fakeClock(1000);
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(3)]);
      const snap = t.peek("a.md")!;
      expect(snap.startedAt).toBe(1000);
      expect(snap.endedAt).toBe(1000);
      expect(snap.activeMs).toBe(0);
      expect(snap.events).toEqual([{ t: 0, k: "ins", n: 3 }]);
    });

    it("records event timestamps relative to startedAt", () => {
      const clock = fakeClock(500);
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(1)]);
      clock.advance(120);
      t.onChange("a.md", [ins(2)]);
      clock.advance(80);
      t.onChange("a.md", [del(1)]);
      const snap = t.peek("a.md")!;
      expect(snap.startedAt).toBe(500);
      expect(snap.events).toEqual([
        { t: 0, k: "ins", n: 1 },
        { t: 120, k: "ins", n: 2 },
        { t: 200, k: "del", n: 1 },
      ]);
    });

    it("accumulates activeMs for gaps within the threshold", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(1)]);
      clock.advance(1500);
      t.onChange("a.md", [ins(1)]);
      clock.advance(3000);
      t.onChange("a.md", [ins(1)]);
      expect(t.peek("a.md")!.activeMs).toBe(4500);
    });

    it("discards activeMs for gaps over the threshold (walked-away)", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(1)]);
      clock.advance(1000);
      t.onChange("a.md", [ins(1)]);
      clock.advance(60_000); // long pause
      t.onChange("a.md", [ins(1)]);
      clock.advance(2000);
      t.onChange("a.md", [ins(1)]);
      expect(t.peek("a.md")!.activeMs).toBe(3000); // 1000 + 2000
    });

    it("handles a gap exactly at the threshold (inclusive)", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(1)]);
      clock.advance(5000);
      t.onChange("a.md", [ins(1)]);
      expect(t.peek("a.md")!.activeMs).toBe(5000);
    });

    it("does not accumulate activeMs when clock has not advanced", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(1)]);
      t.onChange("a.md", [ins(1)]); // same tick
      expect(t.peek("a.md")!.activeMs).toBe(0);
    });

    it("classifies pure insert, pure delete, and replace", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(2), del(1), rep(4, 3)]);
      const events = t.peek("a.md")!.events;
      expect(events).toEqual([
        { t: 0, k: "ins", n: 2 },
        { t: 0, k: "del", n: 1 },
        { t: 0, k: "rep", n: 4 }, // rep uses insertedLength
      ]);
    });

    it("skips no-op atoms (0 inserted and 0 removed) without breaking the session", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [{ insertedLength: 0, removedLength: 0 }, ins(2)]);
      const events = t.peek("a.md")!.events;
      expect(events).toEqual([{ t: 0, k: "ins", n: 2 }]);
    });

    it("isolates sessions per file path", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(1)]);
      clock.advance(100);
      t.onChange("b.md", [ins(2)]);
      expect(t.peek("a.md")!.events).toEqual([{ t: 0, k: "ins", n: 1 }]);
      const b = t.peek("b.md")!;
      expect(b.startedAt).toBe(1_000_100);
      expect(b.events).toEqual([{ t: 0, k: "ins", n: 2 }]);
    });
  });

  describe("setActiveThreshold", () => {
    it("changes the threshold for subsequent gap calculations", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 1000, now: clock.now });
      t.onChange("a.md", [ins(1)]);
      clock.advance(2000);
      t.onChange("a.md", [ins(1)]); // 2000 > 1000 → dropped
      expect(t.peek("a.md")!.activeMs).toBe(0);

      t.setActiveThreshold(10_000);
      clock.advance(2000);
      t.onChange("a.md", [ins(1)]); // 2000 <= 10000 → counted
      expect(t.peek("a.md")!.activeMs).toBe(2000);
    });
  });

  describe("peek / finalize / reset", () => {
    it("peek returns a snapshot copy without clearing", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(1)]);
      const first = t.peek("a.md")!;
      first.events.push({ t: 9999, k: "ins", n: 9 }); // mutate the copy
      const second = t.peek("a.md")!;
      expect(second.events).toEqual([{ t: 0, k: "ins", n: 1 }]);
      expect(t.hasSession("a.md")).toBe(true);
    });

    it("peek returns null for unknown files", () => {
      const t = new SessionTracker({ activeThresholdMs: 5000 });
      expect(t.peek("nope.md")).toBeNull();
    });

    it("finalize returns the snapshot and clears the session", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(1)]);
      const snap = t.finalize("a.md")!;
      expect(snap.events).toEqual([{ t: 0, k: "ins", n: 1 }]);
      expect(t.hasSession("a.md")).toBe(false);
      expect(t.peek("a.md")).toBeNull();
    });

    it("finalize returns null for unknown files", () => {
      const t = new SessionTracker({ activeThresholdMs: 5000 });
      expect(t.finalize("nope.md")).toBeNull();
    });

    it("reset clears the session without returning it", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(1)]);
      t.reset("a.md");
      expect(t.hasSession("a.md")).toBe(false);
    });

    it("reset on a missing file is a no-op", () => {
      const t = new SessionTracker({ activeThresholdMs: 5000 });
      expect(() => t.reset("nope.md")).not.toThrow();
    });
  });

  describe("rename", () => {
    it("moves an in-memory session to the new path", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("old.md", [ins(2)]);
      t.rename("old.md", "new.md");
      expect(t.hasSession("old.md")).toBe(false);
      expect(t.peek("new.md")!.events).toEqual([{ t: 0, k: "ins", n: 2 }]);
    });

    it("is a no-op when source and destination are equal", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("a.md", [ins(2)]);
      t.rename("a.md", "a.md");
      expect(t.peek("a.md")!.events).toEqual([{ t: 0, k: "ins", n: 2 }]);
    });

    it("is a no-op when source has no session", () => {
      const t = new SessionTracker({ activeThresholdMs: 5000 });
      t.rename("missing.md", "dest.md");
      expect(t.hasSession("dest.md")).toBe(false);
    });

    it("keeps the existing destination buffer when both paths have sessions", () => {
      const clock = fakeClock();
      const t = new SessionTracker({ activeThresholdMs: 5000, now: clock.now });
      t.onChange("old.md", [ins(1)]);
      clock.advance(50);
      t.onChange("new.md", [ins(7)]);
      t.rename("old.md", "new.md");
      expect(t.hasSession("old.md")).toBe(false);
      // Destination buffer (7) wins — losing already-captured keystrokes there
      // would be worse than losing the source.
      expect(t.peek("new.md")!.events).toEqual([{ t: 0, k: "ins", n: 7 }]);
    });
  });

  describe("default clock", () => {
    it("uses Date.now when no clock is supplied", () => {
      const before = Date.now();
      const t = new SessionTracker({ activeThresholdMs: 5000 });
      t.onChange("a.md", [ins(1)]);
      const after = Date.now();
      const snap = t.peek("a.md")!;
      expect(snap.startedAt).toBeGreaterThanOrEqual(before);
      expect(snap.startedAt).toBeLessThanOrEqual(after);
    });
  });
});

describe("buildMintPayload", () => {
  it("composes a mint payload from a snapshot and metadata", () => {
    const snap: SessionSnapshot = {
      startedAt: 100,
      endedAt: 200,
      activeMs: 90,
      events: [{ t: 0, k: "ins", n: 1 }],
    };
    const payload = buildMintPayload(snap, {
      docId: "doc-1",
      content: "hello",
      client: { name: "semoi-obsidian", version: "0.1.0" },
    });
    expect(payload).toEqual({
      docId: "doc-1",
      startedAt: 100,
      endedAt: 200,
      activeMs: 90,
      events: [{ t: 0, k: "ins", n: 1 }],
      content: "hello",
      client: { name: "semoi-obsidian", version: "0.1.0" },
    });
  });

  it("passes the events array through by reference (no defensive copy here)", () => {
    const events = [{ t: 0, k: "ins" as const, n: 1 }];
    const snap: SessionSnapshot = { startedAt: 0, endedAt: 0, activeMs: 0, events };
    const payload = buildMintPayload(snap, {
      docId: "d",
      content: "",
      client: { name: "c", version: "1" },
    });
    expect(payload.events).toBe(events);
  });
});
