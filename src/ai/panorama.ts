import { generateImage } from "./openai";
import { buildContinuityPostfix, buildPanoramaPrompt } from "./prompts";
import { gradientPosition, manhattan, optimalPath } from "../game/coordinates";
import { loadRoom, saveRoom } from "../game/storage";
import type { Coord, Direction, DoorClue, NavigationClueSet, RoomData, Scenario } from "../game/types";

const DIRECTIONS: Direction[] = ["N", "E", "S", "W"];

export function nearestDescriptor(scenario: Scenario, p: number): string {
  let best = scenario.descriptor_curve[0];
  let bestDist = Math.abs(best.p - p);
  for (const pt of scenario.descriptor_curve) {
    const d = Math.abs(pt.p - p);
    if (d < bestDist) {
      best = pt;
      bestDist = d;
    }
  }
  return best.descriptor;
}

function hashString(value: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function shuffled<T>(items: T[], seed: string): T[] {
  const out = [...items];
  let h = hashString(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function directionTowardDestination(coord: Coord, destination: Coord): Direction | null {
  const dx = destination[0] - coord[0];
  const dy = destination[1] - coord[1];
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? "E" : "W";
  return dy > 0 ? "S" : "N";
}

function clueRankForCoord(coord: Coord, start: Coord, destination: Coord): number {
  const path = optimalPath(start, destination);
  const onPath = path.findIndex((p) => p[0] === coord[0] && p[1] === coord[1]);
  if (onPath >= 0) return onPath;
  const nearestPathDistance = Math.min(...path.map((p) => manhattan(coord, p)));
  return path.length + nearestPathDistance + manhattan(start, coord);
}

function fallbackClueSet(scenario: Scenario): NavigationClueSet {
  return {
    class_name: "relics",
    correct_object: scenario.destination_room_descriptor,
    decoy_objects: [
      scenario.start_room_descriptor,
      scenario.gradient_axes[0] ?? "calm relic",
      scenario.gradient_axes[1] ?? "unrelated relic",
    ],
  };
}

function buildDoorClues(args: {
  seed: string;
  coord: Coord;
  start: Coord;
  destination: Coord;
  scenario: Scenario;
}): DoorClue[] | undefined {
  const correctDirection = directionTowardDestination(args.coord, args.destination);
  if (!correctDirection) return undefined;

  const rank = clueRankForCoord(args.coord, args.start, args.destination);
  const clueSets = args.scenario.navigation_clue_sets ?? [];
  const clueSet = clueSets[rank] ?? clueSets[clueSets.length - 1] ?? fallbackClueSet(args.scenario);
  const decoys = shuffled(clueSet.decoy_objects, `${args.seed}:${args.coord[0]},${args.coord[1]}:decoys`);
  let decoyIndex = 0;

  return DIRECTIONS.map((direction) => {
    if (direction === correctDirection) {
      return {
        direction,
        object: `${clueSet.correct_object} (${clueSet.class_name})`,
        isCorrect: true,
      };
    }
    const object = decoys[decoyIndex++] ?? `${clueSet.class_name} decoy object`;
    return {
      direction,
      object: `${object} (${clueSet.class_name})`,
      isCorrect: false,
    };
  });
}

export async function generateRoom(args: {
  seed: string;
  coord: Coord;
  scenario: Scenario;
  start: Coord;
  destination: Coord;
  catalogIndex: number;
  previousRoom?: RoomData;
  direction?: Direction;
  force?: boolean;
}): Promise<RoomData> {
  if (!args.force) {
    const cached = loadRoom(args.seed, args.coord);
    if (cached && cached.imageDataUrl) return cached;
  }

  const p = gradientPosition(args.coord, args.start, args.destination);
  const descriptor = nearestDescriptor(args.scenario, p);

  const catalogEntry = args.scenario.room_catalog[args.catalogIndex];
  if (!catalogEntry) {
    throw new Error(`Catalog index ${args.catalogIndex} out of range`);
  }
  const navigationClues = buildDoorClues({
    seed: args.seed,
    coord: args.coord,
    start: args.start,
    destination: args.destination,
    scenario: args.scenario,
  });

  let prompt = buildPanoramaPrompt({
    descriptor,
    gradientPosition: p,
    axes: args.scenario.gradient_axes,
    artStyle: args.scenario.art_style,
    roomName: catalogEntry.name,
    roomConcept: catalogEntry.concept,
    navigationClues,
  });
  if (args.previousRoom && args.direction) {
    prompt += buildContinuityPostfix(args.direction);
  }

  const imageDataUrl = await generateImage(prompt, {
    referenceImage: args.previousRoom?.imageDataUrl,
  });

  const room: RoomData = {
    coord: args.coord,
    imageDataUrl,
    descriptor,
    gradientPosition: p,
    generatedAt: Date.now(),
    name: catalogEntry.name,
    concept: catalogEntry.concept,
    catalogIndex: args.catalogIndex,
    navigationClues,
  };
  saveRoom(args.seed, room);
  return room;
}

/**
 * Pre-generate a room by catalog index without binding to a coord.
 * Gradient position is derived from index/(catalogSize-1) so that
 * index 0 ≈ start descriptor and index (size-1) ≈ destination descriptor.
 */
export async function generatePanoramaByIndex(args: {
  scenario: Scenario;
  catalogIndex: number;
}): Promise<RoomData> {
  const { scenario, catalogIndex } = args;
  const entry = scenario.room_catalog[catalogIndex];
  if (!entry) throw new Error(`Catalog index ${catalogIndex} out of range`);
  const size = scenario.room_catalog.length;
  const p = size > 1 ? catalogIndex / (size - 1) : 0;
  const descriptor = nearestDescriptor(scenario, p);

  const prompt = buildPanoramaPrompt({
    descriptor,
    gradientPosition: p,
    axes: scenario.gradient_axes,
    artStyle: scenario.art_style,
    roomName: entry.name,
    roomConcept: entry.concept,
  });
  const imageDataUrl = await generateImage(prompt);

  return {
    coord: [0, 0],
    imageDataUrl,
    descriptor,
    gradientPosition: p,
    generatedAt: Date.now(),
    name: entry.name,
    concept: entry.concept,
    catalogIndex,
  };
}
