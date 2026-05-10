import { useEffect } from "react";
import type { Direction } from "../game/types";

type Props = {
  yaw: number;
  onStep: (direction: Direction) => void;
  disabled: boolean;
};

const LABELS: Record<Direction, string> = {
  N: "north",
  E: "east",
  S: "south",
  W: "west",
};

export function snapYawToDirection(yaw: number): Direction {
  const n = ((yaw % 360) + 360) % 360;
  if (n < 45 || n >= 315) return "N";
  if (n < 135) return "E";
  if (n < 225) return "S";
  return "W";
}

export function ArchControls({ yaw, onStep, disabled }: Props) {
  const direction = snapYawToDirection(yaw);
  // arrow points in screen-space toward the cardinal we'll snap to,
  // computed as the difference between view yaw and the cardinal yaw
  const cardinalYaw = direction === "N" ? 0 : direction === "E" ? 90 : direction === "S" ? 180 : 270;
  // delta = how far the cardinal is from where we're looking
  let delta = cardinalYaw - yaw;
  delta = ((delta + 540) % 360) - 180; // normalize to [-180, 180]
  // arrow rotation: 0 = up (forward in view). Negative = left. Positive = right.
  const arrowRotation = delta;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (disabled) return;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W" || e.key === " ") {
        e.preventDefault();
        onStep(direction);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [direction, disabled, onStep]);

  return (
    <button
      className="forward-btn"
      onClick={() => onStep(direction)}
      disabled={disabled}
      aria-label={`step ${LABELS[direction]}`}
    >
      <div className="forward-arrow" style={{ transform: `rotate(${arrowRotation}deg)` }}>
        <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
          <path
            d="M 20 4 L 32 20 L 24 20 L 24 36 L 16 36 L 16 20 L 8 20 Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div className="forward-meta">
        <span className="forward-cap">step</span>
        <span className="forward-dir">{LABELS[direction]}</span>
      </div>
    </button>
  );
}
