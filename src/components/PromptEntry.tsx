import { useEffect, useState } from "react";
import { listCachedRuns, deleteCachedRun, type CachedRunMeta } from "../game/cacheDB";

type Props = {
  onSubmit: (prompt: string) => void;
  onLoadCached: (seed: string) => Promise<boolean>;
  loading: boolean;
  error?: string;
};

const SUGGESTIONS = [
  "a marble observatory the night a comet enters the atmosphere",
  "a flooded library at the moment a pipe gives way",
  "a server farm in a desert, the cooling about to fail",
  "a winter cathedral as the buttress fractures",
  "a greenhouse at the instant a hailstorm hits",
];

export function PromptEntry({ onSubmit, onLoadCached, loading, error }: Props) {
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<CachedRunMeta[]>([]);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    void listCachedRuns().then(setRecent);
  }, []);

  function submit(t: string) {
    const v = (t || text).trim();
    if (!v || loading) return;
    onSubmit(v);
  }

  async function open(meta: CachedRunMeta) {
    if (loading || opening) return;
    setOpening(meta.seed);
    const ok = await onLoadCached(meta.seed);
    if (!ok) {
      setOpening(null);
      // stale entry — drop it
      await deleteCachedRun(meta.seed);
      setRecent((r) => r.filter((m) => m.seed !== meta.seed));
    }
  }

  async function remove(seed: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteCachedRun(seed);
    setRecent((r) => r.filter((m) => m.seed !== seed));
  }

  return (
    <div className="prompt-entry">
      <div className="prompt-inner">
        <h1 className="title">A Flicker In Time</h1>
        <p className="subtitle">
          Time is paused inside the half-second before a disaster.
          You are dropped into a frozen panoramic world.
          Reach the room where it can still be averted — before your steps run out.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(text); }}
          className="prompt-form"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="describe a world…"
            autoFocus
            spellCheck={false}
            disabled={loading}
          />
          <button type="submit" disabled={loading || !text.trim()}>
            {loading ? "composing…" : "compose"}
          </button>
        </form>

        {error && <div className="prompt-error">{error}</div>}

        {recent.length > 0 && (
          <div className="recent-runs">
            <div className="recent-eyebrow">past worlds · instant replay</div>
            <div className="recent-grid">
              {recent.map((m) => (
                <button
                  key={m.seed}
                  className={`recent-card ${opening === m.seed ? "opening" : ""}`}
                  onClick={() => open(m)}
                  disabled={loading || opening !== null}
                  title={m.scenario.mission_statement}
                >
                  <span className="recent-prompt">{m.worldPrompt}</span>
                  <span className="recent-meta">
                    <span>{Math.round(m.roomsCached * 100)}% cached</span>
                    <span>·</span>
                    <span>{relativeTime(m.savedAt)}</span>
                  </span>
                  <span
                    className="recent-remove"
                    role="button"
                    aria-label="remove"
                    onClick={(e) => remove(m.seed, e)}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="suggestion"
              disabled={loading}
              onClick={() => { setText(s); submit(s); }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
