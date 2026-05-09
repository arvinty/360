## Local Grid Street-View 360 Explorer

This project runs a local web app that:
- takes a fictional world prompt,
- generates 360 panorama nodes with `gpt-image-2`,
- supports Street View-style directional movement (north/south/east/west),
- caches generated nodes on disk and reuses them.

## Setup

1. Put your API key in `.env`:

   `OPENAI_API_KEY=your_key_here`

2. Install dependencies:

   `uv sync`

3. Start the app:

   `uv run main.py`

4. Open:

   <http://127.0.0.1:8000>

## Notes

- For best results, use prompts that explicitly request a **360 equirectangular panorama** and **2:1 aspect ratio**.
- Cached worlds are stored in `world_cache/<world_id>/`.
- Node images are saved as `world_cache/<world_id>/images/<x>_<y>.png`.
