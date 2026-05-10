import { useMemo, useState } from "react";
import type { GameRun } from "../game/types";
import { coordKey } from "../game/coordinates";

type Props = { run: GameRun };

const CELL_W = 124;
const CELL_H = 88;
const PAD = 24;
const DOOR_LEN = 18;
const DOOR_THICK = 6;

export function DebugPanel({ run }: Props) {
  const [open, setOpen] = useState(false);
  const scenario = run.scenario;

  const visitedKeys = new Set(Object.keys(run.visited));
  const currentKey = coordKey(run.currentCoord);
  const startKey = coordKey(run.startCoord);
  const goalKey = coordKey(run.destinationCoord);

  const layout = useMemo(() => {
    if (!scenario) return null;

    // Collect all coords we want to show: assigned rooms, start, dest, current.
    const coords: Array<[number, number]> = [];
    for (const k of Object.keys(run.coordToCatalogIndex)) {
      const [xs, ys] = k.split(",");
      coords.push([parseInt(xs, 10), parseInt(ys, 10)]);
    }
    coords.push([run.startCoord[0], run.startCoord[1]]);
    coords.push([run.destinationCoord[0], run.destinationCoord[1]]);
    coords.push([run.currentCoord[0], run.currentCoord[1]]);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of coords) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    // Pad by 1 cell on each side to expose "no rooms generated" perimeter.
    minX -= 1; maxX += 1; minY -= 1; maxY += 1;

    const cols = maxX - minX + 1;
    const rows = maxY - minY + 1;
    const width = PAD * 2 + cols * CELL_W;
    const height = PAD * 2 + rows * CELL_H;

    const cellPos = (x: number, y: number) => ({
      x: PAD + (x - minX) * CELL_W,
      y: PAD + (y - minY) * CELL_H,
    });

    return { minX, maxX, minY, maxY, cols, rows, width, height, cellPos };
  }, [scenario, run.coordToCatalogIndex, run.startCoord, run.destinationCoord, run.currentCoord]);

  // Doors between adjacent assigned rooms (both E and S to avoid duplicates).
  const doors = useMemo(() => {
    if (!layout) return [] as Array<{ ax: number; ay: number; bx: number; by: number }>;
    const out: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
    for (const k of Object.keys(run.coordToCatalogIndex)) {
      const [xs, ys] = k.split(",");
      const x = parseInt(xs, 10);
      const y = parseInt(ys, 10);
      const east = `${x + 1},${y}`;
      const south = `${x},${y + 1}`;
      if (east in run.coordToCatalogIndex) out.push({ ax: x, ay: y, bx: x + 1, by: y });
      if (south in run.coordToCatalogIndex) out.push({ ax: x, ay: y, bx: x, by: y + 1 });
    }
    return out;
  }, [layout, run.coordToCatalogIndex]);

  return (
    <div className={`debug-panel ${open ? "open" : ""}`}>
      <button
        className="debug-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        debug · dungeon map {open ? "▾" : "▴"}
      </button>
      {open && (
        <div className="debug-body">
          {!scenario || !layout ? (
            <div className="debug-empty">no scenario yet</div>
          ) : (
            <>
              <div className="debug-legend">
                <span className="legend-chip start" /> start
                <span className="legend-chip goal" /> goal
                <span className="legend-chip current" /> current
                <span className="legend-chip visited" /> visited
                <span className="legend-chip ready" /> ready
                <span className="legend-chip pending" /> not generated
              </div>
              <div className="debug-graph-wrap">
                <svg
                  className="debug-graph-svg"
                  width={layout.width}
                  height={layout.height}
                  viewBox={`0 0 ${layout.width} ${layout.height}`}
                >
                  <defs>
                    <pattern
                      id="empty-hatch"
                      width="6"
                      height="6"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(45)"
                    >
                      <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
                    </pattern>
                  </defs>

                  {/* every cell in the bounding rect — empty cells get a hatched placeholder */}
                  {Array.from({ length: layout.rows }).map((_, ry) =>
                    Array.from({ length: layout.cols }).map((__, rx) => {
                      const gx = layout.minX + rx;
                      const gy = layout.minY + ry;
                      const ck = `${gx},${gy}`;
                      if (ck in run.coordToCatalogIndex) return null;
                      const { x, y } = layout.cellPos(gx, gy);
                      return (
                        <rect
                          key={`empty-${ck}`}
                          x={x + 6}
                          y={y + 6}
                          width={CELL_W - 12}
                          height={CELL_H - 12}
                          className="debug-cell-empty"
                          fill="url(#empty-hatch)"
                        />
                      );
                    })
                  )}

                  {/* doors between adjacent assigned rooms */}
                  {doors.map((d, i) => {
                    const a = layout.cellPos(d.ax, d.ay);
                    const b = layout.cellPos(d.bx, d.by);
                    const horizontal = d.ay === d.by;
                    const cx = (a.x + b.x) / 2 + CELL_W / 2;
                    const cy = (a.y + b.y) / 2 + CELL_H / 2;
                    return (
                      <rect
                        key={`door-${i}`}
                        x={horizontal ? cx - DOOR_THICK / 2 : cx - DOOR_LEN / 2}
                        y={horizontal ? cy - DOOR_LEN / 2 : cy - DOOR_THICK / 2}
                        width={horizontal ? DOOR_THICK : DOOR_LEN}
                        height={horizontal ? DOOR_LEN : DOOR_THICK}
                        className="debug-door"
                      />
                    );
                  })}

                  {/* assigned rooms */}
                  {Object.entries(run.coordToCatalogIndex).map(([ck, idx]) => {
                    const [xs, ys] = ck.split(",");
                    const gx = parseInt(xs, 10);
                    const gy = parseInt(ys, 10);
                    const { x, y } = layout.cellPos(gx, gy);
                    const entry = scenario.room_catalog[idx];
                    const visited = visitedKeys.has(ck);
                    const ready = visited || idx in run.prebuiltRooms;
                    const isStart = ck === startKey;
                    const isGoal = ck === goalKey;
                    const isCurrent = ck === currentKey;
                    const cls = [
                      "debug-cell",
                      ready ? "ready" : "pending",
                      visited ? "visited" : "",
                      isStart ? "start" : "",
                      isGoal ? "goal" : "",
                      isCurrent ? "current" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    const cellCx = x + CELL_W / 2;
                    return (
                      <g key={ck} className="debug-cell-g">
                        <rect
                          x={x + 4}
                          y={y + 4}
                          width={CELL_W - 8}
                          height={CELL_H - 8}
                          rx={3}
                          className={cls}
                        />
                        <text x={x + 8} y={y + 16} className="debug-cell-idx">
                          #{idx}
                        </text>
                        <text x={x + CELL_W - 8} y={y + 16} className="debug-cell-coord">
                          {gx},{gy}
                        </text>
                        <RoomName
                          name={entry?.name ?? `room ${idx}`}
                          cx={cellCx}
                          cy={y + CELL_H / 2 + 4}
                        />
                        {(isStart || isGoal || isCurrent) && (
                          <text
                            x={cellCx}
                            y={y + CELL_H - 10}
                            className="debug-cell-tag"
                          >
                            {isCurrent ? "you are here" : isStart ? "start" : "goal"}
                          </text>
                        )}
                        <title>
                          {`#${idx} — ${entry?.name ?? ""}\n${entry?.concept ?? ""}\nat ${ck}`}
                        </title>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RoomName({ name, cx, cy }: { name: string; cx: number; cy: number }) {
  const max = 16;
  if (name.length <= max) {
    return (
      <text x={cx} y={cy} className="debug-cell-name">
        {name}
      </text>
    );
  }
  const words = name.split(/\s+/);
  let line1 = "";
  let line2 = "";
  for (const w of words) {
    if ((line1 + " " + w).trim().length <= max && !line2) line1 = (line1 + " " + w).trim();
    else line2 = (line2 + " " + w).trim();
  }
  if (!line2) {
    line1 = name.slice(0, max - 1) + "…";
  } else if (line2.length > max) {
    line2 = line2.slice(0, max - 1) + "…";
  }
  return (
    <text x={cx} y={cy} className="debug-cell-name">
      <tspan x={cx} dy="-0.5em">{line1}</tspan>
      <tspan x={cx} dy="1.15em">{line2}</tspan>
    </text>
  );
}
