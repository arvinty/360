import { useEffect, useState } from "react";

type Props = {
  message?: string;
  tips?: string[];
};

const DEFAULT_TIPS = [
  "Read the briefing carefully — it describes the goal room.",
  "Standing still is free. Only stepping forward costs time.",
  "Each room sits along a gradient between calm and catastrophe.",
  "Look through the archways before you move — they hint at adjacent rooms.",
  "Match the room you arrive in against the destination you imagined.",
  "If a step feels wrong, you have a small budget of slack.",
  "Drag to look around. Pick a direction. Step forward when you're ready.",
];

export function LoadingScreen({ message, tips }: Props) {
  const list = tips && tips.length > 0 ? tips : DEFAULT_TIPS;
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (list.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), 4200);
    return () => clearInterval(t);
  }, [list.length]);

  return (
    <div className="loading">
      <div className="loading-card">
        <div className="loading-status">
          <span className="dot" />
          <span>{message ?? "freezing the moment"}…</span>
        </div>
        <div className="tip">
          <div className="tip-eyebrow">mission tip</div>
          <div className="tip-body" key={idx}>{list[idx]}</div>
        </div>
      </div>
    </div>
  );
}
