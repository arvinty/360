# AI Generation Contracts

The game depends on the model returning structured scenario data and the image model following panorama placement instructions. Treat these prompts as gameplay code.

## Scenario JSON

`SCENARIO_SYSTEM_PROMPT` asks for:

- `mission_statement`
- `start_room_descriptor`
- `destination_room_descriptor`
- `gradient_axes`
- `crisis_summary`
- `step_budget`
- `descriptor_curve`
- `art_style`
- `room_catalog`
- `navigation_clue_sets`

`room_catalog` and `navigation_clue_sets` must act like exactly 32-entry arrays:

- Entry `0`: start-facing content
- Entries `1..30`: intermediate content
- Entry `31`: goal-facing content

The model sometimes returns 31 or 33 entries. `scenario.ts` normalizes this before validation by preserving first and last entries, trimming extra middle entries, or adding fallback middle entries.

## Navigation Clue Sets

Each `NavigationClueSet` has:

```ts
{
  class_name: string;
  correct_object: string;
  decoy_objects: string[]; // exactly 3 after normalization
}
```

The clue set array is ranked from best to worst. The strongest clue sets should land in high-traffic rooms, especially the shortest path from start to goal.

Good clue classes are visually distinct and tied to the crisis:

- portraits
- equations
- chemical elements
- maps
- tools
- machines
- relics
- emergency equipment
- scientific diagrams

Avoid clue sets that require reading text in the image. The image model may garble labels.

## Door Clue Placement

`buildDoorClues` in `panorama.ts` computes the one best direction toward the destination:

- If horizontal distance is greater or equal, prefer `E` or `W`.
- Otherwise prefer `N` or `S`.
- At the goal, no navigation clues are needed.

The correct object is placed in front of the correct archway. The three decoys are deterministically shuffled across the other archways using seed and coordinate.

## Panorama Prompt Contract

Every generated room should request:

- Equirectangular 360-degree panorama
- Exactly four archways
- North at x `0.50`
- East at x `0.75`
- South split across x `0.0` and x `1.0`
- West at x `0.25`
- Eye-level archways at y `0.5`
- No extra doors, windows, labels, UI, or logos

If images stop making the exits readable, strengthen the placement text in `buildPanoramaPrompt` before adding UI hints.

## Model Boundary Rules

- Keep model JSON validation in `scenario.ts`.
- Keep image-prompt composition in `prompts.ts` and `panorama.ts`.
- Do not let React components depend on raw model output.
- Add optional fields to persisted types unless you also handle old localStorage data.

