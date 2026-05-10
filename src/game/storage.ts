import type { Coord, GameRun, RoomData } from "./types";
import { coordKey } from "./coordinates";

const RUN_PREFIX = "frozen_moment:run:";
const ROOM_PREFIX = "frozen_moment:room:";

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      evictOldestRooms(8);
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

function evictOldestRooms(count: number) {
  const entries: Array<{ key: string; t: number }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(ROOM_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const room = JSON.parse(raw) as RoomData;
      entries.push({ key: k, t: room.generatedAt || 0 });
    } catch { /* skip */ }
  }
  entries.sort((a, b) => a.t - b.t);
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    try { localStorage.removeItem(entries[i].key); } catch { /* ignore */ }
  }
}

export function saveRun(run: GameRun): void {
  // strip room images from run blob — they live in their own keys
  const slim: GameRun = {
    ...run,
    visited: Object.fromEntries(
      Object.entries(run.visited).map(([k, room]) => [k, { ...room, imageDataUrl: "" }])
    ),
  };
  safeSet(RUN_PREFIX + run.seed, JSON.stringify(slim));
}

export function loadRun(seed: string): GameRun | null {
  try {
    const raw = localStorage.getItem(RUN_PREFIX + seed);
    if (!raw) return null;
    const slim = JSON.parse(raw) as GameRun;
    // rehydrate room images from per-room storage
    const visited: Record<string, RoomData> = {};
    for (const [k, room] of Object.entries(slim.visited || {})) {
      const full = loadRoom(seed, room.coord);
      if (full) visited[k] = full;
    }
    return { ...slim, visited };
  } catch {
    return null;
  }
}

export function saveRoom(seed: string, room: RoomData): void {
  safeSet(ROOM_PREFIX + seed + ":" + coordKey(room.coord), JSON.stringify(room));
}

export function loadRoom(seed: string, coord: Coord): RoomData | null {
  try {
    const raw = localStorage.getItem(ROOM_PREFIX + seed + ":" + coordKey(coord));
    if (!raw) return null;
    return JSON.parse(raw) as RoomData;
  } catch {
    return null;
  }
}

export function clearRun(seed: string): void {
  try {
    localStorage.removeItem(RUN_PREFIX + seed);
    const prefix = ROOM_PREFIX + seed + ":";
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

export function newSeed(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
