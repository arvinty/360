from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import dotenv
from flask import Flask, jsonify, render_template, request, send_from_directory, url_for
from openai import OpenAI

dotenv.load_dotenv()

app = Flask(__name__)
client = OpenAI()
WORLD_CACHE_DIR = Path("world_cache")
WORLD_CACHE_DIR.mkdir(parents=True, exist_ok=True)

DIRECTION_DELTAS = {
    "north": (0, -1),
    "south": (0, 1),
    "east": (1, 0),
    "west": (-1, 0),
}

DEFAULT_PROMPT = (
    "A high-quality 360 equirectangular panorama of a cozy mountain lake at sunset, "
    "wide horizontal composition, immersive environment, photorealistic."
)


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def normalize_prompt(prompt: str) -> str:
    collapsed = " ".join(prompt.split())
    return collapsed.strip().lower()


def world_id_from_prompt(prompt: str) -> str:
    normalized = normalize_prompt(prompt)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return digest[:16]


def world_paths(world_id: str) -> tuple[Path, Path, Path]:
    root = WORLD_CACHE_DIR / world_id
    images = root / "images"
    metadata = root / "world.json"
    return root, images, metadata


def node_key(x: int, y: int) -> str:
    return f"{x},{y}"


def coord_label(x: int, y: int) -> str:
    if x == 0 and y == 0:
        return "the origin point of this world"
    x_part = "at the center column"
    if x > 0:
        x_part = f"{x} blocks east"
    if x < 0:
        x_part = f"{abs(x)} blocks west"
    y_part = "center row"
    if y > 0:
        y_part = f"{y} blocks south"
    if y < 0:
        y_part = f"{abs(y)} blocks north"
    return f"{x_part}, {y_part}"


def move_phrase(last_move: str | None) -> str:
    if last_move is None:
        return "This is the entry viewpoint for the world."
    return f"The camera has just moved one block toward {last_move}."


def build_node_prompt(world_prompt: str, x: int, y: int, last_move: str | None) -> str:
    return (
        f"World description: {world_prompt}\n"
        f"Current location: {coord_label(x, y)}.\n"
        f"Transition: {move_phrase(last_move)}\n"
        "Keep consistency in art style, weather, and lighting with nearby locations. "
        "Output a seamless full 360-degree equirectangular panorama with 2:1 aspect ratio."
    )


def load_or_create_world(world_prompt: str) -> dict[str, Any]:
    prompt = world_prompt.strip() or DEFAULT_PROMPT
    world_id = world_id_from_prompt(prompt)
    root, images_dir, metadata_path = world_paths(world_id)
    root.mkdir(parents=True, exist_ok=True)
    images_dir.mkdir(parents=True, exist_ok=True)

    if metadata_path.exists():
        return json.loads(metadata_path.read_text(encoding="utf-8"))

    world = {
        "world_id": world_id,
        "prompt": prompt,
        "normalized_prompt": normalize_prompt(prompt),
        "created_at": utc_now_iso(),
        "grid": {"movement": "cardinal_4"},
        "nodes": {},
    }
    save_world(world)
    return world


def save_world(world: dict[str, Any]) -> None:
    _, _, metadata_path = world_paths(world["world_id"])
    metadata_path.write_text(
        json.dumps(world, indent=2, ensure_ascii=True), encoding="utf-8"
    )


def generate_node_image(prompt: str) -> bytes:
    result = client.images.generate(
        model="gpt-image-2",
        prompt=prompt,
        size="1536x1024",
    )
    image_base64 = result.data[0].b64_json
    return base64.b64decode(image_base64)


def neighbors_for(x: int, y: int) -> dict[str, dict[str, int]]:
    return {
        direction: {"x": x + dx, "y": y + dy}
        for direction, (dx, dy) in DIRECTION_DELTAS.items()
    }


def get_or_create_node(
    world: dict[str, Any], x: int, y: int, last_move: str | None
) -> tuple[dict[str, Any], bool]:
    key = node_key(x, y)
    nodes = world["nodes"]
    if key in nodes:
        node = nodes[key]
        return {
            "worldId": world["world_id"],
            "x": x,
            "y": y,
            "imageUrl": url_for(
                "world_image", world_id=world["world_id"], filename=node["filename"]
            ),
            "neighbors": neighbors_for(x, y),
            "cacheHit": True,
            "promptUsed": node["prompt"],
        }, True

    node_prompt = build_node_prompt(world["prompt"], x, y, last_move)
    image_bytes = generate_node_image(node_prompt)
    filename = f"{x}_{y}.png"
    _, images_dir, _ = world_paths(world["world_id"])
    (images_dir / filename).write_bytes(image_bytes)
    nodes[key] = {
        "filename": filename,
        "x": x,
        "y": y,
        "prompt": node_prompt,
        "created_at": utc_now_iso(),
        "last_move": last_move,
    }
    save_world(world)
    return {
        "worldId": world["world_id"],
        "x": x,
        "y": y,
        "imageUrl": url_for("world_image", world_id=world["world_id"], filename=filename),
        "neighbors": neighbors_for(x, y),
        "cacheHit": False,
        "promptUsed": node_prompt,
    }, False


def load_world_by_id(world_id: str) -> dict[str, Any] | None:
    _, _, metadata_path = world_paths(world_id)
    if not metadata_path.exists():
        return None
    return json.loads(metadata_path.read_text(encoding="utf-8"))


@app.route("/")
def index() -> str:
    return render_template("index.html", default_prompt=DEFAULT_PROMPT)


@app.route("/world/start", methods=["POST"])
def world_start():
    payload = request.get_json(silent=True) or {}
    prompt = (payload.get("prompt") or "").strip()
    world = load_or_create_world(prompt or DEFAULT_PROMPT)
    node_payload, _ = get_or_create_node(world, 0, 0, None)
    return jsonify(node_payload)


@app.route("/world/node")
def world_node():
    world_id = (request.args.get("world_id") or "").strip()
    if not world_id:
        return jsonify({"error": "world_id is required"}), 400
    try:
        x = int(request.args.get("x", "0"))
        y = int(request.args.get("y", "0"))
    except ValueError:
        return jsonify({"error": "x and y must be integers"}), 400

    world = load_world_by_id(world_id)
    if world is None:
        return jsonify({"error": "World not found"}), 404

    node_payload, _ = get_or_create_node(world, x, y, None)
    return jsonify(node_payload)


@app.route("/world/move", methods=["POST"])
def world_move():
    payload = request.get_json(silent=True) or {}
    world_id = (payload.get("world_id") or "").strip()
    direction = (payload.get("direction") or "").strip().lower()
    if direction not in DIRECTION_DELTAS:
        return jsonify({"error": "direction must be north/south/east/west"}), 400
    if not world_id:
        return jsonify({"error": "world_id is required"}), 400

    try:
        x = int(payload.get("x"))
        y = int(payload.get("y"))
    except (TypeError, ValueError):
        return jsonify({"error": "x and y are required integers"}), 400

    world = load_world_by_id(world_id)
    if world is None:
        return jsonify({"error": "World not found"}), 404

    dx, dy = DIRECTION_DELTAS[direction]
    next_x = x + dx
    next_y = y + dy
    node_payload, _ = get_or_create_node(world, next_x, next_y, direction)
    return jsonify(node_payload)


@app.route("/world-cache/<world_id>/<path:filename>")
def world_image(world_id: str, filename: str):
    _, images_dir, _ = world_paths(world_id)
    return send_from_directory(images_dir, filename)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)