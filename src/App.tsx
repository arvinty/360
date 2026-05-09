import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PROMPT,
  type Direction,
  getWorldHistory,
  getWorldNode,
  moveWorld,
  type NodePayload,
  startWorld as startWorldRequest,
  type WorldSummary,
} from "./mockApi";

type PannellumViewer = {
  destroy: () => void;
};

declare global {
  interface Window {
    pannellum?: {
      viewer: (
        elementId: string,
        options: {
          type: "equirectangular";
          panorama: string;
          autoLoad: boolean;
          showZoomCtrl: boolean;
          showFullscreenCtrl: boolean;
          pitch: number;
          yaw: number;
          hfov: number;
        }
      ) => PannellumViewer;
    };
  }
}

const DIRECTIONS: Array<{ id: Direction; label: string; title: string }> = [
  { id: "north", label: "↑", title: "Move North" },
  { id: "west", label: "←", title: "Move West" },
  { id: "east", label: "→", title: "Move East" },
  { id: "south", label: "↓", title: "Move South" },
];

function formatCreatedAt(value: string): string {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export default function App() {
  const viewerRef = useRef<PannellumViewer | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [status, setStatus] = useState("Ready.");
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [history, setHistory] = useState<WorldSummary[]>([]);
  const [worldState, setWorldState] = useState<{ worldId: string | null; x: number; y: number }>({
    worldId: null,
    x: 0,
    y: 0,
  });
  const [cacheState, setCacheState] = useState("-");
  const [activeNode, setActiveNode] = useState<NodePayload | null>(null);

  function renderPanorama(payload: NodePayload) {
    setActiveNode(payload);
    setWorldState({ worldId: payload.worldId, x: payload.x, y: payload.y });
    setCacheState(payload.cacheHit ? "hit" : "miss");
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const data = await getWorldHistory();
      setHistory(data.worlds);
    } catch (error) {
      setHistoryError(getErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function startWorld() {
    setBusy(true);
    setStatus("Starting world and loading origin node...");
    try {
      const data = await startWorldRequest(prompt);
      renderPanorama(data);
      setStatus("World ready. Drag and move to explore.");
      await loadHistory();
    } catch (error) {
      setStatus(`Error: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openWorld(worldId: string, worldPrompt: string) {
    if (!worldId) return;
    setBusy(true);
    setStatus("Opening cached world...");
    try {
      const data = await getWorldNode(worldId, 0, 0);
      renderPanorama(data);
      if (worldPrompt) setPrompt(worldPrompt);
      setStatus("World loaded. Use arrows to explore.");
    } catch (error) {
      setStatus(`Error: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function move(direction: Direction) {
    if (!worldState.worldId) {
      setStatus("Start or open a world first.");
      return;
    }

    setBusy(true);
    setStatus(`Moving ${direction}...`);
    try {
      const data = await moveWorld({
        worldId: worldState.worldId,
        x: worldState.x,
        y: worldState.y,
        direction,
      });
      renderPanorama(data);
      setStatus(`Moved ${direction}. Drag to inspect this location.`);
      await loadHistory();
    } catch (error) {
      setStatus(`Error: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function reloadCurrentNode() {
    if (!worldState.worldId) {
      setStatus("Start or open a world first.");
      return;
    }

    setBusy(true);
    setStatus("Reloading current node...");
    try {
      const data = await getWorldNode(worldState.worldId, worldState.x, worldState.y);
      renderPanorama(data);
      setStatus("Reload complete.");
    } catch (error) {
      setStatus(`Error: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    if (!activeNode) return undefined;

    if (viewerRef.current) {
      viewerRef.current.destroy();
      viewerRef.current = null;
    }

    if (!window.pannellum) {
      setStatus("Error: Pannellum failed to load.");
      return undefined;
    }

    viewerRef.current = window.pannellum.viewer("panorama", {
      type: "equirectangular",
      panorama: activeNode.imageUrl,
      autoLoad: true,
      showZoomCtrl: true,
      showFullscreenCtrl: true,
      pitch: 0,
      yaw: 0,
      hfov: 100,
    });

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [activeNode]);

  const moveDisabled = busy || !worldState.worldId;

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Grid Street-View 360 Explorer</h1>
      </header>

      <div className="layout">
        <aside className="sidebar panel">
          <section>
            <h2 className="section-title">World Prompt</h2>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            <div className="button-row">
              <button disabled={busy} onClick={startWorld}>
                Start World
              </button>
              <button className="secondary" disabled={busy} onClick={reloadCurrentNode}>
                Reload Node
              </button>
            </div>
          </section>

          <div className="status">{status}</div>

          <section>
            <div className="history-head">
              <h2 className="section-title">World History</h2>
              <button className="secondary compact" disabled={busy} onClick={loadHistory}>
                Refresh
              </button>
            </div>
            <div className="history-list">
              {historyLoading && <div className="placeholder">Loading cached worlds...</div>}
              {!historyLoading && historyError && (
                <div className="placeholder">Failed to load history: {historyError}</div>
              )}
              {!historyLoading && !historyError && history.length === 0 && (
                <div className="placeholder">No cached worlds yet. Start your first world.</div>
              )}
              {!historyLoading &&
                !historyError &&
                history.map((world) => (
                  <button
                    className={`history-item ${
                      world.world_id === worldState.worldId ? "active" : ""
                    }`}
                    key={world.world_id}
                    onClick={() => openWorld(world.world_id, world.prompt)}
                  >
                    {world.origin_image_url && (
                      <img
                        className="history-thumb"
                        src={world.origin_image_url}
                        alt="World preview"
                        loading="lazy"
                      />
                    )}
                    <strong>{world.prompt_preview || "Untitled world"}</strong>
                    <div className="meta">
                      <span>{formatCreatedAt(world.created_at)}</span>
                      <span>{world.node_count || 0} nodes</span>
                    </div>
                  </button>
                ))}
            </div>
          </section>
        </aside>

        <main className="viewer-panel panel">
          <div className="panorama-wrap">
            <div id="panorama" className={!worldState.worldId ? "empty" : ""} />
            {!worldState.worldId && <div className="empty-message">Start or open a world.</div>}
            <div className="dpad" aria-label="Movement controls">
              {DIRECTIONS.map((direction) => (
                <button
                  key={direction.id}
                  id={`move-${direction.id}`}
                  title={direction.title}
                  disabled={moveDisabled}
                  onClick={() => move(direction.id)}
                >
                  {direction.label}
                </button>
              ))}
            </div>
          </div>

          <div className="hud">
            <div>World: {worldState.worldId ?? "-"}</div>
            <div>
              Coord: ({worldState.x}, {worldState.y})
            </div>
            <div>Cache: {cacheState}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
