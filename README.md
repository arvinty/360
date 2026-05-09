## Grid Street-View 360 Explorer

This is a single Vite React app that:
- takes a fictional world prompt,
- opens a 360 panorama viewer,
- supports Street View-style directional movement (north/south/east/west),
- generates panorama nodes with the OpenAI Image API,
- stores world history and generated image data in browser local storage.

There is no backend. The app calls OpenAI directly from the browser, using the API key from `.env`.

## Setup

1. Put your API key in `.env`:

   `OPENAI_API_KEY=your_key_here`

2. Install dependencies:

   `yarn install`

3. Start the app:

   `yarn dev`

4. Open the Vite URL printed in the terminal.

## Scripts

- `yarn dev` - run the local Vite dev server.
- `yarn build` - create a production build.
- `yarn preview` - preview the production build.

## Notes

- This app loads Pannellum from a CDN in `index.html`.
- Because this is a frontend-only app, the OpenAI API key is exposed to the browser while the local dev server is running.
- Vite is configured to expose `OPENAI_API_KEY` from `.env` for this local-only workflow.
- The app uses `gpt-image-1.5` with `1536x1024` landscape output.
