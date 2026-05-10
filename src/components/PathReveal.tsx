import { useEffect, useRef, useState } from "react";
import { generateRoom } from "../ai/panorama";
import { coordKey, optimalPath } from "../game/coordinates";
import { loadRoom } from "../game/storage";
import type { GameRun, RoomData } from "../game/types";

type Props = {
  run: GameRun;
  onClose: () => void;
};

type Slot = {
  coord: readonly [number, number];
  room: RoomData | null;
  status: "cached" | "pending" | "generating" | "error";
  error?: string;
};

export function PathReveal({ run, onClose }: Props) {
  const path = optimalPath(run.startCoord, run.destinationCoord);
  const [slots, setSlots] = useState<Slot[]>(() =>
    path.map((coord) => {
      const cached = run.visited[coordKey(coord)] ?? loadRoom(run.seed, coord);
      return cached
        ? { coord, room: cached, status: "cached" as const }
        : { coord, room: null, status: "pending" as const };
    })
  );
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!run.scenario) return;

    async function fillMissing() {
      for (let i = 0; i < path.length; i++) {
        if (cancelledRef.current) return;
        setSlots((prev) => {
          const s = prev[i];
          if (s.status === "cached" || s.status === "error") return prev;
          const next = [...prev];
          next[i] = { ...s, status: "generating" };
          return next;
        });
        const current = slots[i];
        if (current.status === "cached") continue;
        try {
          // serial — uses prior room as continuity reference
          const previous = i > 0 ? slots[i - 1].room ?? loadRoom(run.seed, path[i - 1]) ?? undefined : undefined;
          const direction =
            i > 0
              ? (path[i][0] > path[i - 1][0]
                  ? "E"
                  : path[i][0] < path[i - 1][0]
                  ? "W"
                  : path[i][1] > path[i - 1][1]
                  ? "S"
                  : "N")
              : undefined;
          const catalogSize = run.scenario!.room_catalog.length;
          const isStart = path[i][0] === run.startCoord[0] && path[i][1] === run.startCoord[1];
          const isDest = path[i][0] === run.destinationCoord[0] && path[i][1] === run.destinationCoord[1];
          const catalogIndex =
            run.coordToCatalogIndex[`${path[i][0]},${path[i][1]}`] ??
            (isStart ? 0 : isDest ? catalogSize - 1 : Math.min(i, catalogSize - 2));
          const room = await generateRoom({
            seed: run.seed,
            coord: path[i],
            scenario: run.scenario!,
            start: run.startCoord,
            destination: run.destinationCoord,
            catalogIndex,
            previousRoom: previous ?? undefined,
            direction,
          });
          if (cancelledRef.current) return;
          setSlots((prev) => {
            const next = [...prev];
            next[i] = { coord: path[i], room, status: "cached" };
            return next;
          });
        } catch (err) {
          setSlots((prev) => {
            const next = [...prev];
            next[i] = {
              coord: path[i],
              room: null,
              status: "error",
              error: err instanceof Error ? err.message : "failed",
            };
            return next;
          });
        }
      }
    }

    void fillMissing();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cachedCount = slots.filter((s) => s.status === "cached").length;
  const total = slots.length;

  return (
    <div className="reveal-overlay" role="dialog">
      <div className="reveal-panel">
        <div className="reveal-head">
          <div>
            <div className="reveal-eyebrow">— the correct path —</div>
            <h2 className="reveal-title">{cachedCount} / {total} rooms</h2>
          </div>
          <button className="reveal-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="reveal-rail">
          {slots.map((slot, i) => (
            <div className="reveal-card" key={`${slot.coord[0]},${slot.coord[1]}`}>
              <div className="reveal-thumb">
                {slot.room?.imageDataUrl ? (
                  <img src={slot.room.imageDataUrl} alt={`room at ${slot.coord[0]},${slot.coord[1]}`} />
                ) : slot.status === "generating" ? (
                  <div className="reveal-skel">rendering…</div>
                ) : slot.status === "error" ? (
                  <div className="reveal-skel reveal-err">render failed</div>
                ) : (
                  <div className="reveal-skel">queued</div>
                )}
                <div className="reveal-step">step {String(i).padStart(2, "0")}</div>
              </div>
              <div className="reveal-meta">
                <div className="reveal-coord">
                  {slot.coord[0]}, {slot.coord[1]}
                  {i === 0 && <span className="tag">start</span>}
                  {i === slots.length - 1 && <span className="tag tag-dest">goal</span>}
                </div>
                {slot.room?.name && (
                  <div className="reveal-name">{slot.room.name}</div>
                )}
                {slot.room && (
                  <div className="reveal-desc">{slot.room.concept || slot.room.descriptor}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="reveal-foot">
          press <kbd>esc</kbd> or click outside to close · generation costs API credits
        </div>
      </div>
      <button className="reveal-scrim" onClick={onClose} aria-label="close" />
    </div>
  );
}
