export const SCENARIO_CORE_SYSTEM_PROMPT = `You design frozen-moment crisis scenarios for a panoramic exploration game. The player will read a written mission briefing instead of seeing the destination — so the briefing must make the goal room vividly imaginable from text alone.

Given the player's world prompt, output JSON with these fields ONLY (no rooms, no clues — those are generated separately):

mission_statement: 70-110 words, second person, present tense. Three beats:
  (1) Establish the crisis: what's about to happen, who/what is at stake, what scale of disaster. One or two sentences.
  (2) Describe the goal room with enough specific sensory detail that the player can picture it: dominant materials, light quality, scale, two or three signature objects, color palette, atmosphere. This is the load-bearing part — be precise, not poetic. Concrete nouns.
  (3) State the action and the stakes: what the player does when they arrive and what is averted.
  Cinematic but specific. Plain prose, no markdown, no quotation marks around the briefing.

start_room_descriptor: 30-50 words. The calmest version of this world, before the crisis manifests. Same vocabulary scope as destination_descriptor — palette, materials, light, mood — so an interpolation between them is meaningful.

destination_room_descriptor: 30-50 words. The destination as it appears in the frozen moment. Same vocabulary as start.

gradient_axes: array of 3-5 strings, each in "X to Y" form, naming the visual axes that shift from start to destination. Examples: "warm amber to cold blue", "dry to flooded", "ordered to chaotic", "quiet to alarmed". Be specific to this scenario.

crisis_summary: one sentence naming the disaster, internal use.

step_budget: integer 18-30. Higher for more elaborate scenarios.

descriptor_curve: array of 5 objects {p, descriptor} at p = 0, 0.25, 0.5, 0.75, 1.0. Each descriptor is 25-40 words showing how the room looks at that gradient position, blending start and destination across the gradient_axes. p=0 should match start_room_descriptor; p=1 should match destination_room_descriptor; intermediates show coherent transformation.

art_style: 20-40 words. A precise visual style derived from the player's world prompt. Specify medium (photoreal 35mm film / oil painting / anime cel / watercolor / 3D render / etc.), mood lighting, palette tendencies, level of stylization. This style must be applied uniformly to every room generated for this scenario, so be specific and unambiguous. Do NOT contradict the player's world prompt — if they asked for a watercolor world, this is a watercolor world.

Output valid JSON only. No code fences, no preamble, no commentary. Do not include room_catalog or navigation_clue_sets.`;

export const SCENARIO_ROOMS_SYSTEM_PROMPT = `You design the room catalog for a frozen-moment crisis scenario. The core scenario (mission, descriptors, axes, art style) is provided. Output JSON with one field:

room_catalog: array of EXACTLY 32 distinct named rooms, each {name, concept}. These are the unique rooms that fill the world. Index 0 is the starting room (must align with start_room_descriptor). Index 31 is the goal room (must align with destination_room_descriptor). Indices 1..30 are intermediate rooms — each architecturally and atmospherically DISTINCT from every other room in the catalog. No two rooms share the same dominant feature. Each name is 2-5 evocative words ("the salt observatory", "antechamber of folded mirrors"). Each concept is 12-25 words describing the one or two specific features that make THIS room unmistakable from the others (e.g., "a long bronze table set for nine, every chair toppled but one"). Concepts should fit inside the world's vocabulary and progress loosely from calm (low indices) toward catastrophe (high indices) so they harmonize with the gradient curve, but each is its own place.

Output valid JSON only. No code fences, no preamble, no commentary.`;

export const SCENARIO_CLUES_SYSTEM_PROMPT = `You design navigation clue sets for a frozen-moment crisis scenario. The core scenario is provided. Output JSON with one field:

navigation_clue_sets: array of EXACTLY 32 ranked clue sets, each {class_name, correct_object, decoy_objects}. These are used as physical objects placed in front of the four archways so the player can infer which way leads toward the goal.
  Choose class_name from this list, or a more specific subtype if it clearly belongs to one of these classes: portraits, equations, furniture, chemical elements, books, tools, clocks, keys, maps, musical instruments, masks, statues, gemstones, plants, architectural models, weapons, machines, constellations, weather symbols, food dishes, medical instruments, laboratory glassware, relics, uniforms, flags, toys, chess pieces, tarot cards, circuit boards, fossils, coins, candles, vessels, fabrics, trophies, cameras, lenses, astrolabes, compasses, locks, seeds, shells, minerals, handwritten notes, blueprints, ritual objects, emergency equipment, scientific diagrams.
  Rank the array from best to worst: entry 0 must be the most visually legible, interesting, and riveting four-option clue for this crisis; later entries may be subtler. The best clue classes should work in the rooms the player is most likely to visit.
  For each set, correct_object is the one object most strongly associated with the crisis, destination, solution, or person responsible. The three decoy_objects are plausible members of the same class but clearly wrong. Example for crisis_summary "an atomic bomb": {class_name:"portraits", correct_object:"J. Robert Oppenheimer portrait", decoy_objects:["Isaac Newton portrait","Marie Curie portrait","Ada Lovelace portrait"]}.
  Make all four objects in a set visually distinct at a glance. Avoid near-synonyms, obscure trivia, pure abstractions, and choices that require reading labels. Do not repeat the same correct_object across sets.

Output valid JSON only. No code fences, no preamble, no commentary.`;

export function buildPanoramaPrompt(args: {
  descriptor: string;
  gradientPosition: number;
  axes: string[];
  artStyle: string;
  roomName: string;
  roomConcept: string;
  navigationClues?: Array<{ direction: string; object: string; isCorrect: boolean }>;
}): string {
  const { descriptor, gradientPosition, axes, artStyle, roomName, roomConcept, navigationClues } = args;
  const northClue = navigationClues?.find((c) => c.direction === "N");
  const eastClue = navigationClues?.find((c) => c.direction === "E");
  const southClue = navigationClues?.find((c) => c.direction === "S");
  const westClue = navigationClues?.find((c) => c.direction === "W");
  const cluePrompt = navigationClues && navigationClues.length === 4
    ? `
ARCHWAY CLUE OBJECTS — REQUIRED, NON-OPTIONAL: Each of the four archways has ONE specific physical clue object placed in the room directly in front of it (between the archway and the room center), at floor or pedestal level so it is unmistakable from the panorama center. These are real in-world objects — pedestals, busts, props, framed portraits, instruments, artifacts — sized so they read clearly at a glance from the center of the room. The object is centered horizontally on the archway it belongs to.
  - NORTH archway (image x ≈ 0.50): ${northClue?.object}
  - EAST archway (image x ≈ 0.75): ${eastClue?.object}
  - SOUTH archway (split across image x = 1.0 / 0.0): ${southClue?.object}
  - WEST archway (image x ≈ 0.25): ${westClue?.object}
Each clue object MUST be visually distinct from the others in silhouette, color, and iconography. Do not skip or omit any of the four. Do not add arrows, glow, text labels, or UI treatment to indicate which is correct — the player figures that out from the briefing.
`
    : "";
  return `Equirectangular 360-degree panorama of a single room, frozen moment in time. All motion suspended: dust mid-fall, smoke half-curled, embers paused, droplets hanging, fabric mid-sway.

Art direction (apply uniformly): ${artStyle}

Room identity: this room is "${roomName}". Defining feature: ${roomConcept}. This room MUST be visually distinct from any other room in the same world — lean into its defining feature so a viewer could tell it apart from sibling rooms at a glance.

Setting context: ${descriptor}

Architecture: the room has EXACTLY FOUR archways and no more, one in each of the four cardinal walls (north, east, south, west). Do not include a fifth archway. Do not include doors, windows, or extra openings — only the four archways. The walls between the archways are unbroken and solid.

Archway placement in this equirectangular image is precise and required. Image x = 0 is the LEFT EDGE and image x = 1.0 is the RIGHT EDGE. The archways must be horizontally centered exactly at:
  • NORTH archway — at image center, x = 0.50 (50% from the left edge).
  • EAST archway — at x = 0.75 (75% from the left edge).
  • SOUTH archway — straddling the wrap seam; its left half at x = 1.0 (the right edge) and its right half at x = 0.0 (the left edge), so the full archway is split across the two edges.
  • WEST archway — at x = 0.25 (25% from the left edge).
All four archways are at eye level (the vertical center of the equirectangular image, y = 0.5). Archways are uniform in width and height. Between each pair of adjacent archways the wall is fully solid with no openings. Through each archway a glimpse of a different adjacent room is visible, each glimpse subtly different in palette and detail along these axes: ${axes.join("; ")}. The current room sits at gradient position ${Math.round(gradientPosition * 100)}% along the start-to-catastrophe progression.
${cluePrompt}

No living people in foreground, no labels, no UI elements, no logos.`;
}

export function buildContinuityPostfix(direction: string): string {
  return ` Match the art direction, lighting style, and material vocabulary of the reference image so the world feels continuous. This new room is one step ${direction} of the reference and must read as a different place — keep the style, change the architecture and contents.`;
}
