type Props = {
  stepsTaken: number;
  budget: number;
};

export function Hourglass({ stepsTaken, budget }: Props) {
  const progress = budget > 0 ? Math.min(1, stepsTaken / budget) : 0;
  const remaining = Math.max(0, budget - stepsTaken);

  // top bulb empties as progress increases; bottom fills.
  const topFill = 1 - progress;
  const bottomFill = progress;

  return (
    <div className="hourglass">
      <svg viewBox="0 0 60 110" className="hourglass-svg" aria-hidden>
        <defs>
          <clipPath id="topBulb">
            <path d="M 6 6 L 54 6 L 30 50 Z" />
          </clipPath>
          <clipPath id="bottomBulb">
            <path d="M 30 60 L 54 104 L 6 104 Z" />
          </clipPath>
        </defs>

        {/* glass outline */}
        <path
          d="M 6 6 L 54 6 L 30 50 L 54 104 L 6 104 L 30 60 Z"
          fill="rgba(0,0,0,0.35)"
          stroke="rgba(244,243,238,0.7)"
          strokeWidth="1.2"
        />

        {/* top sand */}
        <g clipPath="url(#topBulb)">
          <rect
            x="0"
            y={6 + (1 - topFill) * 44}
            width="60"
            height={topFill * 44}
            fill="#e7c067"
          />
        </g>

        {/* bottom sand */}
        <g clipPath="url(#bottomBulb)">
          <rect
            x="0"
            y={104 - bottomFill * 44}
            width="60"
            height={bottomFill * 44}
            fill="#e7c067"
          />
        </g>

        {/* falling stream */}
        {progress > 0 && progress < 1 && (
          <line
            x1="30" y1="50"
            x2="30" y2="60"
            stroke="#e7c067"
            strokeWidth="1.2"
            opacity="0.85"
          >
            <animate attributeName="opacity" values="0.4;1;0.4" dur="0.6s" repeatCount="indefinite" />
          </line>
        )}

        {/* end caps */}
        <rect x="3" y="3" width="54" height="4" fill="rgba(244,243,238,0.7)" />
        <rect x="3" y="103" width="54" height="4" fill="rgba(244,243,238,0.7)" />
      </svg>
      <div className="hourglass-readout">
        <div className="num">{remaining}</div>
        <div className="cap">steps left</div>
      </div>
    </div>
  );
}
