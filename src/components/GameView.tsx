import { useEffect, useRef, useState } from "react";
import { Pannellum } from "./Pannellum";
import { Hourglass } from "./Hourglass";
import { ArchControls, snapYawToDirection } from "./ArchControls";
import { MiniMap } from "./MiniMap";
import { coordKey } from "../game/coordinates";
import type { Coord, Direction, GameRun, WarningLevel } from "../game/types";

type Props = {
  run: GameRun;
  onStep: (direction: Direction) => void;
  onAbandon: () => void;
  onWarp: (coord: Coord) => void;
  onRegenerate: (coord: Coord) => void;
  warningLevel: WarningLevel;
};

const WARNING_COPY: Record<Exclude<WarningLevel, null>, { label: string; body: string }> = {
  slight: {
    label: "wandering",
    body: "you've drifted off course. recheck the briefing.",
  },
  serious: {
    label: "off course",
    body: "two steps away from the goal — turn back.",
  },
  extreme: {
    label: "lost",
    body: "you are heading the wrong way. the moment is slipping.",
  },
};

export function GameView({ run, onStep, onAbandon, onWarp, onRegenerate, warningLevel }: Props) {
  const room = run.visited[coordKey(run.currentCoord)];
  const stepping = run.status === "stepping";
  const [showMission, setShowMission] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [fade, setFade] = useState(false);
  const [yaw, setYaw] = useState(0);
  const viewerRef = useRef<PannellumViewer | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  // continuous keyboard rotation (← / → and A / D)
  useEffect(() => {
    const ROTATE_KEYS = new Set([
      "arrowleft", "arrowright", "a", "d",
    ]);
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!ROTATE_KEYS.has(k)) return;
      // ignore when typing in an input
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      keysRef.current.add(k);
    };
    const onUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    const onBlur = () => keysRef.current.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const SPEED = 110; // degrees per second
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      const v = viewerRef.current;
      if (v) {
        const left = keysRef.current.has("arrowleft") || keysRef.current.has("a");
        const right = keysRef.current.has("arrowright") || keysRef.current.has("d");
        const dir = (right ? 1 : 0) - (left ? 1 : 0);
        if (dir !== 0) {
          try {
            v.setYaw(v.getYaw() + dir * SPEED * dt);
          } catch { /* viewer torn down */ }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (stepping) {
      setFade(true);
    } else {
      const t = setTimeout(() => setFade(false), 300);
      return () => clearTimeout(t);
    }
  }, [stepping]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showMission) setShowMission(false);
        else if (confirmExit) setConfirmExit(false);
        else setConfirmExit(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showMission, confirmExit]);

  if (!room) return null;
  if (!run.scenario) return null;

  const heading = snapYawToDirection(yaw);
  const headingRotation = ((yaw % 360) + 360) % 360;

  return (
    <div className="gameview">
      <div className={`pannellum-fade ${fade ? "dim" : ""}`}>
        <Pannellum
          imageDataUrl={room.imageDataUrl}
          onYawChange={setYaw}
          viewerRef={viewerRef}
        />
      </div>

      <div className="topleft-stack">
        <div
          className="mission-pill"
          onMouseEnter={() => setShowMission(true)}
          onMouseLeave={() => setShowMission(false)}
          onClick={() => setShowMission((v) => !v)}
        >
          mission
        </div>
        <button
          className="exit-pill"
          onClick={() => onRegenerate(run.currentCoord)}
          disabled={stepping}
          aria-label="regenerate scene"
          title="regenerate this scene"
        >
          regenerate
        </button>
        <button
          className="exit-pill"
          onClick={() => setConfirmExit(true)}
          aria-label="exit mission"
          title="exit mission"
        >
          exit
        </button>
      </div>

      {showMission && (
        <div className="mission-popover">
          <p>{run.scenario.mission_statement}</p>
        </div>
      )}

      <div className="right-stack">
        <div className="hourglass-mount">
          <Hourglass stepsTaken={run.stepsTaken} budget={run.scenario.step_budget} />
        </div>
        <div className="minimap-mount">
          <MiniMap run={run} onWarp={onWarp} />
        </div>
      </div>

      {room.name && (
        <div className="room-name-banner" key={coordKey(run.currentCoord)}>
          {room.name}
        </div>
      )}

      {warningLevel && (
        <div className={`course-warning ${warningLevel}`} role="alert">
          <div className="course-warning-eyebrow">— {WARNING_COPY[warningLevel].label} —</div>
          <div className="course-warning-body">{WARNING_COPY[warningLevel].body}</div>
        </div>
      )}

      <div className="heading-mount" aria-label="heading">
        <div className="heading-disc">
          <div className="heading-rose" style={{ transform: `rotate(${-headingRotation}deg)` }}>
            <span className="rose-tick rose-n">N</span>
            <span className="rose-tick rose-e">E</span>
            <span className="rose-tick rose-s">S</span>
            <span className="rose-tick rose-w">W</span>
          </div>
          <div className="heading-needle" />
          <div className="heading-snap">{heading}</div>
        </div>
      </div>

      <div className="forward-mount">
        <ArchControls yaw={yaw} onStep={onStep} disabled={stepping} />
      </div>

      {confirmExit && (
        <div className="confirm-overlay" role="dialog">
          <div className="confirm-card">
            <div className="confirm-eyebrow">— abandon mission —</div>
            <p className="confirm-body">
              The frozen moment will resume. Your progress in this world will be lost.
            </p>
            <div className="confirm-actions">
              <button className="confirm-yes" onClick={onAbandon}>
                abandon
              </button>
              <button className="confirm-no" onClick={() => setConfirmExit(false)}>
                stay
              </button>
            </div>
          </div>
          <button
            className="confirm-scrim"
            onClick={() => setConfirmExit(false)}
            aria-label="cancel"
          />
        </div>
      )}
    </div>
  );
}
