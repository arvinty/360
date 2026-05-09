## Grid Street-View 360 Explorer

This is a single Vite React app that:
- takes a fictional world prompt,
- opens a 360 panorama viewer,
- supports Street View-style directional movement (north/south/east/west),
- generates panorama nodes with the OpenAI Image API,
- stores world history and generated image data in browser local storage.

There is no backend. The app calls OpenAI directly from the browser, using the API key from `.env`.

## How to Run

This project is a Vite React app. It requires Node.js 18 or newer.

1. Open a terminal in this folder:

   `C:\Users\arvin\Downloads\360-cd1`

2. Create or update `.env` with your OpenAI API key:

   `VITE_OPENAI_API_KEY=your_key_here`

3. Install dependencies if `node_modules` is missing:

   `npm.cmd install`

4. Start the local dev server:

   `npm.cmd run dev`

5. Open the URL printed by Vite, usually:

   `http://127.0.0.1:5173/`

### Windows PowerShell note

Use `npm.cmd` instead of `npm` if PowerShell blocks scripts with an execution policy error. For example:

`npm.cmd run dev`

## Scripts

- `npm.cmd run dev` - run the local Vite dev server.
- `npm.cmd run build` - create a production build.
- `npm.cmd run preview` - preview the production build.

## Notes

- This app loads Pannellum from a CDN in `index.html`.
- Because this is a frontend-only app, the OpenAI API key is exposed to the browser while the local dev server is running.
- Vite is configured to expose `VITE_OPENAI_API_KEY` from `.env` for this local-only workflow.
- The app uses `gpt-image-1.5` with `1536x1024` landscape output.
