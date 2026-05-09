import { useMemo, useState } from "react";
import type { GameRun } from "../game/types";
import { coordKey } from "../game/coordinates";

type Props = { run: GameRun };

const COLS = 8;
const NODE_R = 18;
const COL_GAP = 96;
const ROW_GAP = 84;
const PAD = 28;

export function DebugPanel({ run }: Props) {
  const [open, setOpen] = useState(false);
  const scenario = run.scenario;

  const layout = useMemo(() => {
    if (!scenario) return null;
    const size = scenario.room_catalog.length;
    const rows = Math.ceil(size / COLS);
    const positions = scenario.room_catalog.map((_, idx) => {
      const row = Math.floor(idx / COLS);
      // serpentine path so adjacent indices are adjacent visually
      const colInRow = row % 2 === 0 ? idx % COLS : COLS - 1 - (idx % COLS);
      return {
        x: PAD + colInRow * COL_GAP,
        y: PAD + row * ROW_GAP,
      };
    });
    const width = PAD * 2 + (COLS - 1) * COL_GAP;
    const height = PAD * 2 + (rows - 1) * ROW_GAP;
    return { positions, width, height, lastIdx: size - 1 };
  }, [scenario]);

  // catalogIndex -> coord assigned (if any)
  const indexToCoord: Record<number, string> = {};
  for (const [k, idx] of Object.entries(run.coordToCatalogIndex)) {
    indexToCoord[idx] = k;
  }
  const visitedKeys = new Set(Object.keys(run.visited));
  const currentKey = coordKey(run.currentCoord);
  const currentIdx = run.coordToCatalogIndex[currentKey];

  // edges: connect catalog indices whose assigned coords are adjacent and both visited
  const edges = useMemo(() => {
    if (!scenario) return [] as Array<[number, number]>;
    const visitedCoords = Object.entries(run.coordToCatalogIndex).filter(([k]) =>
      visitedKeys.has(k)
    );
    const coordToIdx = new Map(visitedCoords);
    const out: Array<[number, number]> = [];
    for (const [k, idx] of visitedCoords) {
      const [xs, ys] = k.split(",");
      const x = parseInt(xs, 10);
      const y = parseInt(ys, 10);
      const neighbors = [
        [x + 1, y],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        const nk = `${nx},${ny}`;
        const nIdx = coordToIdx.get(nk);
        if (nIdx !== undefined) out.push([idx, nIdx]);
      }
    }
    return out;
  }, [scenario, run.coordToCatalogIndex, visitedKeys]);

  return (
    <div className={`debug-panel ${open ? "open" : ""}`}>
      <button
        className="debug-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        debug · word graph {open ? "▾" : "▴"}
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
                <span className="legend-chip pending" /> rendering
              </div>
              <div className="debug-graph-wrap">
                <svg
                  className="debug-graph-svg"
                  width={layout.width}
                  height={layout.height}
                  viewBox={`0 0 ${layout.width} ${layout.height}`}
                >
                  {/* serpentine catalog connectors (faint guide) */}
                  {layout.positions.slice(0, -1).map((p, i) => {
                    const q = layout.positions[i + 1];
                    return (
                      <line
                        key={`seq-${i}`}
                        x1={p.x}
                        y1={p.y}
                        x2={q.x}
                        y2={q.y}
                        className="debug-edge-seq"
                      />
                    );
                  })}
                  {/* visited adjacency edges */}
                  {edges.map(([a, b], i) => {
                    const p = layout.positions[a];
                    const q = layout.positions[b];
                    return (
                      <line
                        key={`adj-${i}`}
                        x1={p.x}
                        y1={p.y}
                        x2={q.x}
                        y2={q.y}
                        className="debug-edge-adj"
                      />
                    );
                  })}
                  {/* nodes */}
                  {scenario.room_catalog.map((entry, idx) => {
                    const { x, y } = layout.positions[idx];
                    const ck = indexToCoord[idx];
                    const visited = ck && visitedKeys.has(ck);
                    const ready = !!visited;
                    const isStart = idx === 0;
                    const isGoal = idx === layout.lastIdx;
                    const isCurrent = idx === currentIdx;
                    const cls = [
                      "debug-node-circle",
                      ready ? "ready" : "pending",
                      visited ? "visited" : "",
                      isStart ? "start" : "",
                      isGoal ? "goal" : "",
                      isCurrent ? "current" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <g key={idx} className="debug-node-g">
                        {(isStart || isGoal) && (
                          <circle
                            cx={x}
                            cy={y}
                            r={NODE_R + 6}
                            className={`debug-halo ${isStart ? "start" : "goal"}`}
                          />
                        )}
                        <circle cx={x} cy={y} r={NODE_R} className={cls} />
                        <text x={x} y={y + 4} className="debug-node-idx">
                          {idx}
                        </text>
                        <text
                          x={x}
                          y={y + NODE_R + 14}
                          className="debug-node-label"
                        >
                          {entry.name}
                        </text>
                        <title>
                          {`#${idx} — ${entry.name}\n${entry.concept}${
                            ck ? `\nat ${ck}` : ""
                          }`}
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
