import { useState } from "react";

type Props = {
  onSubmit: (prompt: string) => void;
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

export function PromptEntry({ onSubmit, loading, error }: Props) {
  const [text, setText] = useState("");

  function submit(t: string) {
    const v = (t || text).trim();
    if (!v || loading) return;
    onSubmit(v);
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
