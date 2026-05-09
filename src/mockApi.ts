const STORAGE_KEY = "grid-360-worlds";
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
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
  moves: number;
  won: boolean;
  wonAt?: string;
  wonEvidence?: string;
};

export type GoalStage = "vague" | "stronger" | "reveal";

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
  goal_theme: string | null;
  goal_moves: number | null;
  goal_won: boolean | null;
};

export type WorldHistoryResponse = {
  worlds: WorldSummary[];
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
    `The player is secretly searching for: ${goal.target}. Do NOT include the target or its obvious parts in this opening view.`,
    "Generate a seamless full 360-degree equirectangular panorama, 2:1 aspect ratio, immersive street-view style environment, no text, no UI, no borders.",
  ].join("\n");
}

const GOAL_FALLBACKS: Array<Pick<Goal, "origin" | "target" | "theme">> = [
  {
    origin: "an abandoned shopping mall, dim flickering fluorescent lights, dusty escalators",
    target: "a blue grand piano",
    theme: "music, melancholy, dust",
  },
  {
    origin: "a quiet snowy alpine village at dusk, warm lit windows, fresh snowfall",
    target: "a vintage red telephone booth",
    theme: "communication, nostalgia, isolation",
  },
  {
    origin: "a sprawling neon-lit night market in a futuristic city",
    target: "a centuries-old jade dragon statue",
    theme: "tradition meeting future, jade green, incense",
  },
  {
    origin: "an overgrown botanical garden inside a derelict glasshouse",
    target: "an astronaut helmet on a pedestal",
    theme: "exploration, oxygen, distant stars",
  },
  {
    origin: "a coastal lighthouse and its keeper's cottage on a stormy night",
    target: "a hot air balloon basket",
    theme: "flight, ropes, woven baskets, sky",
  },
];

function pickFallbackGoal(): Pick<Goal, "origin" | "target" | "theme"> {
  return GOAL_FALLBACKS[Math.floor(Math.random() * GOAL_FALLBACKS.length)];
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
      "Pick a TARGET that is a specific, visually distinctive object, person, or landmark that does NOT naturally belong in that origin.",
      "Pick a THEME: 3-8 words of hidden steering vocabulary that semantically links the origin toward the target (mood, materials, motifs)."
    );
  } else {
    lines.push(
      "No user description provided. Invent something fresh and surprising.",
      "Pick an ORIGIN that is evocative and visually rich (a place, building, or environment).",
      "Pick a TARGET that is a specific, visually distinctive object, person, or landmark that does NOT naturally belong in the origin.",
      "Pick a THEME: 3-8 words of hidden steering vocabulary that semantically links the origin toward the target (mood, materials, motifs)."
    );
  }
  lines.push(
    "Return ONLY valid JSON with these exact keys, no commentary:",
    `{"origin":"...","target":"...","theme":"..."}`
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
    ) as { origin?: string; target?: string; theme?: string };

    const origin = parsed.origin?.trim();
    const target = parsed.target?.trim();
    const theme = parsed.theme?.trim();
    if (!origin || !target || !theme) throw new Error("Goal response missing fields");

    return { origin, target, theme, moves: 0, won: false };
  } catch {
    const fallback = pickFallbackGoal();
    return { ...fallback, moves: 0, won: false };
  }
}

const GOAL_VAGUE_MAX_MOVES = 2;
const GOAL_STRONGER_MAX_MOVES = 5;

function goalStage(moves: number): GoalStage {
  if (moves <= GOAL_VAGUE_MAX_MOVES) return "vague";
  if (moves <= GOAL_STRONGER_MAX_MOVES) return "stronger";
  return "reveal";
}

function buildVisionInstruction(
  worldPrompt: string,
  pitch: number,
  yaw: number,
  goal: Goal | null
): string {
  const base = [
    "You are powering a surreal click-to-enter 360 explorer.",
    `World description: ${worldPrompt}`,
    `The user clicked the current panorama at pitch ${pitch.toFixed(1)} degrees and yaw ${yaw.toFixed(1)} degrees.`,
    "Inspect the image and infer the most likely clicked visual target at that location.",
    "If the target is a window, doorway, mirror, screen, painting, poster, object, texture, or abstract detail, the next view should enter or pass through that target imaginatively.",
  ];

  if (!goal) {
    base.push(
      "Return only valid JSON with these keys:",
      `{"target_label":"short noun phrase","transition_summary":"one sentence","destination_prompt":"detailed prompt for a seamless 360-degree equirectangular panorama destination"}`,
      "The destination prompt must preserve the source world's style when useful, but it may enter impossible spaces such as a painting's world."
    );
    return base.join("\n");
  }

  const stage = goalStage(goal.moves);
  base.push(
    "",
    "This is also a hidden goal-finding game.",
    `World origin: ${goal.origin}.`,
    `The player is secretly searching for: ${goal.target}.`,
    `Hidden steering theme: ${goal.theme}.`,
    `Current move count (this click is move ${goal.moves + 1}). Stage: ${stage}.`,
    "",
    "Drift policy:",
    `  - vague (moves 0-${GOAL_VAGUE_MAX_MOVES}):     do NOT depict ${goal.target} or its parts. Only optional vague mood from the theme.`,
    `  - stronger (moves ${GOAL_VAGUE_MAX_MOVES + 1}-${GOAL_STRONGER_MAX_MOVES}):  add subtle environmental hints related to the theme. Still no explicit target.`,
    `  - reveal (moves ${GOAL_STRONGER_MAX_MOVES + 1}+):     if the clicked direction reasonably supports it, you MAY include ${goal.target} naturally. Do not force it; preserve dreamlike free exploration.`,
    "",
    "Continue the 360 world in the direction indicated by the clicked screenshot region. Use the clicked region as the main local continuation signal. Do not turn the world into a maze toward the target.",
    "",
    `STRICT WIN CHECK: also inspect the CURRENT image and decide if ${goal.target} is unmistakably present.`,
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
    "The destination prompt must respect the drift policy for the current stage."
  );

  return base.join("\n");
}

function buildDriftSuffix(goal: Goal | null): string {
  if (!goal) return "";
  const stage = goalStage(goal.moves);
  if (stage === "vague") {
    return `Do NOT include ${goal.target} or its obvious parts. Maintain a coherent continuation of the current world's style.`;
  }
  if (stage === "stronger") {
    return `Subtly hint at the theme "${goal.theme}" through lighting, props, distant suggestions, or atmosphere. Do not depict ${goal.target} directly.`;
  }
  return `You may include ${goal.target} naturally in the scene if the clicked direction supports it; otherwise hint strongly toward the theme "${goal.theme}".`;
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

async function analyzeClickTarget({
  worldPrompt,
  sourceImageUrl,
  pitch,
  yaw,
  goal,
}: {
  worldPrompt: string;
  sourceImageUrl: string;
  pitch: number;
  yaw: number;
  goal: Goal | null;
}): Promise<{
  targetLabel: string;
  transitionSummary: string;
  destinationPrompt: string;
  goalVisible: boolean;
  goalEvidence: string;
}> {
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
            { type: "input_text", text: buildVisionInstruction(worldPrompt, pitch, yaw, goal) },
            { type: "input_image", image_url: sourceImageUrl, detail: "low" },
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
  const goalEvidence = parsed.goal_evidence?.trim() || "";
  const goalVisible = parsed.goal_visible === true && goalEvidence.length >= 12;

  return { targetLabel, transitionSummary, destinationPrompt, goalVisible, goalEvidence };
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
    goal: world.goal ?? null,
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
}: {
  worldId: string;
  parentNodeId: string;
  sourceImageUrl: string;
  pitch: number;
  yaw: number;
  onProgress?: (status: "inspect" | "generate") => void;
}): Promise<NodePayload> {
  const world = await readWorld(worldId);
  if (!world) throw new Error("World not found");

  const edgeKey = clickEdgeKey(parentNodeId, pitch, yaw);
  const existingNodeId = world.edges?.[edgeKey];
  if (existingNodeId && isGraphNode(world.nodes[existingNodeId])) {
    return nodePayload(world, existingNodeId, true);
  }

  const quantizedPitch = quantizeAngle(pitch);
  const quantizedYaw = quantizeAngle(yaw);
  const goalSnapshot = world.goal ?? null;
  onProgress?.("inspect");
  const analysis = await analyzeClickTarget({
    worldPrompt: world.prompt,
    sourceImageUrl,
    pitch,
    yaw,
    goal: goalSnapshot,
  });

  if (world.goal && !world.goal.won && analysis.goalVisible) {
    world.goal = {
      ...world.goal,
      won: true,
      wonAt: new Date().toISOString(),
      wonEvidence: analysis.goalEvidence || `${world.goal.target} was visible in the previous view.`,
    };
  }

  const driftSuffix = buildDriftSuffix(world.goal ?? null);
  const destinationPrompt = [
    analysis.destinationPrompt,
    `Transition: ${analysis.transitionSummary}`,
    `Clicked target: ${analysis.targetLabel}.`,
    driftSuffix,
    "Generate a seamless full 360-degree equirectangular panorama, 2:1 aspect ratio, immersive street-view style environment, no text, no UI, no borders.",
  ]
    .filter(Boolean)
    .join("\n");
  const nodeId = nodeIdFromEdge(world.world_id, edgeKey);
  onProgress?.("generate");
  const imageUrl = await generateImage(destinationPrompt);

  world.nodes[nodeId] = {
    id: nodeId,
    parent_id: parentNodeId,
    prompt: destinationPrompt,
    created_at: new Date().toISOString(),
    target: {
      targetLabel: analysis.targetLabel,
      transitionSummary: analysis.transitionSummary,
      quantizedPitch,
      quantizedYaw,
    },
  };
  world.edges = { ...(world.edges ?? {}), [edgeKey]: nodeId };
  if (world.goal) {
    world.goal = { ...world.goal, moves: world.goal.moves + 1 };
  }
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
    goal: world.goal ?? null,
  };
}

export async function markGoalFound(worldId: string): Promise<Goal> {
  const world = await readWorld(worldId);
  if (!world) throw new Error("World not found");
  if (!world.goal) throw new Error("This world has no active goal");
  if (!world.goal.won) {
    world.goal = {
      ...world.goal,
      won: true,
      wonAt: new Date().toISOString(),
      wonEvidence: world.goal.wonEvidence || "Manually marked as found.",
    };
    await upsertWorld(world);
  }
  return world.goal;
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
      return {
        world_id: world.world_id,
        prompt: world.prompt,
        prompt_preview: promptPreview(world.prompt),
        created_at: world.created_at,
        node_count: Object.keys(world.nodes).length,
        origin_image_url: originImage,
        goal_origin: world.goal?.origin ?? null,
        goal_target: world.goal?.target ?? null,
        goal_theme: world.goal?.theme ?? null,
        goal_moves: world.goal?.moves ?? null,
        goal_won: world.goal?.won ?? null,
      };
    })
  );

  return { worlds: summaries };
}
