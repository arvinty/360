# A Flicker In Time

A single-player browser game where you are dropped into a 360° panoramic world frozen a half-second before a disaster, and must walk room-to-room until you find the one place the catastrophe can still be averted — before your step budget runs out.

The whole world is generated from a single world prompt: an OpenAI chat call composes a 32-room scenario (mission briefing, gradient axes, descriptor curve, art style, room catalog, navigation clue sets), then OpenAI's image API renders all 32 equirectangular panoramas in parallel.

## Gameplay loop

1. **Prompt** — describe a world (e.g. *"a flooded library at the moment a pipe gives way"*).
2. **Briefing** — read the mission while the rooms render in the background. The briefing describes the destination room in concrete sensory detail; you have to recognize it when you arrive.
3. **Explore** — every room has four archways (N/E/S/W) and four physical *clue objects* placed in front of them. The correct clue (per the briefing's crisis context) marks the archway leading toward the goal. Walk through it.
4. **Course warnings** — drifting off the path triggers escalating banners: *slight* → *serious* → *extreme* (red, pulsing).
5. **End** — arrive at the goal room before your step budget expires, or fail.

## What's in the box

- 360° panorama viewer (Pannellum, loaded from CDN in `index.html`).
- Drag, two-finger trackpad swipe, arrow keys / `A`/`D` to look around.
- Pre-rendering: all 32 catalog rooms are generated in parallel as soon as the briefing appears, so most steps are instant.
- Navigation clue objects baked into each panorama at fixed image-x positions so you can read them off the rendered scene.
- HUD: heading rose, step hourglass, minimap, mission-statement popover, regenerate-scene button.
- Debug panel ("word graph"): a serpentine SVG graph of the 32-room catalog with start, goal, current, visited, and pre-rendered states color-coded.

## How to run

Requires Node.js 18+.

1. Open a terminal in `C:\Users\arvin\Downloads\360-cd1`.

2. Create `.env` with your OpenAI API key:

   ```
   VITE_OPENAI_API_KEY=sk-...
   ```

3. Install dependencies if `node_modules` is missing:

   ```
   npm install
   ```

4. Start the dev server:

   ```
   npm run dev
   ```

5. Open the URL Vite prints (commonly `http://localhost:5173/`; another port if 5173 is taken).

### PowerShell note

Use `npm.cmd` instead of `npm` if PowerShell blocks scripts with an execution-policy error.

## Scripts

- `npm run dev` — start the Vite dev server.
- `npm run build` — production build.
- `npm run preview` — preview the production build.

## Architecture

- **Frontend-only.** No backend; the browser calls OpenAI directly using the key in `.env`.
- **Models** (configurable in `src/ai/openai.ts`):
  - Chat: `gpt-4.1-mini` for scenario JSON.
  - Image: `gpt-image-2` for 1536×1024 equirectangular panoramas.
- **Storage.** Run state and per-room images are persisted to `localStorage` under `frozen_moment:run:*` and `frozen_moment:room:*` keys. Quota errors evict the oldest cached rooms.
- **Code map** (in `src/`):
  - `ai/scenario.ts` — composes and validates the 32-room scenario JSON, with retry-on-validation that re-prompts the model with the specific failure reason.
  - `ai/panorama.ts` — builds per-room image prompts (descriptor curve, art style, navigation clues) and calls the image API.
  - `ai/prompts.ts` — system prompt for the scenario and the panorama prompt builder.
  - `game/coordinates.ts` — grid math, deterministic seeded RNG, BFS room layout.
  - `game/storage.ts` — localStorage adapter.
  - `game/types.ts` — domain types.
  - `hooks/useGameRun.ts` — the entire game state machine.
  - `components/` — React UI (briefing, game view, minimap, hourglass, arch controls, debug panel, end screen, etc.).
  - `styles/app.css` — all styles.

## Notes

- API key is exposed to the browser; this is a local-only workflow.
- Pannellum is loaded from a CDN in `index.html`.
- `vite-dev.log` and `vite-dev.err.log` are gitignored.
