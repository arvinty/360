import { useEffect, useState } from "react";
import type { GameRun } from "../game/types";
import { PathReveal } from "./PathReveal";

type Props = {
  run: GameRun;
  onReplay: () => void;
  onSameWorld: () => void;
};

function lastSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const matches = trimmed.match(/[^.!?]+[.!?]+/g);
  if (!matches || matches.length === 0) return trimmed;
  return matches[matches.length - 1].trim();
}

export function EndScreen({ run, onReplay, onSameWorld }: Props) {
  const arrived = run.status === "arrived";
  const [stage, setStage] = useState(0);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    const a = setTimeout(() => setStage(1), 700);
    const b = setTimeout(() => setStage(2), 2200);
    const c = setTimeout(() => setStage(3), 3700);
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c); };
  }, []);

  const headline = arrived ? "the moment unfreezes" : "the moment completes";
  const resolution = run.scenario ? lastSentence(run.scenario.mission_statement) : "";
  const remaining = run.scenario ? run.scenario.step_budget - run.stepsTaken : 0;

  return (
    <div className={`endscreen ${arrived ? "arrived" : "failed"}`}>
      <div className="end-inner">
        <h1 className={`end-head stage-${stage}`}>{headline}</h1>
        {stage >= 1 && resolution && (
          <p className="end-resolution stage-1">{resolution}</p>
        )}
        {stage >= 2 && (
          <div className="end-score">
            {arrived ? (
              <>
                <span className="num">{remaining}</span>
                <span className="cap">steps to spare</span>
              </>
            ) : (
              <>
                <span className="num">{run.stepsTaken}</span>
                <span className="cap">/ {run.scenario?.step_budget} steps spent</span>
              </>
            )}
          </div>
        )}
        {stage >= 3 && (
          <div className="end-actions">
            <button onClick={onSameWorld}>same world again</button>
            <button onClick={onReplay} className="ghost">try another world</button>
            <button onClick={() => setReveal(true)} className="ghost reveal-trigger">
              reveal correct path
            </button>
          </div>
        )}
      </div>

      {reveal && <PathReveal run={run} onClose={() => setReveal(false)} />}
    </div>
  );
}
