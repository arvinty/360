const STORAGE_KEY = "grid-360-worlds";
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_MODEL = "gpt-image-1.5";

export const DEFAULT_PROMPT =
  "A high-quality 360 equirectangular panorama of a cozy mountain lake at sunset, wide horizontal composition, immersive environment, photorealistic.";

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

type WorldNode = {
  x: number;
  y: number;
  imageUrl: string;
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

function toWorldSummary(world: World): WorldSummary {
  const origin = world.nodes[nodeKey(0, 0)];
  return {
    world_id: world.world_id,
    prompt: world.prompt,
    prompt_preview: promptPreview(world.prompt),
    created_at: world.created_at,
    node_count: Object.keys(world.nodes).length,
    origin_image_url: origin?.imageUrl ?? null,
  };
}

function nodePayload(world: World, x: number, y: number, cacheHit: boolean): NodePayload {
  const node = world.nodes[nodeKey(x, y)];
  if (!node) {
    throw new Error("Node not found");
  }

  return {
    worldId: world.world_id,
    x,
    y,
    imageUrl: node.imageUrl,
    neighbors: neighborsFor(x, y),
    cacheHit,
    promptUsed: node.prompt,
  };
}

function createNode(
  world: World,
  x: number,
  y: number,
  lastMove: Direction | null = null
): { world: World; prompt: string; cachedPayload: NodePayload | null } {
  const key = nodeKey(x, y);
  if (world.nodes[key]) {
    return {
      world,
      prompt: world.nodes[key].prompt,
      cachedPayload: nodePayload(world, x, y, true),
    };
  }

  const prompt = buildNodePrompt(world.prompt, x, y, lastMove);
  return { world, prompt, cachedPayload: null };
}

function saveNode(
  world: World,
  x: number,
  y: number,
  lastMove: Direction | null,
  prompt: string,
  imageUrl: string
): NodePayload {
  const key = nodeKey(x, y);
  const node: WorldNode = {
    x,
    y,
    imageUrl,
    prompt,
    created_at: new Date().toISOString(),
    last_move: lastMove,
  };

  world.nodes[key] = node;
  return nodePayload(world, x, y, false);
}

async function getOrCreateNode(
  world: World,
  x: number,
  y: number,
  lastMove: Direction | null = null
): Promise<NodePayload> {
  const result = createNode(world, x, y, lastMove);
  if (result.cachedPayload) return result.cachedPayload;

  const imageUrl = await generateImage(result.prompt);
  const payload = saveNode(world, x, y, lastMove, result.prompt, imageUrl);
  upsertWorld(world);
  return payload;
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

export async function startWorld(prompt: string): Promise<NodePayload> {
  const worldPrompt = prompt.trim() || DEFAULT_PROMPT;
  const worldId = worldIdFromPrompt(worldPrompt);
  const worlds = readWorlds();
  const existingWorld = worlds.find((world) => world.world_id === worldId);
  const world: World =
    existingWorld ??
    {
      world_id: worldId,
      prompt: worldPrompt,
      normalized_prompt: normalizePrompt(worldPrompt),
      created_at: new Date().toISOString(),
      grid: { movement: "cardinal_4" },
      nodes: {},
    };

  upsertWorld(world);
  return getOrCreateNode(world, 0, 0, null);
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
  const worlds = readWorlds()
    .map(toWorldSummary)
    .sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    );

  return { worlds };
}
