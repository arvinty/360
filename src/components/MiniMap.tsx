import { useMemo } from "react";
import { coordKey, manhattan } from "../game/coordinates";
import type { Coord, GameRun } from "../game/types";

type Props = {
  run: GameRun;
  onWarp: (coord: Coord) => void;
};

const CELL = 26;
const PAD = 12;

export function MiniMap({ run, onWarp }: Props) {
  const visitedRooms = useMemo(
    () =>
      Object.values(run.visited).sort(
        (a, b) => a.generatedAt - b.generatedAt
      ),
    [run.visited]
  );

  const orderByKey = useMemo(() => {
    const m: Record<string, number> = {};
    visitedRooms.forEach((room, i) => {
      m[coordKey(room.coord)] = i;
    });
    return m;
  }, [visitedRooms]);

  const ghostNeighbors: Coord[] = [
    [run.currentCoord[0], run.currentCoord[1] - 1],
    [run.currentCoord[0] + 1, run.currentCoord[1]],
    [run.currentCoord[0], run.currentCoord[1] + 1],
    [run.currentCoord[0] - 1, run.currentCoord[1]],
  ];

  const visitedCoords = visitedRooms.map((r) => r.coord);
  const allXs = [...visitedCoords.map((c) => c[0]), ...ghostNeighbors.map((c) => c[0])];
  const allYs = [...visitedCoords.map((c) => c[1]), ...ghostNeighbors.map((c) => c[1])];
  const minX = Math.min(...allXs);
  const maxX = Math.max(...allXs);
  const minY = Math.min(...allYs);
  const maxY = Math.max(...allYs);

  const w = (maxX - minX + 1) * CELL + PAD * 2;
  const h = (maxY - minY + 1) * CELL + PAD * 2;

  function pos(c: Coord) {
    return {
      x: (c[0] - minX) * CELL + PAD + CELL / 2,
      y: (c[1] - minY) * CELL + PAD + CELL / 2,
    };
  }

  // edges between visited adjacent rooms
  const edges: Array<{ a: Coord; b: Coord }> = [];
  for (let i = 0; i < visitedRooms.length; i++) {
    for (let j = i + 1; j < visitedRooms.length; j++) {
      if (manhattan(visitedRooms[i].coord, visitedRooms[j].coord) === 1) {
        edges.push({ a: visitedRooms[i].coord, b: visitedRooms[j].coord });
      }
    }
  }

  const currentKey = coordKey(run.currentCoord);

  return (
    <div className="minimap">
      <div className="minimap-head">
        <span className="minimap-title">map</span>
        <span className="minimap-count">{visitedRooms.length} rooms</span>
      </div>
      <svg
        className="minimap-svg"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
      >
        {/* faint grid */}
        <defs>
          <pattern id="mm-grid" width={CELL} height={CELL} patternUnits="userSpaceOnUse">
            <path d={`M ${CELL} 0 L 0 0 0 ${CELL}`} fill="none" stroke="rgba(239,236,228,0.05)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={w} height={h} fill="url(#mm-grid)" />

        {/* edges between visited rooms */}
        {edges.map((e, i) => {
          const a = pos(e.a);
          const b = pos(e.b);
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="rgba(216,184,106,0.45)"
              strokeWidth="1.5"
            />
          );
        })}

        {/* ghost arrows from current to unvisited neighbors */}
        {ghostNeighbors.map((g, i) => {
          if (orderByKey[coordKey(g)] !== undefined) return null;
          const c = pos(run.currentCoord);
          const n = pos(g);
          // arrowhead at neighbor end, stop short of cell center
          const dx = n.x - c.x;
          const dy = n.y - c.y;
          const len = Math.hypot(dx, dy);
          const ux = dx / len;
          const uy = dy / len;
          const x2 = n.x - ux * 8;
          const y2 = n.y - uy * 8;
          return (
            <g key={i}>
              <line
                x1={c.x}
                y1={c.y}
                x2={x2}
                y2={y2}
                stroke="rgba(239,236,228,0.32)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle cx={n.x} cy={n.y} r="3" fill="rgba(239,236,228,0.4)" />
            </g>
          );
        })}

        {/* visited room nodes */}
        {visitedRooms.map((room, i) => {
          const p = pos(room.coord);
          const isCurrent = coordKey(room.coord) === currentKey;
          const isStart =
            room.coord[0] === run.startCoord[0] && room.coord[1] === run.startCoord[1];
          return (
            <g
              key={coordKey(room.coord)}
              className={`mm-node ${isCurrent ? "is-current" : ""}`}
              onClick={() => !isCurrent && onWarp(room.coord)}
            >
              <title>
                {`${room.name || `room #${i}`} · (${room.coord[0]}, ${room.coord[1]})${isStart ? " — start" : ""}\n${room.concept || room.descriptor}`}
              </title>
              <rect
                x={p.x - CELL / 2 + 3}
                y={p.y - CELL / 2 + 3}
                width={CELL - 6}
                height={CELL - 6}
                fill={
                  isCurrent
                    ? "rgba(216,184,106,0.85)"
                    : isStart
                    ? "rgba(239,236,228,0.18)"
                    : "rgba(239,236,228,0.08)"
                }
                stroke={
                  isCurrent
                    ? "rgba(216,184,106,1)"
                    : isStart
                    ? "rgba(239,236,228,0.6)"
                    : "rgba(239,236,228,0.35)"
                }
                strokeWidth="1.2"
              />
              <text
                x={p.x}
                y={p.y + 4}
                textAnchor="middle"
                fontFamily="JetBrains Mono, monospace"
                fontSize="10"
                fill={isCurrent ? "#0c0a08" : "rgba(239,236,228,0.85)"}
                fontWeight="600"
              >
                {i}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="minimap-legend">
        <span><i className="mm-dot mm-current" /> here</span>
        <span><i className="mm-dot mm-visited" /> visited</span>
        <span><i className="mm-dot mm-ghost" /> exits</span>
      </div>
    </div>
  );
}
