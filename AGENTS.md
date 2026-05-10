# Codex Guide

This repo is a Vite React app for a browser-only 360-degree exploration game. Future agents should treat the AI prompt contracts, coordinate system, and room generation flow as core product logic.

## Run And Verify

- Use Node.js 18 or newer.
- Prefer `npm.cmd` on Windows because PowerShell may block `npm.ps1`.
- Start dev server: `npm.cmd run dev`
- Build check: `npm.cmd run build`
- The app reads `VITE_OPENAI_API_KEY` from `.env`. Never print, commit, or copy the real key into docs or logs.
- Vite may choose `5174` or higher if `5173` is occupied.

## Files To Know

- `src/hooks/useGameRun.ts` owns the gameplay state machine, movement, room assignment, and local persistence calls.
- `src/game/coordinates.ts` owns coordinate math, cardinal movement, destination picking, and gradient position.
- `src/game/types.ts` is the shared contract for scenarios, rooms, clues, and run state.
- `src/ai/prompts.ts` contains the scenario and panorama prompt contracts. Small wording changes here can alter gameplay.
- `src/ai/scenario.ts` validates and normalizes model JSON. Keep this resilient to off-by-one model output.
- `src/ai/panorama.ts` turns scenario, coordinate, and navigation clues into image prompts.
- `src/components/Pannellum.tsx` wraps the 360 viewer and custom touchpad wheel handling.

## Product Invariants

- The world uses cardinal directions `N`, `E`, `S`, `W`.
- `step([x, y], "N")` means `[x, y - 1]`; `S` means `[x, y + 1]`; `E` means `[x + 1, y]`; `W` means `[x - 1, y]`.
- The start room is catalog index `0`.
- The goal room is catalog index `31`.
- `room_catalog` and `navigation_clue_sets` must behave as exactly 32-entry arrays after normalization.
- Each room panorama must have exactly four archways, one per cardinal direction.
- The correct clue object belongs in front of the archway that moves the player closer to the destination.
- Do not add UI labels, arrows, or overlays to reveal the correct door. The clue should be visible inside the generated image.

## Engineering Preferences

- Keep generation logic deterministic where possible. Use the run seed or coordinates when shuffling or assigning content.
- Prefer type updates in `src/game/types.ts` before threading new scenario or room fields through the app.
- Validate AI output at the boundary in `src/ai/scenario.ts`; do not spread loose `unknown` objects through React components.
- Preserve localStorage compatibility when adding fields. Optional fields are safer for already-saved runs.
- Avoid broad visual refactors unless requested. This app is primarily a game flow and prompt-contract project.
- Run `npm.cmd run build` after TypeScript or prompt-contract changes.

