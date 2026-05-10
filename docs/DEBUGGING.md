# Debugging

Use this file when the app runs but the game behavior feels wrong.

## Common Commands

```powershell
npm.cmd run dev
npm.cmd run build
```

If Vite reports that port `5173` is busy, use the next URL printed by Vite, often `http://127.0.0.1:5174/`.

## Known Local Issues

PowerShell may print an execution policy warning for the user profile script. It is noisy but usually unrelated to the app. Use `npm.cmd` commands to avoid `npm.ps1` execution-policy blocking.

Vite or esbuild may fail inside a restricted sandbox while trying to load `vite.config.ts`. Running the same command normally on the machine works.

## Scenario Fails To Generate

Check:

- `.env` contains `VITE_OPENAI_API_KEY`.
- `chatJSON` did not hit `finish_reason === "length"`.
- `scenario.ts` validation error text identifies the malformed field.
- `room_catalog` and `navigation_clue_sets` normalize to exactly 32 entries.

Useful files:

- `src/ai/openai.ts`
- `src/ai/scenario.ts`
- `src/ai/prompts.ts`

## Door Clues Look Wrong

Check:

- `buildDoorClues` chooses the expected direction for the current coordinate.
- `RoomData.navigationClues` has four entries before image generation.
- The correct clue is in front of the archway, not merely visible somewhere else.
- The clue class does not rely on readable text.

If the correct object is conceptually right but visually unclear, improve the clue class instructions in `SCENARIO_SYSTEM_PROMPT`.

If the object is placed near the wrong exit, improve the archway and clue placement section in `buildPanoramaPrompt`.

## Movement Feels Wrong

Cardinal yaw snapping is in `ArchControls.tsx`:

- yaw near `0` means `N`
- yaw near `90` means `E`
- yaw near `180` means `S`
- yaw near `270` means `W`

Grid stepping is in `coordinates.ts`. Keep the yaw mapping and coordinate stepping aligned.

## Touchpad Or Camera Issues

`Pannellum.tsx` handles:

- Pannellum viewer creation and destruction
- yaw polling
- keyboard yaw changes through `GameView`
- two-finger touchpad gestures through a custom `wheel` listener

If two-finger panning breaks, check that `.pannellum-stage` still has:

```css
touch-action: none;
overscroll-behavior: none;
```

## LocalStorage Issues

Room image data is stored separately from the slim run object:

- Run key prefix: `frozen_moment:run:`
- Room key prefix: `frozen_moment:room:`

When changing persisted room or run shapes, keep old saved data from crashing the app. Prefer optional fields and fallback defaults.

