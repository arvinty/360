import type { Scenario } from "../game/types";

type Props = {
  scenario: Scenario;
  onBegin: () => void;
  /** number of rooms rendered so far, if pregen is running */
  roomsReady?: number;
  /** total rooms to render (catalog size); when set with roomsReady, shows progress UI */
  roomsTotal?: number;
  /** true once the start room is rendered and the player can enter */
  startReady?: boolean;
};

export function BriefingScreen({
  scenario,
  onBegin,
  roomsReady,
  roomsTotal,
  startReady,
}: Props) {
  const showProgress = typeof roomsTotal === "number" && typeof roomsReady === "number";
  const pct = showProgress && roomsTotal! > 0 ? Math.round((roomsReady! / roomsTotal!) * 100) : 0;
  const fullyReady = !showProgress || (roomsReady! >= roomsTotal!);
  const canEnter = !showProgress || !!startReady;

  return (
    <div className="briefing">
      <div className="briefing-inner">
        <div className="briefing-eyebrow">— mission briefing —</div>
        <p className="briefing-body">
          {scenario.mission_statement}
        </p>
        <div className="briefing-meta">
          <span>budget · {scenario.step_budget} steps</span>
          <span>·</span>
          <span>time ticks down every step you take</span>
        </div>

        {showProgress && (
          <div className="briefing-progress">
            <div className="briefing-progress-bar">
              <div className="briefing-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="briefing-progress-meta">
              {fullyReady
                ? "all rooms rendered"
                : `rendering rooms · ${roomsReady}/${roomsTotal}`}
            </div>
          </div>
        )}

        <button className="begin" onClick={onBegin} disabled={!canEnter}>
          {!canEnter
            ? "preparing the start room…"
            : fullyReady
            ? "begin"
            : "begin (rooms still rendering)"}
        </button>
      </div>
    </div>
  );
}
