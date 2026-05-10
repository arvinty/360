import { chatJSON } from "./openai";
import {
  SCENARIO_CORE_SYSTEM_PROMPT,
  SCENARIO_ROOMS_SYSTEM_PROMPT,
  SCENARIO_CLUES_SYSTEM_PROMPT,
} from "./prompts";
import type { NavigationClueSet, RoomCatalogEntry, Scenario } from "../game/types";

export class ScenarioValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioValidationError";
  }
}

const REQUIRED_CATALOG_SIZE = 32;

function fallbackRoom(index: number, o: Record<string, unknown>): RoomCatalogEntry {
  const destination = typeof o.destination_room_descriptor === "string"
    ? o.destination_room_descriptor
    : "the crisis destination";
  const start = typeof o.start_room_descriptor === "string"
    ? o.start_room_descriptor
    : "the calm starting world";
  return {
    name: `transit chamber ${String(index).padStart(2, "0")}`,
    concept: `a distinct transitional room between ${start.slice(0, 60)} and ${destination.slice(0, 60)}`,
  };
}

function fallbackClue(index: number, o: Record<string, unknown>): NavigationClueSet {
  const crisis = typeof o.crisis_summary === "string" && o.crisis_summary.trim()
    ? o.crisis_summary.trim()
    : "the central crisis";
  return {
    class_name: "relics",
    correct_object: `${crisis} relic ${index}`,
    decoy_objects: [
      `unrelated relic ${index}A`,
      `unrelated relic ${index}B`,
      `unrelated relic ${index}C`,
    ],
  };
}

function resizePreservingEnds<T>(
  input: T[],
  makeFallback: (index: number) => T
): T[] {
  if (input.length === REQUIRED_CATALOG_SIZE) return input;
  if (input.length === 0) {
    return Array.from({ length: REQUIRED_CATALOG_SIZE }, (_, i) => makeFallback(i));
  }
  if (input.length === 1) {
    return [
      input[0],
      ...Array.from({ length: REQUIRED_CATALOG_SIZE - 1 }, (_, i) => makeFallback(i + 1)),
    ];
  }

  const first = input[0];
  const last = input[input.length - 1];
  const middle = input.slice(1, -1);
  const neededMiddle = REQUIRED_CATALOG_SIZE - 2;
  const normalizedMiddle = middle.slice(0, neededMiddle);
  while (normalizedMiddle.length < neededMiddle) {
    normalizedMiddle.push(makeFallback(normalizedMiddle.length + 1));
  }
  return [first, ...normalizedMiddle, last];
}

function sanitizeRoomCatalog(raw: unknown, o: Record<string, unknown>): RoomCatalogEntry[] {
  const items = resizePreservingEnds(
    Array.isArray(raw) ? raw : [],
    (index) => fallbackRoom(index, o)
  );
  const seen = new Set<string>();
  return items.map((entry, index) => {
    const r = entry as Record<string, unknown> | undefined;
    let name = typeof r?.name === "string" && r.name.trim()
      ? r.name.trim()
      : fallbackRoom(index, o).name;
    const concept = typeof r?.concept === "string" && r.concept.trim()
      ? r.concept.trim()
      : fallbackRoom(index, o).concept;
    const key = name.toLowerCase();
    if (seen.has(key)) name = `${name} ${index}`;
    seen.add(name.toLowerCase());
    return { name, concept };
  });
}

function sanitizeClueSets(raw: unknown, o: Record<string, unknown>): NavigationClueSet[] {
  const items = resizePreservingEnds(
    Array.isArray(raw) ? raw : [],
    (index) => fallbackClue(index, o)
  );
  return items.map((entry, index) => {
    const r = entry as Record<string, unknown> | undefined;
    const fallback = fallbackClue(index, o);
    const decoys = Array.isArray(r?.decoy_objects)
      ? r.decoy_objects.filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim())
      : [];
    while (decoys.length < 3) decoys.push(fallback.decoy_objects[decoys.length]);
    return {
      class_name: typeof r?.class_name === "string" && r.class_name.trim()
        ? r.class_name.trim()
        : fallback.class_name,
      correct_object: typeof r?.correct_object === "string" && r.correct_object.trim()
        ? r.correct_object.trim()
        : fallback.correct_object,
      decoy_objects: decoys.slice(0, 3),
    };
  });
}

function normalizeScenarioShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };
  o.room_catalog = sanitizeRoomCatalog(o.room_catalog, o);
  o.navigation_clue_sets = sanitizeClueSets(o.navigation_clue_sets, o);
  return o;
}

function validateScenario(s: unknown): asserts s is Scenario {
  if (!s || typeof s !== "object") throw new ScenarioValidationError("not an object");
  const o = s as Record<string, unknown>;
  const requireStr = (k: string) => {
    if (typeof o[k] !== "string" || !(o[k] as string).trim()) {
      throw new ScenarioValidationError(`missing or empty: ${k}`);
    }
  };
  requireStr("mission_statement");
  requireStr("start_room_descriptor");
  requireStr("destination_room_descriptor");
  requireStr("crisis_summary");
  requireStr("art_style");

  if (!Array.isArray(o.gradient_axes) || o.gradient_axes.length < 3 || o.gradient_axes.length > 5) {
    throw new ScenarioValidationError("gradient_axes must be 3-5 strings");
  }
  if (typeof o.step_budget !== "number" || o.step_budget < 18 || o.step_budget > 30) {
    throw new ScenarioValidationError("step_budget out of range");
  }
  if (!Array.isArray(o.descriptor_curve) || o.descriptor_curve.length !== 5) {
    throw new ScenarioValidationError("descriptor_curve must have exactly 5 entries");
  }
  for (const pt of o.descriptor_curve) {
    const r = pt as Record<string, unknown> | undefined;
    if (!r || typeof r.p !== "number" || typeof r.descriptor !== "string") {
      throw new ScenarioValidationError("descriptor_curve entries malformed");
    }
  }

  if (!Array.isArray(o.room_catalog) || o.room_catalog.length !== REQUIRED_CATALOG_SIZE) {
    throw new ScenarioValidationError(
      `room_catalog must have exactly ${REQUIRED_CATALOG_SIZE} entries (got ${(o.room_catalog as unknown[])?.length})`
    );
  }
  const seenNames = new Set<string>();
  for (const entry of o.room_catalog as unknown[]) {
    const r = entry as Record<string, unknown> | undefined;
    if (!r || typeof r.name !== "string" || typeof r.concept !== "string") {
      throw new ScenarioValidationError("room_catalog entries must have name and concept");
    }
    const key = r.name.trim().toLowerCase();
    if (!key) throw new ScenarioValidationError("empty room name");
    if (seenNames.has(key)) {
      throw new ScenarioValidationError(`duplicate room name: ${r.name}`);
    }
    seenNames.add(key);
  }

  if (!Array.isArray(o.navigation_clue_sets) || o.navigation_clue_sets.length !== REQUIRED_CATALOG_SIZE) {
    throw new ScenarioValidationError(
      `navigation_clue_sets must have exactly ${REQUIRED_CATALOG_SIZE} entries (got ${(o.navigation_clue_sets as unknown[])?.length})`
    );
  }
  for (const entry of o.navigation_clue_sets as unknown[]) {
    const r = entry as Record<string, unknown> | undefined;
    if (
      !r ||
      typeof r.class_name !== "string" ||
      !r.class_name.trim() ||
      typeof r.correct_object !== "string" ||
      !r.correct_object.trim() ||
      !Array.isArray(r.decoy_objects) ||
      r.decoy_objects.length !== 3
    ) {
      throw new ScenarioValidationError(
        "navigation_clue_sets entries must have class_name, correct_object, and exactly 3 decoy_objects"
      );
    }
    for (const decoy of r.decoy_objects) {
      if (typeof decoy !== "string" || !decoy.trim()) {
        throw new ScenarioValidationError("navigation_clue_sets decoy_objects must be non-empty strings");
      }
    }
  }
}

const MAX_VALIDATION_RETRIES = 4;

function buildContextForExpansion(core: Record<string, unknown>): string {
  return `Core scenario context:
mission_statement: ${core.mission_statement}
start_room_descriptor: ${core.start_room_descriptor}
destination_room_descriptor: ${core.destination_room_descriptor}
crisis_summary: ${core.crisis_summary}
art_style: ${core.art_style}
gradient_axes: ${JSON.stringify(core.gradient_axes)}`;
}

export async function generateScenario(
  worldPrompt: string,
  onAttempt?: (attempt: number, max: number, lastError?: string) => void
): Promise<Scenario> {
  let lastErr: ScenarioValidationError | null = null;

  for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    onAttempt?.(attempt + 1, MAX_VALIDATION_RETRIES + 1, lastErr?.message);

    const corePrompt = lastErr
      ? `${worldPrompt}\n\nPrevious attempt failed validation: ${lastErr.message}\nReturn a corrected JSON object that fixes this issue exactly.`
      : worldPrompt;

    const core = await chatJSON<Record<string, unknown>>(
      SCENARIO_CORE_SYSTEM_PROMPT,
      corePrompt,
      { temperature: 0.95, maxTokens: 4000 }
    );

    const expansionContext = buildContextForExpansion(core);
    const userPrompt = `World prompt: ${worldPrompt}\n\n${expansionContext}`;

    const [roomsRes, cluesRes] = await Promise.all([
      chatJSON<Record<string, unknown>>(SCENARIO_ROOMS_SYSTEM_PROMPT, userPrompt, {
        temperature: 0.95,
        maxTokens: 7000,
      }),
      chatJSON<Record<string, unknown>>(SCENARIO_CLUES_SYSTEM_PROMPT, userPrompt, {
        temperature: 0.95,
        maxTokens: 5000,
      }),
    ]);

    const merged: Record<string, unknown> = {
      ...core,
      room_catalog: roomsRes.room_catalog,
      navigation_clue_sets: cluesRes.navigation_clue_sets,
    };

    const normalized = normalizeScenarioShape(merged) as Record<string, unknown> & Scenario;
    try {
      validateScenario(normalized);
      normalized.descriptor_curve = [...normalized.descriptor_curve].sort((a, b) => a.p - b.p);
      normalized.step_budget = Math.round(normalized.step_budget);
      return normalized;
    } catch (err) {
      if (!(err instanceof ScenarioValidationError)) throw err;
      lastErr = err;
      console.warn(`[scenario] attempt ${attempt + 1} failed validation: ${err.message}`);
    }
  }
  throw lastErr ?? new ScenarioValidationError("scenario validation failed");
}
