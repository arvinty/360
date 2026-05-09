const STORAGE_KEY = "grid-360-worlds";
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_IMAGE_MODEL = "gpt-image-2";
const OPENAI_VISION_MODEL = "gpt-4.1-mini";
const IMAGE_DB_NAME = "grid-360-images";
const IMAGE_DB_STORE = "images";
const WORLD_DB_STORE = "worlds";
const IMAGE_DB_VERSION = 2;
const ORIGIN_NODE_ID = "origin";
const CLICK_QUANTUM_DEGREES = 5;

export const DEFAULT_PROMPT =
  "A high-quality 360 equirectangular image of a cozy college dorm room. Photorealistic.";

export type ClickTarget = {
  pitch: number;
  yaw: number;
};

export type TargetMetadata = {
  targetLabel: string;
  transitionSummary: string;
  quantizedPitch: number;
  quantizedYaw: number;
};

export type Goal = {
  origin: string;
  target: string;
  theme: string;
  originShort: string;
  targetShort: string;
  moves: number;
  won: boolean;
  wonAt?: string;
  wonEvidence?: string;
};

export type NodePayload = {
  worldId: string;
  nodeId: string;
  parentNodeId: string | null;
  imageUrl: string;
  cacheHit: boolean;
  promptUsed: string;
  target: TargetMetadata | null;
  goal: Goal | null;
};

export type WorldSummary = {
  world_id: string;
  prompt: string;
  prompt_preview: string;
  created_at: string;
  node_count: number;
  origin_image_url: string | null;
  goal_origin: string | null;
  goal_target: string | null;
  goal_origin_short: string | null;
  goal_target_short: string | null;
  goal_theme: string | null;
  goal_moves: number | null;
  goal_won: boolean | null;
};

export type WorldHistoryResponse = {
  worlds: WorldSummary[];
};

export type MoveTreeNode = {
  node_id: string;
  parent_node_id: string | null;
  created_at: string;
  depth: number;
  step: number;
  target_label: string | null;
  is_origin: boolean;
};

export type WorldMoveTreeResponse = {
  world_id: string;
  nodes: MoveTreeNode[];
};

type LegacyWorldNode = {
  x?: number;
  y?: number;
  prompt: string;
  created_at: string;
  last_move?: string | null;
};

type WorldNode = {
  id: string;
  parent_id: string | null;
  prompt: string;
  created_at: string;
  target: TargetMetadata | null;
  legacy?: LegacyWorldNode;
};

type World = {
  world_id: string;
  prompt: string;
  normalized_prompt: string;
  created_at: string;
  grid?: { movement: string };
  nodes: Record<string, WorldNode | LegacyWorldNode>;
  edges?: Record<string, string>;
  goal?: Goal;
  recent_clicks?: Array<{ target: string; pitch: number; yaw: number; at: string }>;
};

type OpenAIImageResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ text?: string; type?: string }>;
  }>;
  error?: { message?: string };
};

type VisionTargetResponse = {
  target_label?: string;
  transition_summary?: string;
  destination_prompt?: string;
  goal_visible?: boolean;
  goal_evidence?: string;
};

// ── IndexedDB image store ──────────────────────────────────────────────────

let _db: IDBDatabase | null = null;
let localStorageMigrationPromise: Promise<void> | null = null;

function openImageDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IMAGE_DB_STORE)) {
        req.result.createObjectStore(IMAGE_DB_STORE);
      }
      if (!req.result.objectStoreNames.contains(WORLD_DB_STORE)) {
        req.result.createObjectStore(WORLD_DB_STORE, { keyPath: "world_id" });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getImage(key: string): Promise<string | null> {
  const db = await openImageDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IMAGE_DB_STORE, "readonly").objectStore(IMAGE_DB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function putImage(key: string, imageUrl: string): Promise<void> {
  const db = await openImageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, "readwrite");
    tx.objectStore(IMAGE_DB_STORE).put(imageUrl, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllWorldsFromDB(): Promise<World[]> {
  const db = await openImageDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(WORLD_DB_STORE, "readonly").objectStore(WORLD_DB_STORE).getAll();
    req.onsuccess = () => {
      const worlds = Array.isArray(req.result)
        ? (req.result as unknown[]).filter(isWorld).map(normalizeWorld)
        : [];
      resolve(worlds);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getWorldFromDB(worldId: string): Promise<World | null> {
  const db = await openImageDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(WORLD_DB_STORE, "readonly").objectStore(WORLD_DB_STORE).get(worldId);
    req.onsuccess = () => resolve(isWorld(req.result) ? normalizeWorld(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

async function putWorldInDB(world: World): Promise<void> {
  const db = await openImageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WORLD_DB_STORE, "readwrite");
    tx.objectStore(WORLD_DB_STORE).put(world);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function imageKey(worldId: string, nodeId: string): string {
  return `${worldId}/${nodeId}`;
}

function legacyImageKey(worldId: string, x: number, y: number): string {
  return `${worldId}/${x},${y}`;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function getApiKey(): string {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing from .env");
  }
  return apiKey;
}

function normalizePrompt(prompt: string): string {
  return prompt.split(/\s+/).join(" ").trim().toLowerCase();
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function worldIdFromPrompt(prompt: string): string {
  const normalized = normalizePrompt(prompt || DEFAULT_PROMPT);
  return `${hashText(normalized)}${hashText(normalized.slice(0, 32))}`.slice(0, 16);
}

function quantizeAngle(value: number): number {
  return Math.round(value / CLICK_QUANTUM_DEGREES) * CLICK_QUANTUM_DEGREES;
}

function clickEdgeKey(parentNodeId: string, pitch: number, yaw: number): string {
  return `${parentNodeId}@${quantizeAngle(pitch)},${quantizeAngle(yaw)}`;
}

function nodeIdFromEdge(worldId: string, edgeKey: string): string {
  return hashText(`${worldId}:${edgeKey}`);
}

function promptPreview(prompt: string): string {
  return prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
}

function isWorld(value: unknown): value is World {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<World>;
  return (
    typeof candidate.world_id === "string" &&
    typeof candidate.prompt === "string" &&
    typeof candidate.created_at === "string" &&
    !!candidate.nodes &&
    typeof candidate.nodes === "object"
  );
}

function isGraphNode(node: WorldNode | LegacyWorldNode | undefined): node is WorldNode {
  return !!node && typeof (node as WorldNode).id === "string";
}

function readWorldsFromLocalStorage(): World[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isWorld).map(normalizeWorld) : [];
  } catch {
    return [];
  }
}

async function migrateWorldsFromLocalStorage(): Promise<void> {
  if (localStorageMigrationPromise) return localStorageMigrationPromise;
  localStorageMigrationPromise = migrateWorldsFromLocalStorageOnce();
  return localStorageMigrationPromise;
}

async function migrateWorldsFromLocalStorageOnce(): Promise<void> {
  const worlds = readWorldsFromLocalStorage();
  if (!worlds.length) return;
  await Promise.all(worlds.map((world) => putWorldInDB(world)));
  window.localStorage.removeItem(STORAGE_KEY);
}

function normalizeWorld(world: World): World {
  const nextWorld: World = {
    ...world,
    nodes: { ...world.nodes },
    edges: { ...(world.edges ?? {}) },
  };

  const origin = nextWorld.nodes[ORIGIN_NODE_ID];
  if (!isGraphNode(origin)) {
    const legacyOrigin = nextWorld.nodes["0,0"] as LegacyWorldNode | undefined;
    if (legacyOrigin) {
      nextWorld.nodes[ORIGIN_NODE_ID] = {
        id: ORIGIN_NODE_ID,
        parent_id: null,
        prompt: legacyOrigin.prompt,
        created_at: legacyOrigin.created_at,
        target: null,
        legacy: legacyOrigin,
      };
    }
  }

  return nextWorld;
}

async function readWorlds(): Promise<World[]> {
  await migrateWorldsFromLocalStorage();
  return getAllWorldsFromDB();
}

async function readWorld(worldId: string): Promise<World | null> {
  await migrateWorldsFromLocalStorage();
  return getWorldFromDB(worldId);
}

async function upsertWorld(nextWorld: World): Promise<void> {
  await putWorldInDB(normalizeWorld(nextWorld));
}

function buildOriginPrompt(goal: Goal): string {
  return [
    `World description: ${goal.origin}`,
    "Generate the entry viewpoint for this world.",
    "Generate a seamless full 360-degree equirectangular panorama, 2:1 aspect ratio, immersive street-view style environment, no text, no UI, no borders.",
  ].join("\n");
}

type GoalSeed = Pick<Goal, "origin" | "target" | "theme" | "originShort" | "targetShort">;

const GOAL_FALLBACKS: GoalSeed[] = [
  {
    origin: "an abandoned shopping mall, dim flickering fluorescent lights, dusty escalators",
    target: "a cracked storefront mannequin",
    theme: "retail remains, dust, forgotten displays",
    originShort: "Abandoned Mall",
    targetShort: "Store Mannequin",
  },
  {
    origin: "a quiet snowy alpine village at dusk, warm lit windows, fresh snowfall",
    target: "a wooden sled by a doorway",
    theme: "winter life, wood, quiet routines",
    originShort: "Snowy Alpine Village",
    targetShort: "Wooden Sled",
  },
  {
    origin: "a sprawling neon-lit night market in a futuristic city",
    target: "a steaming noodle stall sign",
    theme: "street food, steam, neon crowds",
    originShort: "Neon Night Market",
    targetShort: "Noodle Stall Sign",
  },
  {
    origin: "an overgrown botanical garden inside a derelict glasshouse",
    target: "a rusted watering can",
    theme: "gardening, moisture, reclaimed growth",
    originShort: "Overgrown Glasshouse",
    targetShort: "Watering Can",
  },
  {
    origin: "a coastal lighthouse and its keeper's cottage on a stormy night",
    target: "a coiled mooring rope",
    theme: "seafaring, rope, weathered wood",
    originShort: "Coastal Lighthouse",
    targetShort: "Mooring Rope",
  },
];

function pickFallbackGoal(): GoalSeed {
  return GOAL_FALLBACKS[Math.floor(Math.random() * GOAL_FALLBACKS.length)];
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Best-effort short label from a long descriptive phrase. Used when the LLM
 * omits the short fields or when reading a legacy cached world that predates
 * the short-label schema.
 */
function deriveShortLabel(full: string, maxWords: number): string {
  if (!full) return "";
  const firstClause = full.split(/[,.;:\n\r]/)[0] ?? full;
  const cleaned = firstClause
    .replace(/^(an?|the)\s+/i, "")
    .trim()
    .slice(0, 40);
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, maxWords);
  return words.map(titleCaseWord).join(" ");
}

/**
 * Ensure a Goal-like object always has `originShort`/`targetShort` populated,
 * deriving them from the long fields when missing (legacy cached worlds).
 */
function withShortLabels(goal: Goal): Goal {
  if (goal.originShort && goal.targetShort) return goal;
  return {
    ...goal,
    originShort: goal.originShort || deriveShortLabel(goal.origin, 5),
    targetShort: goal.targetShort || deriveShortLabel(goal.target, 4),
  };
}

function buildGoalGenerationInstruction(userPromptHint?: string): string {
  const trimmedHint = userPromptHint?.trim();
  const lines = [
    "You are designing a Wiki-Racer-style 360 exploration game.",
    "The player begins in an ORIGIN environment and must wander through AI-generated 360 scenes until they find a hidden TARGET.",
  ];
  if (trimmedHint) {
    lines.push(
      `User description of the world: "${trimmedHint}".`,
      "You MUST base the ORIGIN environment on this user description (faithfully expand it into an evocative, visually rich place, building, or environment).",
      "Pick a TARGET that is a specific, visually distinctive object that naturally appears in this origin and is reasonably discoverable by exploration.",
      "Pick a THEME: 3-8 words of scene vocabulary that naturally co-occurs with both origin and target (materials, mood, activity)."
    );
  } else {
    lines.push(
      "No user description provided. Invent something fresh and surprising.",
      "Pick an ORIGIN that is evocative and visually rich (a place, building, or environment).",
      "Pick a TARGET that is a specific, visually distinctive object that naturally belongs in that origin and can plausibly be found.",
      "Pick a THEME: 3-8 words of scene vocabulary that naturally connects origin and target (materials, mood, activity)."
    );
  }
  lines.push(
    "Also produce two SHORT display labels for the UI:",
    "  - origin_short: a concise place name, max 5 words, Title Case, no leading articles (\"a\", \"an\", \"the\"), no trailing punctuation. Example: \"Abandoned Mall\".",
    "  - target_short: a concise object/landmark name, max 4 words, Title Case, no leading articles, no trailing punctuation. Example: \"Blue Grand Piano\".",
    "These short labels MUST clearly identify the same origin/target as the long descriptions.",
    "Return ONLY valid JSON with these exact keys, no commentary:",
    `{"origin":"...","target":"...","theme":"...","origin_short":"...","target_short":"..."}`
  );
  return lines.join("\n");
}

async function generateGoal(userPromptHint?: string): Promise<Goal> {
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: buildGoalGenerationInstruction(userPromptHint) },
            ],
          },
        ],
      }),
    });

    const data = (await response.json().catch(() => ({}))) as OpenAIResponse;
    if (!response.ok) {
      throw new Error(data.error?.message || "Goal generation failed");
    }

    const parsed = JSON.parse(
      (extractResponseText(data).match(/\{[\s\S]*\}/) ?? [extractResponseText(data)])[0]
    ) as {
      origin?: string;
      target?: string;
      theme?: string;
      origin_short?: string;
      target_short?: string;
    };

    const origin = parsed.origin?.trim();
    const target = parsed.target?.trim();
    const theme = parsed.theme?.trim();
    if (!origin || !target || !theme) throw new Error("Goal response missing fields");

    const originShort = parsed.origin_short?.trim() || deriveShortLabel(origin, 5);
    const targetShort = parsed.target_short?.trim() || deriveShortLabel(target, 4);

    return { origin, target, theme, originShort, targetShort, moves: 0, won: false };
  } catch {
    const fallback = pickFallbackGoal();
    return { ...fallback, moves: 0, won: false };
  }
}

type DirectiveCategory =
  | "threshold"
  | "reflectionInversion"
  | "altitudeDrift"
  | "materialPassage"
  | "microToMacro"
  | "insideOut"
  | "narrativeLeap"
  | "scaleShift";

type DirectiveRule = {
  category: DirectiveCategory;
  cues: RegExp[];
  instruction: string;
  examples: string[];
  baseWeight: number;
};

const DIRECTIVE_RULES: DirectiveRule[] = [
  {
    category: "threshold",
    cues: [/door|gate|arch|window|portal|entrance|hall|corridor|alley/i],
    instruction:
      "Treat the click as a traversable threshold: cross into an adjacent semantic space that still echoes local materials/colors.",
    examples: [
      "door -> move into shop interior, courtyard, backstage, or impossible annex",
      "window -> slip into outside street, interior reflection, or weather pocket",
    ],
    baseWeight: 1.1,
  },
  {
    category: "reflectionInversion",
    cues: [/mirror|reflection|glass|chrome|water surface|screen/i],
    instruction:
      "Invert or fold perspective through reflective geometry; preserve recognizable motifs while bending orientation and physics.",
    examples: [
      "mirror -> reflected counterpart world with swapped lighting and gravity cues",
      "screen -> enter synthetic/meta version of scene",
    ],
    baseWeight: 1.2,
  },
  {
    category: "altitudeDrift",
    cues: [/sky|cloud|sun|moon|star|bird|airplane|roof|tower/i],
    instruction:
      "Progressively increase vertical drift when upward/sky-like clicks repeat: atmosphere can escalate toward orbital/space-like views.",
    examples: [
      "sky clicks chain: clouds -> stratosphere -> orbital edge -> deep space fragments",
      "roofline click -> rise into crane-level, then skyline, then aerial surreal",
    ],
    baseWeight: 1.05,
  },
  {
    category: "materialPassage",
    cues: [/wall|brick|tile|carpet|fabric|wood|metal|stone|texture/i],
    instruction:
      "Treat the clicked material as a passage medium; unfold microscopic texture patterns into navigable architecture.",
    examples: [
      "wood grain -> canyon-like striations and rings as pathways",
      "tile pattern -> geometric district with repeating motifs",
    ],
    baseWeight: 0.95,
  },
  {
    category: "microToMacro",
    cues: [/object|statue|cup|lamp|book|plant|toy|sign|handle|knob/i],
    instruction:
      "Expand object-scale details into world-scale spaces while preserving object identity as environmental structure.",
    examples: [
      "lamp -> city of glowing filaments and warm haze avenues",
      "book spine -> canyon corridor of stacked narrative layers",
    ],
    baseWeight: 0.9,
  },
  {
    category: "insideOut",
    cues: [/room|house|shop|store|building|vehicle|train|ship|cabin/i],
    instruction:
      "Flip interior/exterior semantics creatively: inside can become outside shell, outside can reveal nested interiors.",
    examples: [
      "shopfront -> interior market folds into exterior neon maze",
      "vehicle body -> cabin transitions into moving landscape membrane",
    ],
    baseWeight: 0.9,
  },
  {
    category: "narrativeLeap",
    cues: [/painting|poster|photo|billboard|mural|symbol|icon|text/i],
    instruction:
      "Allow thematic narrative leaps when representational media is clicked; keep one anchor from the prior scene for continuity.",
    examples: [
      "poster -> enter depicted world but preserve prior color temperature",
      "mural -> mythic variant of current district",
    ],
    baseWeight: 0.85,
  },
  {
    category: "scaleShift",
    cues: [/stairs|ladder|elevator|bridge|tunnel|path|road|track/i],
    instruction:
      "Use connective structures as scale shifters: step into altered proportions or spatial compression/expansion.",
    examples: [
      "stairs -> descend into giant-world underlayers or miniature internal shafts",
      "bridge -> stretch into impossible long-form transit scene",
    ],
    baseWeight: 0.92,
  },
];

function countRepeatedRecentTargets(
  recentClicks: NonNullable<World["recent_clicks"]> | undefined,
  targetLabel: string
): number {
  if (!recentClicks?.length || !targetLabel) return 0;
  const normalized = targetLabel.toLowerCase().trim();
  return recentClicks
    .slice(-4)
    .filter((entry) => entry.target.toLowerCase().trim() === normalized).length;
}

function weightedPick<T>(items: Array<{ item: T; weight: number }>): T | null {
  const positive = items.filter((entry) => entry.weight > 0);
  if (!positive.length) return null;
  const total = positive.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * total;
  for (const entry of positive) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.item;
  }
  return positive[positive.length - 1].item;
}

function buildDynamicDirectiveSuffix({
  targetLabel,
  transitionSummary,
  pitch,
  recentClicks,
  goal,
}: {
  targetLabel: string;
  transitionSummary: string;
  pitch: number;
  recentClicks?: NonNullable<World["recent_clicks"]>;
  goal: Goal | null;
}): string {
  const repeatedTargetCount = countRepeatedRecentTargets(recentClicks, targetLabel);
  const upwardBias = pitch > 28 ? 0.32 : 0;
  const downwardBias = pitch < -28 ? 0.18 : 0;
  const whimsyBudget = clamp(0.45 + repeatedTargetCount * 0.24 + upwardBias + downwardBias, 0.35, 1.6);
  const searchableText = `${targetLabel} ${transitionSummary}`.trim();

  const weighted = DIRECTIVE_RULES.map((rule) => {
    const cueHits = rule.cues.reduce((sum, cue) => sum + (cue.test(searchableText) ? 1 : 0), 0);
    const cueWeight = cueHits * 0.38;
    const repeatBoost =
      rule.category === "altitudeDrift" && pitch > 28 ? repeatedTargetCount * 0.2 : repeatedTargetCount * 0.07;
    return {
      item: rule,
      weight: rule.baseWeight + cueWeight + repeatBoost,
    };
  });

  const primary = weightedPick(weighted) ?? DIRECTIVE_RULES[0];
  const modifierCandidates = weighted
    .filter((entry) => entry.item.category !== primary.category)
    .map((entry) => ({
      item: entry.item,
      weight: entry.weight * (0.22 + whimsyBudget * 0.25),
    }));
  const modifier = weightedPick(modifierCandidates);
  const chosenExamples = [...primary.examples, ...(modifier ? modifier.examples.slice(0, 1) : [])].slice(0, 2);

  const lines = [
    "Dynamic transition directives (broad, click-driven, whimsical):",
    `- Primary directive: ${primary.instruction}`,
    modifier ? `- Modifier directive: ${modifier.instruction}` : "",
    `- Whimsy budget: ${whimsyBudget.toFixed(2)} (higher allows stronger surreal leaps while keeping at least one continuity anchor).`,
    "- Keep click semantics central: what was clicked should feel causally responsible for the next scene.",
    ...chosenExamples.map((example) => `- Example: ${example}`),
  ];
  return lines.filter(Boolean).join("\n");
}

function buildVisionInstruction(
  worldPrompt: string,
  pitch: number,
  yaw: number,
  goal: Goal | null
): string {
  const base = [
    "You are powering a surreal click-to-enter 360 explorer.",
    "You are given two images in order: (1) the full equirectangular panorama for this viewpoint; (2) a square crop centered on the user's click.",
    "Infer the clicked visual target primarily from image 2 (the crop); use image 1 for overall scene context.",
    `World description: ${worldPrompt}`,
    `The user clicked at pitch ${pitch.toFixed(1)} degrees and yaw ${yaw.toFixed(1)} degrees (aligned with the center of image 2).`,
    "If the target is a window, doorway, mirror, screen, painting, poster, object, texture, or abstract detail, the next view should enter or pass through that target imaginatively.",
  ];

  if (!goal) {
    base.push(
      "Return only valid JSON with these keys:",
      `{"target_label":"short noun phrase","transition_summary":"one sentence","destination_prompt":"detailed prompt for a seamless 360-degree equirectangular panorama destination"}`,
      "The destination prompt should keep one continuity anchor from image 1, but it may take whimsical leaps based on the clicked semantic target from image 2.",
      "Few-shot style anchors (adapt, do not copy literally): mirror -> reflected counterpart world; door/window -> threshold crossing; repeated sky/upward clicks -> altitude escalation toward space; texture/object click -> micro detail expands into macro environment.",
      "Base destination_prompt primarily on image 2 (the crop), using image 1 for continuity."
    );
    return base.join("\n");
  }

  base.push(
    "",
    "This is also a hidden goal-finding game.",
    `Current move count (informational): ${goal.moves + 1}.`,
    "No stage-gating: allow whimsical exploration at any move.",
    "",
    "Continue the 360 world in the direction indicated by image 2 (the crop). Use that crop as the main local continuation signal. Do not turn the world into a maze toward the target.",
    "Few-shot style anchors (adapt, do not copy literally): mirror -> reflected counterpart world; door/window -> threshold crossing; repeated sky/upward clicks -> altitude escalation toward space; texture/object click -> micro detail expands into macro environment.",
    "",
    `STRICT WIN CHECK: using image 1 (the full panorama only), decide if ${goal.target} is unmistakably present.`,
    `Set "goal_visible" to true ONLY IF ALL of the following hold:`,
    `  - A clear, identifiable instance of ${goal.target} occupies a visible portion of the panorama (not a tiny distant speck, not just a logo, not a reflection-only).`,
    `  - The shape, color, and context match ${goal.target} so a player would point at it and say "there it is".`,
    `  - It is the actual ${goal.target}, not a similar-looking object, a partial part, a silhouette, a sign or label naming it, or a picture/painting/poster of it.`,
    `Set "goal_visible" to false for: faint outlines, "maybe in the mist/fog", barely-suggested forms, theme-only mood, lookalikes, signage, or any uncertainty.`,
    `When true, "goal_evidence" MUST be a concrete short phrase naming what is seen and where (e.g. "center-left, full ${goal.target} body and base clearly visible, sharp colors"). When false, "goal_evidence" MUST be an empty string.`,
    `When in doubt, return false.`,
    "",
    "Return ONLY valid JSON with these keys:",
    `{"target_label":"short noun phrase","transition_summary":"one sentence","destination_prompt":"detailed prompt for a seamless 360-degree equirectangular panorama destination","goal_visible":true|false,"goal_evidence":"concrete phrase if true, empty string if false"}`,
    "The destination prompt must preserve the source world's style when useful, but it may enter impossible spaces such as a painting's world.",
    "The destination prompt should be click-semantic first, with whimsical freedom."
  );

  return base.join("\n");
}

function extractResponseText(data: OpenAIResponse): string {
  if (data.output_text) return data.output_text;
  const text = data.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .join("\n")
    .trim();
  return text ?? "";
}

function parseJsonObject(text: string): VisionTargetResponse {
  try {
    return JSON.parse(text) as VisionTargetResponse;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Vision response did not include JSON");
    return JSON.parse(match[0]) as VisionTargetResponse;
  }
}

function loadImage(sourceImageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load source panorama for crop"));
    image.src = sourceImageUrl;
  });
}

function normalizeYaw(yaw: number): number {
  return ((((yaw + 180) % 360) + 360) % 360) - 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function cropClickTargetImage({
  sourceImageUrl,
  pitch,
  yaw,
}: {
  sourceImageUrl: string;
  pitch: number;
  yaw: number;
}): Promise<string> {
  const image = await loadImage(sourceImageUrl);
  const outputSize = 320;
  const sourceCropSize = Math.round(Math.min(image.width / 8, image.height / 3, 420));
  const centerX = ((normalizeYaw(yaw) + 180) / 360) * image.width;
  const centerY = ((90 - clamp(pitch, -90, 90)) / 180) * image.height;
  const sourceY = clamp(centerY - sourceCropSize / 2, 0, image.height - sourceCropSize);

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Failed to create image crop context");

  const sourceX = centerX - sourceCropSize / 2;
  if (sourceX < 0) {
    const leftWidth = -sourceX;
    const rightWidth = sourceCropSize - leftWidth;
    context.drawImage(
      image,
      image.width - leftWidth,
      sourceY,
      leftWidth,
      sourceCropSize,
      0,
      0,
      (leftWidth / sourceCropSize) * outputSize,
      outputSize
    );
    context.drawImage(
      image,
      0,
      sourceY,
      rightWidth,
      sourceCropSize,
      (leftWidth / sourceCropSize) * outputSize,
      0,
      (rightWidth / sourceCropSize) * outputSize,
      outputSize
    );
  } else if (sourceX + sourceCropSize > image.width) {
    const rightWidth = image.width - sourceX;
    const leftWidth = sourceCropSize - rightWidth;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      rightWidth,
      sourceCropSize,
      0,
      0,
      (rightWidth / sourceCropSize) * outputSize,
      outputSize
    );
    context.drawImage(
      image,
      0,
      sourceY,
      leftWidth,
      sourceCropSize,
      (rightWidth / sourceCropSize) * outputSize,
      0,
      (leftWidth / sourceCropSize) * outputSize,
      outputSize
    );
  } else {
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceCropSize,
      sourceCropSize,
      0,
      0,
      outputSize,
      outputSize
    );
  }

  return canvas.toDataURL("image/png");
}

async function analyzeClickTargetWithCrop({
  worldPrompt,
  sourceImageUrl,
  pitch,
  yaw,
  goal,
  signal,
}: {
  worldPrompt: string;
  sourceImageUrl: string;
  pitch: number;
  yaw: number;
  goal: Goal | null;
  signal?: AbortSignal;
}): Promise<{
  targetLabel: string;
  transitionSummary: string;
  destinationPrompt: string;
  goalVisible: boolean;
  goalEvidence: string;
  targetCropUrl: string;
}> {
  const targetCropUrl = await cropClickTargetImage({ sourceImageUrl, pitch, yaw });
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildVisionInstruction(worldPrompt, pitch, yaw, goal) },
            { type: "input_image", image_url: sourceImageUrl, detail: "low" },
            { type: "input_image", image_url: targetCropUrl, detail: "low" },
          ],
        },
      ],
    }),
  });

  const data = (await response.json().catch(() => ({}))) as OpenAIResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI target analysis failed");
  }

  const parsed = parseJsonObject(extractResponseText(data));
  const targetLabel = parsed.target_label?.trim() || "clicked target";
  const transitionSummary =
    parsed.transition_summary?.trim() || `Entered ${targetLabel} from the previous panorama.`;
  const destinationPrompt = parsed.destination_prompt?.trim();
  if (!destinationPrompt) {
    throw new Error("Vision response did not include a destination prompt");
  }
  const goalEvidenceRaw = parsed.goal_evidence?.trim() || "";
  const goalEvidence = goal ? goalEvidenceRaw : "";
  const goalVisible = Boolean(goal && parsed.goal_visible === true && goalEvidence.length >= 12);

  return {
    targetLabel,
    transitionSummary,
    destinationPrompt,
    goalVisible,
    goalEvidence,
    targetCropUrl,
  };
}

async function generateImage(prompt: string): Promise<string> {
  const response = await fetch(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt,
      n: 1,
      size: "1536x1024",
      quality: "medium",
      output_format: "png",
    }),
  });

  const data = (await response.json().catch(() => ({}))) as OpenAIImageResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI image generation failed");
  }

  const image = data.data?.[0];
  if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;
  if (image?.url) return image.url;
  throw new Error("OpenAI response did not include an image");
}

async function generateImageFromReferences({
  prompt,
  sourceImageUrl,
  targetCropUrl,
  quality = "low",
  signal,
}: {
  prompt: string;
  sourceImageUrl: string;
  targetCropUrl: string;
  quality?: "low" | "medium";
  signal?: AbortSignal;
}): Promise<string> {
  const response = await fetch(OPENAI_IMAGE_EDITS_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      images: [{ image_url: sourceImageUrl }, { image_url: targetCropUrl }],
      prompt,
      n: 1,
      size: "1536x1024",
      quality,
      output_format: "png"
    }),
  });

  const data = (await response.json().catch(() => ({}))) as OpenAIImageResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI referenced image generation failed");
  }

  const image = data.data?.[0];
  if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;
  if (image?.url) return image.url;
  throw new Error("OpenAI response did not include an image");
}

async function nodePayload(world: World, nodeId: string, cacheHit: boolean): Promise<NodePayload> {
  const node = world.nodes[nodeId];
  if (!isGraphNode(node)) throw new Error("Node not found");

  let imageUrl = await getImage(imageKey(world.world_id, nodeId));
  if (!imageUrl && node.legacy?.x !== undefined && node.legacy?.y !== undefined) {
    imageUrl = await getImage(legacyImageKey(world.world_id, node.legacy.x, node.legacy.y));
    if (imageUrl) await putImage(imageKey(world.world_id, nodeId), imageUrl);
  }
  if (!imageUrl) {
    imageUrl = await generateImage(node.prompt);
    await putImage(imageKey(world.world_id, nodeId), imageUrl);
  }

  return {
    worldId: world.world_id,
    nodeId,
    parentNodeId: node.parent_id,
    imageUrl,
    cacheHit,
    promptUsed: node.prompt,
    target: node.target,
    goal: world.goal ? withShortLabels(world.goal) : null,
  };
}

async function getOrCreateOrigin(world: World): Promise<NodePayload> {
  const existingOrigin = world.nodes[ORIGIN_NODE_ID];
  if (isGraphNode(existingOrigin)) {
    return nodePayload(world, ORIGIN_NODE_ID, true);
  }

  if (!world.goal) {
    const hint = world.prompt?.trim() || undefined;
    world.goal = await generateGoal(hint);
  } else {
    world.goal = withShortLabels(world.goal);
  }
  const prompt = buildOriginPrompt(world.goal);
  const imageUrl = await generateImage(prompt);
  await putImage(imageKey(world.world_id, ORIGIN_NODE_ID), imageUrl);
  world.nodes[ORIGIN_NODE_ID] = {
    id: ORIGIN_NODE_ID,
    parent_id: null,
    prompt,
    created_at: new Date().toISOString(),
    target: null,
  };
  await upsertWorld(world);
  return nodePayload(world, ORIGIN_NODE_ID, false);
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function startWorld(prompt: string): Promise<NodePayload> {
  const userHint = prompt.trim();
  const worldId = userHint
    ? worldIdFromPrompt(userHint)
    : worldIdFromPrompt(`game:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`);
  const worlds = await readWorlds();
  const existingWorld = userHint ? worlds.find((world) => world.world_id === worldId) : undefined;
  const world: World = existingWorld ?? {
    world_id: worldId,
    prompt: userHint,
    normalized_prompt: normalizePrompt(userHint),
    created_at: new Date().toISOString(),
    grid: { movement: "free_click_graph" },
    nodes: {},
    edges: {},
  };

  await upsertWorld(world);
  return getOrCreateOrigin(world);
}

export async function getWorldNode(worldId: string, nodeId = ORIGIN_NODE_ID): Promise<NodePayload> {
  const world = await readWorld(worldId);
  if (!world) throw new Error("World not found");
  if (nodeId === ORIGIN_NODE_ID) return getOrCreateOrigin(world);
  return nodePayload(world, nodeId, true);
}

export async function enterTarget({
  worldId,
  parentNodeId,
  sourceImageUrl,
  pitch,
  yaw,
  onProgress,
  signal,
}: {
  worldId: string;
  parentNodeId: string;
  sourceImageUrl: string;
  pitch: number;
  yaw: number;
  onProgress?: (status: "inspect" | "generate") => void;
  signal?: AbortSignal;
}): Promise<NodePayload> {
  const world = await readWorld(worldId);
  if (!world) throw new Error("World not found");

  const edgeKey = clickEdgeKey(parentNodeId, pitch, yaw);
  const existingNodeId = world.edges?.[edgeKey];
  if (existingNodeId && isGraphNode(world.nodes[existingNodeId])) {
    return nodePayload(world, existingNodeId, true);
  }

  if (!isGraphNode(world.nodes[parentNodeId])) throw new Error("Current node not found");

  const quantizedPitch = quantizeAngle(pitch);
  const quantizedYaw = quantizeAngle(yaw);
  const goalSnapshot = world.goal ?? null;
  onProgress?.("inspect");
  const vision = await analyzeClickTargetWithCrop({
    worldPrompt: world.prompt,
    sourceImageUrl,
    pitch,
    yaw,
    goal: goalSnapshot,
    signal,
  });
  const { targetLabel, targetCropUrl, transitionSummary } = vision;

  if (world.goal && !world.goal.won && vision.goalVisible) {
    world.goal = {
      ...world.goal,
      won: true,
      wonAt: new Date().toISOString(),
      wonEvidence:
        vision.goalEvidence || `${world.goal.target} was visible in the previous view.`,
    };
  }

  const dynamicDirectiveSuffix = buildDynamicDirectiveSuffix({
    targetLabel: vision.targetLabel,
    transitionSummary: vision.transitionSummary,
    pitch,
    recentClicks: world.recent_clicks,
    goal: world.goal ?? null,
  });
  const destinationPrompt = [
    vision.destinationPrompt,
    `Transition: ${vision.transitionSummary}`,
    `Clicked target: ${vision.targetLabel}.`,
    dynamicDirectiveSuffix,
    "Generate a seamless full 360-degree equirectangular panorama, 2:1 aspect ratio, immersive street-view style environment, no text, no UI, no borders.",
  ]
    .filter(Boolean)
    .join("\n");
  const nodeId = nodeIdFromEdge(world.world_id, edgeKey);
  onProgress?.("generate");
  const imageUrl = await generateImageFromReferences({
    prompt: destinationPrompt,
    sourceImageUrl,
    targetCropUrl,
    quality: "low",
    signal,
  });

  world.nodes[nodeId] = {
    id: nodeId,
    parent_id: parentNodeId,
    prompt: destinationPrompt,
    created_at: new Date().toISOString(),
    target: {
      targetLabel,
      transitionSummary,
      quantizedPitch,
      quantizedYaw,
    },
  };
  world.edges = { ...(world.edges ?? {}), [edgeKey]: nodeId };
  if (world.goal) {
    world.goal = { ...world.goal, moves: world.goal.moves + 1 };
  }
  world.recent_clicks = [
    ...(world.recent_clicks ?? []).slice(-7),
    {
      target: targetLabel,
      pitch,
      yaw,
      at: new Date().toISOString(),
    },
  ];
  await putImage(imageKey(world.world_id, nodeId), imageUrl);
  await upsertWorld(world);

  return {
    worldId: world.world_id,
    nodeId,
    parentNodeId,
    imageUrl,
    cacheHit: false,
    promptUsed: destinationPrompt,
    target: world.nodes[nodeId].target ?? null,
    goal: world.goal ? withShortLabels(world.goal) : null,
  };
}

export async function markGoalFound(worldId: string): Promise<Goal> {
  const world = await readWorld(worldId);
  if (!world) throw new Error("World not found");
  if (!world.goal) throw new Error("This world has no active goal");
  if (!world.goal.won) {
    world.goal = withShortLabels({
      ...world.goal,
      won: true,
      wonAt: new Date().toISOString(),
      wonEvidence: world.goal.wonEvidence || "Manually marked as found.",
    });
    await upsertWorld(world);
  }
  return withShortLabels(world.goal);
}

export async function getWorldHistory(): Promise<WorldHistoryResponse> {
  const worlds = (await readWorlds()).sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );

  const summaries = await Promise.all(
    worlds.map(async (world): Promise<WorldSummary> => {
      const originNode = world.nodes[ORIGIN_NODE_ID];
      let originImage = originNode ? await getImage(imageKey(world.world_id, ORIGIN_NODE_ID)) : null;
      if (!originImage && isGraphNode(originNode) && originNode.legacy?.x !== undefined && originNode.legacy?.y !== undefined) {
        originImage = await getImage(legacyImageKey(world.world_id, originNode.legacy.x, originNode.legacy.y));
      }
      const goal = world.goal ? withShortLabels(world.goal) : null;
      return {
        world_id: world.world_id,
        prompt: world.prompt,
        prompt_preview: promptPreview(world.prompt),
        created_at: world.created_at,
        node_count: Object.keys(world.nodes).length,
        origin_image_url: originImage,
        goal_origin: goal?.origin ?? null,
        goal_target: goal?.target ?? null,
        goal_origin_short: goal?.originShort ?? null,
        goal_target_short: goal?.targetShort ?? null,
        goal_theme: goal?.theme ?? null,
        goal_moves: goal?.moves ?? null,
        goal_won: goal?.won ?? null,
      };
    })
  );

  return { worlds: summaries };
}

export async function getWorldMoveTree(worldId: string): Promise<WorldMoveTreeResponse> {
  const world = await readWorld(worldId);
  if (!world) throw new Error("World not found");
  const currentWorld = world;

  const graphNodes = Object.values(currentWorld.nodes).filter(isGraphNode);
  if (!graphNodes.length) {
    return { world_id: currentWorld.world_id, nodes: [] };
  }

  const childrenByParent = new Map<string, WorldNode[]>();
  for (const node of graphNodes) {
    if (!node.parent_id) continue;
    const siblings = childrenByParent.get(node.parent_id) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parent_id, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort(
      (left, right) =>
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
    );
  }

  const depthById = new Map<string, number>();
  function depthOf(node: WorldNode): number {
    const cached = depthById.get(node.id);
    if (cached !== undefined) return cached;
    if (!node.parent_id) {
      depthById.set(node.id, 0);
      return 0;
    }
    const parent = currentWorld.nodes[node.parent_id];
    const depth = isGraphNode(parent) ? depthOf(parent) + 1 : 1;
    depthById.set(node.id, depth);
    return depth;
  }

  const orderedNodes: WorldNode[] = [];
  const visited = new Set<string>();
  function walk(nodeId: string): void {
    if (visited.has(nodeId)) return;
    const node = currentWorld.nodes[nodeId];
    if (!isGraphNode(node)) return;
    visited.add(nodeId);
    orderedNodes.push(node);
    const children = childrenByParent.get(nodeId) ?? [];
    for (const child of children) {
      walk(child.id);
    }
  }

  walk(ORIGIN_NODE_ID);
  for (const node of graphNodes) {
    walk(node.id);
  }

  const nodes = orderedNodes.map((node, index): MoveTreeNode => ({
    node_id: node.id,
    parent_node_id: node.parent_id,
    created_at: node.created_at,
    depth: depthOf(node),
    step: index,
    target_label: node.target?.targetLabel ?? null,
    is_origin: node.id === ORIGIN_NODE_ID,
  }));

  return { world_id: currentWorld.world_id, nodes };
}
