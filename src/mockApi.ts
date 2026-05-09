const STORAGE_KEY = "grid-360-worlds";
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_MODEL = "gpt-image-1";
const IMAGE_DB_NAME = "grid-360-images";
const IMAGE_DB_STORE = "images";
const IMAGE_DB_VERSION = 1;

export const DEFAULT_PROMPT =
  "A high-quality 360 equirectangular image of a cozy college dorm room. Photorealistic.";

export type Direction = "north" | "south" | "east" | "west";

type Coordinate = {
  x: number;
  y: number;
};

export type NodePayload = {
  worldId: string;
  x: number;
  y: number;
  imageUrl: string;
  neighbors: Record<Direction, Coordinate>;
  cacheHit: boolean;
  promptUsed: string;
};

export type WorldSummary = {
  world_id: string;
  prompt: string;
  prompt_preview: string;
  created_at: string;
  node_count: number;
  origin_image_url: string | null;
};

export type WorldHistoryResponse = {
  worlds: WorldSummary[];
};

// imageUrl is intentionally absent — images live in IndexedDB, not localStorage
type WorldNode = {
  x: number;
  y: number;
  prompt: string;
  created_at: string;
  last_move: Direction | null;
};

type World = {
  world_id: string;
  prompt: string;
  normalized_prompt: string;
  created_at: string;
  grid: { movement: "cardinal_4" };
  nodes: Record<string, WorldNode>;
};

const DIRECTION_DELTAS: Record<Direction, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

type OpenAIImageResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
};

// ── IndexedDB image store ──────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openImageDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IMAGE_DB_STORE);
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

function imageKey(worldId: string, x: number, y: number): string {
  return `${worldId}/${x},${y}`;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function getApiKey(): string {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
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

function nodeKey(x: number, y: number): string {
  return `${x},${y}`;
}

function coordLabel(x: number, y: number): string {
  if (x === 0 && y === 0) return "the origin point of this world";
  const xPart =
    x > 0 ? `${x} blocks east` : x < 0 ? `${Math.abs(x)} blocks west` : "the center column";
  const yPart =
    y > 0 ? `${y} blocks south` : y < 0 ? `${Math.abs(y)} blocks north` : "the center row";
  return `${xPart}, ${yPart}`;
}

function buildNodePrompt(
  worldPrompt: string,
  x: number,
  y: number,
  lastMove: Direction | null
): string {
  return [
    `World description: ${worldPrompt}`,
    `Current location: ${coordLabel(x, y)}.`,
    lastMove
      ? `Transition: The camera has just moved one block toward ${lastMove}.`
      : "Transition: This is the entry viewpoint for the world.",
    "Keep consistency in art style, weather, geography, lighting, and major landmarks with nearby locations.",
    "Generate a seamless full 360-degree equirectangular panorama, 2:1 aspect ratio, immersive street-view style environment, no text, no UI, no borders.",
  ].join("\n");
}

async function generateImage(prompt: string): Promise<string> {
  console.log("[generateImage] requesting image, prompt length:", prompt.length);
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

  console.log("[generateImage] response status:", response.status);
  const data = (await response.json().catch(() => ({}))) as OpenAIImageResponse;
  if (!response.ok) {
    console.error("[generateImage] OpenAI error:", data.error);
    throw new Error(data.error?.message || "OpenAI image generation failed");
  }

  const image = data.data?.[0];
  console.log("[generateImage] image keys:", image ? Object.keys(image) : "none");
  if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;
  if (image?.url) return image.url;
  throw new Error("OpenAI response did not include an image");
}

function neighborsFor(x: number, y: number): Record<Direction, Coordinate> {
  return Object.fromEntries(
    Object.entries(DIRECTION_DELTAS).map(([direction, [dx, dy]]) => [
      direction,
      { x: x + dx, y: y + dy },
    ])
  ) as Record<Direction, Coordinate>;
}

function promptPreview(prompt: string): string {
  return prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
}

// ── localStorage (metadata only, no images) ────────────────────────────────

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

function readWorlds(): World[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isWorld) : [];
  } catch {
    return [];
  }
}

function writeWorlds(worlds: World[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(worlds));
}

function upsertWorld(nextWorld: World): void {
  const worlds = readWorlds();
  const index = worlds.findIndex((world) => world.world_id === nextWorld.world_id);
  if (index >= 0) {
    worlds[index] = nextWorld;
  } else {
    worlds.unshift(nextWorld);
  }
  writeWorlds(worlds);
}

// ── Node helpers ───────────────────────────────────────────────────────────

async function getOrCreateNode(
  world: World,
  x: number,
  y: number,
  lastMove: Direction | null = null
): Promise<NodePayload> {
  const key = nodeKey(x, y);
  const idbKey = imageKey(world.world_id, x, y);
  const existingNode = world.nodes[key];

  if (existingNode) {
    const cachedImage = await getImage(idbKey);
    if (cachedImage) {
      console.log(`[getOrCreateNode] cache hit (${x},${y})`);
      return {
        worldId: world.world_id,
        x,
        y,
        imageUrl: cachedImage,
        neighbors: neighborsFor(x, y),
        cacheHit: true,
        promptUsed: existingNode.prompt,
      };
    }
    // Metadata exists but image was lost from IndexedDB — regenerate
    console.warn(`[getOrCreateNode] metadata exists for (${x},${y}) but image missing from IndexedDB, regenerating`);
    const imageUrl = await generateImage(existingNode.prompt);
    await putImage(idbKey, imageUrl);
    return {
      worldId: world.world_id,
      x,
      y,
      imageUrl,
      neighbors: neighborsFor(x, y),
      cacheHit: false,
      promptUsed: existingNode.prompt,
    };
  }

  // New node
  const prompt = buildNodePrompt(world.prompt, x, y, lastMove);
  console.log(`[getOrCreateNode] generating new node (${x},${y}), lastMove:`, lastMove);
  const imageUrl = await generateImage(prompt);
  await putImage(idbKey, imageUrl);
  console.log(`[getOrCreateNode] image saved to IndexedDB for (${x},${y})`);

  world.nodes[key] = {
    x,
    y,
    prompt,
    created_at: new Date().toISOString(),
    last_move: lastMove,
  };
  upsertWorld(world);

  return {
    worldId: world.world_id,
    x,
    y,
    imageUrl,
    neighbors: neighborsFor(x, y),
    cacheHit: false,
    promptUsed: prompt,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function startWorld(prompt: string): Promise<NodePayload> {
  const worldPrompt = prompt.trim() || DEFAULT_PROMPT;
  const worldId = worldIdFromPrompt(worldPrompt);
  console.log("[startWorld] prompt:", JSON.stringify(worldPrompt));
  console.log("[startWorld] worldId:", worldId);

  const worlds = readWorlds();
  console.log("[startWorld] worlds in storage:", worlds.length);

  const existingWorld = worlds.find((world) => world.world_id === worldId);
  console.log(
    "[startWorld] existingWorld:",
    existingWorld
      ? `found (${Object.keys(existingWorld.nodes).length} nodes)`
      : "none — creating new"
  );

  const world: World = existingWorld ?? {
    world_id: worldId,
    prompt: worldPrompt,
    normalized_prompt: normalizePrompt(worldPrompt),
    created_at: new Date().toISOString(),
    grid: { movement: "cardinal_4" },
    nodes: {},
  };

  upsertWorld(world);
  console.log("[startWorld] upserted world, fetching origin node (0,0)...");

  try {
    const payload = await getOrCreateNode(world, 0, 0, null);
    console.log(
      "[startWorld] origin node ready, cacheHit:",
      payload.cacheHit,
      "imageUrl length:",
      payload.imageUrl.length
    );
    return payload;
  } catch (err) {
    console.error("[startWorld] failed to get/create origin node:", err);
    throw err;
  }
}

export async function getWorldNode(worldId: string, x = 0, y = 0): Promise<NodePayload> {
  const world = readWorlds().find((item) => item.world_id === worldId);
  if (!world) throw new Error("World not found");

  return getOrCreateNode(world, Number(x), Number(y), null);
}

export async function moveWorld({
  worldId,
  x,
  y,
  direction,
}: {
  worldId: string;
  x: number;
  y: number;
  direction: Direction;
}): Promise<NodePayload> {
  const [dx, dy] = DIRECTION_DELTAS[direction];

  const world = readWorlds().find((item) => item.world_id === worldId);
  if (!world) throw new Error("World not found");

  return getOrCreateNode(world, Number(x) + dx, Number(y) + dy, direction);
}

export async function getWorldHistory(): Promise<WorldHistoryResponse> {
  const worlds = readWorlds().sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );

  const summaries = await Promise.all(
    worlds.map(async (world): Promise<WorldSummary> => {
      const originImage = world.nodes[nodeKey(0, 0)]
        ? await getImage(imageKey(world.world_id, 0, 0))
        : null;
      return {
        world_id: world.world_id,
        prompt: world.prompt,
        prompt_preview: promptPreview(world.prompt),
        created_at: world.created_at,
        node_count: Object.keys(world.nodes).length,
        origin_image_url: originImage,
      };
    })
  );

  return { worlds: summaries };
}
