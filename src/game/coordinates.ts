import type { Coord, Direction } from "./types";

export function coordKey(c: Coord): string {
  return `${c[0]},${c[1]}`;
}

export function step(c: Coord, dir: Direction): Coord {
  const [x, y] = c;
  switch (dir) {
    case "N": return [x, y - 1];
    case "S": return [x, y + 1];
    case "E": return [x + 1, y];
    case "W": return [x - 1, y];
  }
}

export function manhattan(a: Coord, b: Coord): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

// xorshift32 from a string seed (FNV-1a) — deterministic
function seededRng(seed: string): () => number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let s = h || 0xdeadbeef;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

export function pickDestinationCoord(seed: string, optimalSteps: number): Coord {
  const rng = seededRng(seed);
  const total = Math.max(1, optimalSteps);
  // split between x and y axes
  const xSteps = Math.floor(rng() * (total + 1));
  const ySteps = total - xSteps;
  const xSign = rng() < 0.5 ? -1 : 1;
  const ySign = rng() < 0.5 ? -1 : 1;
  return [xSteps * xSign, ySteps * ySign] as const;
}

export function optimalPath(start: Coord, dest: Coord): Coord[] {
  const path: Coord[] = [start];
  let [x, y] = start;
  const [dx, dy] = dest;
  while (x !== dx) {
    x += dx > x ? 1 : -1;
    path.push([x, y]);
  }
  while (y !== dy) {
    y += dy > y ? 1 : -1;
    path.push([x, y]);
  }
  return path;
}

/**
 * Deterministic layout that assigns `size` catalog indices to grid coords.
 * Index 0 → start, index `size - 1` → destination. Intermediate indices fill
 * a BFS ring around the start, biased toward cells lying on the optimal path
 * to destination so the player's likely route is fully pre-rendered.
 */
export function layoutCatalogCoords(
  start: Coord,
  dest: Coord,
  size: number,
  seed: string
): Coord[] {
  if (size < 2) return [start];
  const coords: Coord[] = new Array(size);
  coords[0] = start;
  coords[size - 1] = dest;

  const taken = new Set<string>();
  taken.add(coordKey(start));
  taken.add(coordKey(dest));

  // 1) prefer the optimal path interior
  const path = optimalPath(start, dest);
  const interior: Coord[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    const k = coordKey(path[i]);
    if (!taken.has(k)) {
      interior.push(path[i]);
      taken.add(k);
    }
  }

  // 2) BFS rings around path nodes for additional fill
  const rng = seededRng(seed + ":layout");
  const queue: Coord[] = [...path];
  const ring: Coord[] = [];
  while (ring.length + interior.length < size - 2 && queue.length > 0) {
    const c = queue.shift()!;
    const dirs: Direction[] = ["N", "E", "S", "W"];
    // shuffle directions deterministically
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    for (const d of dirs) {
      const n = step(c, d);
      const k = coordKey(n);
      if (taken.has(k)) continue;
      taken.add(k);
      ring.push(n);
      queue.push(n);
      if (ring.length + interior.length >= size - 2) break;
    }
  }

  const middle = [...interior, ...ring].slice(0, size - 2);
  for (let i = 0; i < middle.length; i++) {
    coords[i + 1] = middle[i];
  }
  // pad if somehow short (shouldn't happen on infinite grid)
  for (let i = 1; i < size - 1; i++) {
    if (!coords[i]) coords[i] = [i, 0];
  }
  return coords;
}

export function gradientPosition(coord: Coord, start: Coord, dest: Coord): number {
  const total = manhattan(start, dest);
  if (total === 0) return 1;
  const remaining = manhattan(coord, dest);
  const p = 1 - remaining / total;
  return Math.max(0, Math.min(1, p));
}
