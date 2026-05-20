// Framework-independent session/event recording. Kept free of Obsidian and CodeMirror
// imports so it can be unit-tested in isolation.

export type KeystrokeKind = "ins" | "del" | "rep";

export interface KeystrokeEvent {
  t: number; // ms relative to startedAt — matches backend hashEventStream canonical form
  k: KeystrokeKind;
  n: number;
}

export interface ChangeAtom {
  insertedLength: number;
  removedLength: number;
}

export interface SessionSnapshot {
  startedAt: number;
  endedAt: number;
  activeMs: number;
  events: KeystrokeEvent[];
}

export interface MintPayload {
  docId: string;
  startedAt: number;
  endedAt: number;
  activeMs: number;
  events: KeystrokeEvent[];
  content: string;
  client: { name: string; version: string };
}

interface SessionState {
  startedAt: number;
  lastEventAt: number;
  activeMs: number;
  events: KeystrokeEvent[];
}

export interface SessionTrackerOptions {
  activeThresholdMs: number;
  now?: () => number;
}

/**
 * Per-file keystroke buffer. A session is never rolled over by idleness — it
 * lives until the caller mints or resets. To distinguish wall-clock duration
 * from real typing duration, gaps between keystrokes below `activeThresholdMs`
 * accrue to `activeMs`; longer gaps are treated as the writer stepping away
 * and contribute nothing.
 */
export class SessionTracker {
  private sessions = new Map<string, SessionState>();
  private activeThresholdMs: number;
  private now: () => number;

  constructor(opts: SessionTrackerOptions) {
    this.activeThresholdMs = opts.activeThresholdMs;
    this.now = opts.now ?? (() => Date.now());
  }

  setActiveThreshold(ms: number): void {
    this.activeThresholdMs = ms;
  }

  /** Record a batch of change atoms for a file. */
  onChange(filePath: string, atoms: ChangeAtom[]): void {
    if (atoms.length === 0) return;

    const now = this.now();
    let state = this.sessions.get(filePath);

    if (!state) {
      state = { startedAt: now, lastEventAt: now, activeMs: 0, events: [] };
      this.sessions.set(filePath, state);
    } else {
      const gap = now - state.lastEventAt;
      if (gap > 0 && gap <= this.activeThresholdMs) {
        state.activeMs += gap;
      }
    }

    for (const atom of atoms) {
      const k = classify(atom);
      if (k === null) continue;
      const n = k === "del" ? atom.removedLength : atom.insertedLength;
      if (n <= 0) continue;
      state.events.push({ t: now - state.startedAt, k, n });
    }
    state.lastEventAt = now;
  }

  hasSession(filePath: string): boolean {
    return this.sessions.has(filePath);
  }

  /** Pull current session without clearing it. */
  peek(filePath: string): SessionSnapshot | null {
    const s = this.sessions.get(filePath);
    return s ? this.snapshotOf(s) : null;
  }

  /** Finalize and clear the active session for a file. */
  finalize(filePath: string): SessionSnapshot | null {
    const s = this.sessions.get(filePath);
    if (!s) return null;
    this.sessions.delete(filePath);
    return this.snapshotOf(s);
  }

  /** Discard any in-memory keystroke buffer for a file. */
  reset(filePath: string): void {
    this.sessions.delete(filePath);
  }

  /** Discard every in-memory session buffer. Used by plugin unload. */
  clearAll(): void {
    this.sessions.clear();
  }

  /** Move an in-memory session across paths (e.g. when the file is renamed). */
  rename(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    const state = this.sessions.get(oldPath);
    if (!state) return;
    this.sessions.delete(oldPath);
    // If something already exists at the destination, the existing buffer wins —
    // dropping it would silently discard captured keystrokes.
    if (!this.sessions.has(newPath)) {
      this.sessions.set(newPath, state);
    }
  }

  private snapshotOf(state: SessionState): SessionSnapshot {
    return {
      startedAt: state.startedAt,
      endedAt: state.lastEventAt,
      activeMs: state.activeMs,
      events: state.events.slice(),
    };
  }
}

function classify(atom: ChangeAtom): KeystrokeKind | null {
  const ins = atom.insertedLength > 0;
  const del = atom.removedLength > 0;
  if (ins && del) return "rep";
  if (ins) return "ins";
  if (del) return "del";
  return null;
}

export function buildMintPayload(
  snapshot: SessionSnapshot,
  args: {
    docId: string;
    content: string;
    client: { name: string; version: string };
  },
): MintPayload {
  return {
    docId: args.docId,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    activeMs: snapshot.activeMs,
    events: snapshot.events,
    content: args.content,
    client: args.client,
  };
}
