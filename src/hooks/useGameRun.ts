import { useCallback, useEffect, useRef, useState } from "react";
import { generateScenario } from "../ai/scenario";
import { generateRoom } from "../ai/panorama";
import {
  coordKey,
  gradientPosition,
  layoutCatalogCoords,
  manhattan,
  pickDestinationCoord,
  step as stepCoord,
} from "../game/coordinates";
import { clearRun, newSeed, saveRoom, saveRun } from "../game/storage";
import type { Coord, Direction, GameRun, RoomData, Scenario } from "../game/types";

const initialRun: GameRun = {
  seed: "",
  worldPrompt: "",
  scenario: null,
  startCoord: [0, 0],
  destinationCoord: [0, 0],
  currentCoord: [0, 0],
  visited: {},
  coordToCatalogIndex: {},
  prebuiltRooms: {},
  roomsReady: 0,
  stepsTaken: 0,
  wrongStreak: 0,
  neutralStreak: 0,
  status: "idle",
};

function computeWarning(wrong: number, neutral: number): "slight" | "serious" | "extreme" | null {
  if (wrong >= 3) return "extreme";
  if (wrong >= 2) return "serious";
  if ((wrong >= 1 && neutral >= 1) || neutral >= 3) return "slight";
  return null;
}

/** Pick the next unused middle catalog index (excluding 0 = start, last = goal). */
function nextCatalogIndex(
  used: Record<string, number>,
  catalogSize: number,
  preferredIndex: number
): number {
  const taken = new Set(Object.values(used));
  const min = 1;
  const max = catalogSize - 2;
  const preferred = Math.max(min, Math.min(max, preferredIndex));
  for (let offset = 0; offset <= max - min; offset++) {
    const lower = preferred - offset;
    const upper = preferred + offset;
    if (lower >= min && !taken.has(lower)) return lower;
    if (upper <= max && !taken.has(upper)) return upper;
  }
  // fallback — shouldn't hit unless player exceeds catalog
  return Math.floor(Math.random() * (catalogSize - 2)) + 1;
}

function ensureCatalogIndex(
  coord: Coord,
  start: Coord,
  destination: Coord,
  scenario: Scenario,
  used: Record<string, number>
): { index: number; updated: Record<string, number> } {
  const key = coordKey(coord);
  if (used[key] !== undefined) return { index: used[key], updated: used };

  const catalogSize = scenario.room_catalog.length;
  let index: number;
  if (coord[0] === start[0] && coord[1] === start[1]) {
    index = 0;
  } else if (coord[0] === destination[0] && coord[1] === destination[1]) {
    index = catalogSize - 1;
  } else {
    const p = gradientPosition(coord, start, destination);
    index = nextCatalogIndex(used, catalogSize, Math.round(p * (catalogSize - 1)));
  }
  return { index, updated: { ...used, [key]: index } };
}

export function useGameRun() {
  const [run, setRun] = useState<GameRun>(initialRun);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (run.seed && run.status !== "idle") {
      try { saveRun(run); } catch { /* ignore */ }
    }
  }, [run]);

  const submitPrompt = useCallback(async (worldPrompt: string) => {
    const seed = newSeed();
    setRun({
      ...initialRun,
      seed,
      worldPrompt,
      status: "generating_scenario",
    });
    try {
      const scenario = await generateScenario(worldPrompt, (attempt, max, lastErr) => {
        setRun((r) => ({
          ...r,
          error: lastErr ? `attempt ${attempt}/${max} — last error: ${lastErr}` : undefined,
        }));
      });
      const optimal = Math.floor(scenario.step_budget / 2);
      const destination = pickDestinationCoord(seed, optimal);
      const layout = layoutCatalogCoords([0, 0], destination, scenario.room_catalog.length, seed);
      const initialMap: Record<string, number> = {};
      layout.forEach((c, idx) => { initialMap[coordKey(c)] = idx; });
      setRun((r) => ({
        ...r,
        scenario,
        destinationCoord: destination,
        coordToCatalogIndex: initialMap,
        status: "briefing",
        error: undefined,
      }));
      // kick off parallel rendering immediately so the player can read the briefing while rooms render
      void preloadAllRooms(seed, scenario, [0, 0], destination, initialMap);
    } catch (err) {
      setRun((r) => ({
        ...r,
        status: "idle",
        error: err instanceof Error ? err.message : "Failed to compose briefing",
      }));
    }
  }, []);

  /** Fan out generation of every catalog room in parallel. Individual failures are non-fatal. */
  const preloadAllRooms = useCallback(
    async (
      seed: string,
      scenario: Scenario,
      start: Coord,
      destination: Coord,
      coordMap: Record<string, number>
    ) => {
      const catalogSize = scenario.room_catalog.length;
      const indexToCoord: Coord[] = new Array(catalogSize);
      for (const [k, idx] of Object.entries(coordMap)) {
        const [xs, ys] = k.split(",");
        indexToCoord[idx] = [parseInt(xs, 10), parseInt(ys, 10)];
      }
      setRun((p) => ({ ...p, roomsReady: 0 }));

      // Bounded concurrency: gpt-image-2 caps at 20 images/min. Fan out at most
      // CONCURRENCY at a time; individual failures are swallowed.
      const CONCURRENCY = 5;
      let cursor = 0;
      const runOne = async (idx: number) => {
        try {
          const room = await generateRoom({
            seed,
            coord: indexToCoord[idx],
            scenario,
            start,
            destination,
            catalogIndex: idx,
          });
          setRun((p) => ({
            ...p,
            prebuiltRooms: { ...p.prebuiltRooms, [idx]: room },
            roomsReady: p.roomsReady + 1,
          }));
        } catch (err) {
          console.warn(`[room ${idx}] generation failed (will lazy-gen on visit):`, err);
          setRun((p) => ({ ...p, roomsReady: p.roomsReady + 1 }));
        }
      };
      const worker = async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= indexToCoord.length) return;
          await runOne(idx);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, indexToCoord.length) }, worker));
    },
    []
  );

  const beginExploration = useCallback(async () => {
    const r = runRef.current;
    if (!r.scenario) return;
    const startKey = coordKey([0, 0]);
    const startRoom = r.prebuiltRooms[0] ?? r.visited[startKey];
    if (!startRoom) {
      // start room not ready yet — keep the briefing up; UI disables this case anyway.
      return;
    }
    try { saveRoom(r.seed, startRoom); } catch { /* ignore */ }
    setRun((p) => ({
      ...p,
      visited: { ...p.visited, [startKey]: startRoom },
      currentCoord: [0, 0],
      status: "exploring",
    }));
  }, []);

  const step = useCallback(async (direction: Direction) => {
    const r = runRef.current;
    if (r.status !== "exploring" || !r.scenario) return;
    const next = stepCoord(r.currentCoord, direction);
    const nextKey = coordKey(next);

    const prevDist = manhattan(r.currentCoord, r.destinationCoord);
    const nextDist = manhattan(next, r.destinationCoord);
    const delta = nextDist - prevDist; // +1 wrong, 0 neutral, -1 right
    const wrongStreak = delta > 0 ? r.wrongStreak + 1 : delta < 0 ? 0 : r.wrongStreak;
    const neutralStreak = delta === 0 ? r.neutralStreak + 1 : delta < 0 ? 0 : r.neutralStreak;

    // already visited? just walk into it.
    if (r.visited[nextKey]) {
      const stepsTaken = r.stepsTaken + 1;
      const arrived =
        next[0] === r.destinationCoord[0] && next[1] === r.destinationCoord[1];
      const failed = !arrived && stepsTaken >= r.scenario.step_budget;
      setRun((p) => ({
        ...p,
        currentCoord: next,
        stepsTaken,
        wrongStreak,
        neutralStreak,
        status: arrived ? "arrived" : failed ? "failed" : "exploring",
      }));
      return;
    }

    const { index, updated } = ensureCatalogIndex(
      next,
      r.startCoord,
      r.destinationCoord,
      r.scenario,
      r.coordToCatalogIndex
    );
    setRun((p) => ({ ...p, status: "stepping", coordToCatalogIndex: updated }));

    try {
      const prebuilt = r.prebuiltRooms[index];
      let room: RoomData;
      if (prebuilt && prebuilt.coord[0] === next[0] && prebuilt.coord[1] === next[1]) {
        // exact prebuilt for this coord — use it directly
        room = prebuilt;
        try { saveRoom(r.seed, room); } catch { /* ignore */ }
      } else {
        const previousRoom = r.visited[coordKey(r.currentCoord)];
        room = await generateRoom({
          seed: r.seed,
          coord: next,
          scenario: r.scenario,
          start: r.startCoord,
          destination: r.destinationCoord,
          catalogIndex: index,
          previousRoom,
          direction,
        });
      }

      const stepsTaken = r.stepsTaken + 1;
      const arrived =
        next[0] === r.destinationCoord[0] && next[1] === r.destinationCoord[1];
      const failed = !arrived && stepsTaken >= r.scenario.step_budget;

      setRun((p) => ({
        ...p,
        visited: { ...p.visited, [nextKey]: room },
        currentCoord: next,
        stepsTaken,
        wrongStreak,
        neutralStreak,
        status: arrived ? "arrived" : failed ? "failed" : "exploring",
      }));
    } catch (err) {
      setRun((p) => ({
        ...p,
        status: "exploring",
        error: err instanceof Error ? err.message : "Step failed",
      }));
    }
  }, []);

  const regenerateRoom = useCallback(async (coord: Coord) => {
    const r = runRef.current;
    if (r.status !== "exploring" || !r.scenario) return;
    const key = coordKey(coord);
    const existing = r.visited[key];
    if (!existing) return;
    const catalogIndex = r.coordToCatalogIndex[key] ?? existing.catalogIndex ?? 0;

    setRun((p) => ({ ...p, status: "stepping" }));
    try {
      // find a neighbor for continuity reference (prefer current room)
      const currentKey = coordKey(r.currentCoord);
      const previousRoom = currentKey !== key ? r.visited[currentKey] : undefined;
      const room = await generateRoom({
        seed: r.seed,
        coord,
        scenario: r.scenario,
        start: r.startCoord,
        destination: r.destinationCoord,
        catalogIndex,
        previousRoom,
        force: true,
      });
      setRun((p) => ({
        ...p,
        visited: { ...p.visited, [key]: room },
        status: "exploring",
      }));
    } catch (err) {
      setRun((p) => ({
        ...p,
        status: "exploring",
        error: err instanceof Error ? err.message : "Regeneration failed",
      }));
    }
  }, []);

  const warpTo = useCallback((coord: Coord) => {
    const r = runRef.current;
    if (r.status !== "exploring" || !r.scenario) return;
    const key = coordKey(coord);
    if (!r.visited[key]) return;
    setRun((p) => ({ ...p, currentCoord: coord }));
  }, []);

  const reset = useCallback(() => {
    const r = runRef.current;
    if (r.seed) clearRun(r.seed);
    setRun(initialRun);
  }, []);

  const replaySameWorld = useCallback(() => {
    const r = runRef.current;
    if (r.worldPrompt) {
      void submitPrompt(r.worldPrompt);
    }
  }, [submitPrompt]);

  return {
    run,
    submitPrompt,
    beginExploration,
    step,
    warpTo,
    regenerateRoom,
    reset,
    replaySameWorld,
    stepsRemaining: run.scenario ? run.scenario.step_budget - run.stepsTaken : 0,
    distanceToDestination: manhattan(run.currentCoord, run.destinationCoord),
    warningLevel: computeWarning(run.wrongStreak, run.neutralStreak),
  };
}
