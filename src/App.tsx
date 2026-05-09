import { type PointerEvent, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PROMPT,
  enterTarget,
  type Goal,
  getWorldHistory,
  getWorldNode,
  markGoalFound,
  type NodePayload,
  startWorld as startWorldRequest,
  type WorldSummary,
} from "./mockApi";

type PannellumViewer = {
  destroy: () => void;
  mouseEventToCoords: (event: MouseEvent) => [number, number];
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

const CLICK_MOVE_THRESHOLD_PX = 6;
const CLICK_TIME_THRESHOLD_MS = 350;

type PointerStart = {
  x: number;
  y: number;
  time: number;
  pointerId: number;
};

function formatCreatedAt(value: string): string {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function goalStageLabel(moves: number): string {
  if (moves <= 2) return "vague";
  if (moves <= 5) return "stronger";
  return "reveal";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function historyTitle(world: WorldSummary): string {
  if (world.goal_origin && world.goal_target) {
    return `${truncate(world.goal_origin, 60)} → ${truncate(world.goal_target, 40)}`;
  }
  return world.prompt_preview || "Untitled world";
}

export default function App() {
  const viewerRef = useRef<PannellumViewer | null>(null);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("Ready.");
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [history, setHistory] = useState<WorldSummary[]>([]);
  const [worldState, setWorldState] = useState<{
    worldId: string | null;
    nodeId: string | null;
  }>({
    worldId: null,
    nodeId: null,
  });
  const [cacheState, setCacheState] = useState("-");
  const [targetState, setTargetState] = useState("-");
  const [activeNode, setActiveNode] = useState<NodePayload | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [winDismissed, setWinDismissed] = useState(false);
  const pointerStartRef = useRef<PointerStart | null>(null);
  const isDev = import.meta.env.DEV;

  function renderPanorama(payload: NodePayload) {
    setActiveNode(payload);
    setWorldState({ worldId: payload.worldId, nodeId: payload.nodeId });
    setCacheState(payload.cacheHit ? "hit" : "miss");
    setTargetState(payload.target?.targetLabel ?? "-");
    setGoal(payload.goal);
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

  async function startWorld(promptOverride?: string) {
    setBusy(true);
    setStatus("Starting world and generating origin + goal...");
    setWinDismissed(false);
    try {
      const data = await startWorldRequest(promptOverride ?? prompt);
      renderPanorama(data);
      setStatus("World ready. Drag to look around, click a target to enter it.");
      await loadHistory();
    } catch (error) {
      setStatus(`Error: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function startNewGame() {
    const userHint = prompt.trim();
    if (!userHint) {
      await startWorld("");
      return;
    }
    const seed = Math.random().toString(36).slice(2, 8);
    await startWorld(`${userHint} :: seed-${seed}`);
  }

  async function handleMarkFound() {
    if (!worldState.worldId) return;
    setBusy(true);
    try {
      const updated = await markGoalFound(worldState.worldId);
      setGoal(updated);
      setStatus(`Marked ${updated.target} as found.`);
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
    setWinDismissed(false);
    try {
      const data = await getWorldNode(worldId);
      renderPanorama(data);
      if (worldPrompt) setPrompt(worldPrompt);
      setStatus("World loaded. Drag to look around, click a target to enter it.");
    } catch (error) {
      setStatus(`Error: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function enterClickedTarget(pitch: number, yaw: number) {
    if (!worldState.worldId || !worldState.nodeId || !activeNode) {
      setStatus("Start or open a world first.");
      return;
    }

    setBusy(true);
    setStatus("Inspecting target and generating next view...");
    try {
      const data = await enterTarget({
        worldId: worldState.worldId,
        parentNodeId: worldState.nodeId,
        sourceImageUrl: activeNode.imageUrl,
        pitch,
        yaw,
        onProgress: (progress) => {
          setStatus(progress === "inspect" ? "Inspecting target..." : "Generating next view...");
        },
      });
      setStatus(data.cacheHit ? "Reopening cached target..." : "Generating next view...");
      renderPanorama(data);
      if (data.goal?.won) {
        setStatus(`You found ${data.goal.target} in ${data.goal.moves} move${data.goal.moves === 1 ? "" : "s"}!`);
      } else {
        setStatus(
          data.target?.targetLabel
            ? `Entered ${data.target.targetLabel}.`
            : "Entered the clicked target."
        );
      }
      await loadHistory();
    } catch (error) {
      setStatus(`Error: ${getErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function reloadCurrentNode() {
    if (!worldState.worldId || !worldState.nodeId) {
      setStatus("Start or open a world first.");
      return;
    }

    setBusy(true);
    setStatus("Reloading current node...");
    try {
      const data = await getWorldNode(worldState.worldId, worldState.nodeId);
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

  function shouldIgnorePointerTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest("button, a, textarea, input, select, .pnlm-controls, .pnlm-load-button")
    );
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || busy || !worldState.worldId || shouldIgnorePointerTarget(event.target)) {
      pointerStartRef.current = null;
      return;
    }
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: window.performance.now(),
      pointerId: event.pointerId,
    };
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const pointerStart = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
    if (busy || !viewerRef.current || shouldIgnorePointerTarget(event.target)) return;

    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    const distance = Math.hypot(dx, dy);
    const elapsed = window.performance.now() - pointerStart.time;
    if (distance > CLICK_MOVE_THRESHOLD_PX || elapsed > CLICK_TIME_THRESHOLD_MS) return;

    const mouseEvent = new MouseEvent("mouseup", {
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      bubbles: true,
    });
    const [pitch, yaw] = viewerRef.current.mouseEventToCoords(mouseEvent);
    void enterClickedTarget(pitch, yaw);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Grid Street-View 360 Explorer</h1>
      </header>

      <div className="layout">
        <aside className="sidebar panel">
          <section>
            <h2 className="section-title">World Prompt (optional style hint)</h2>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={`Optional. Describe the world you want to start in.\nExample: ${DEFAULT_PROMPT}\nLeave empty to let the game invent something for you.`}
            />
            <div className="button-row">
              <button disabled={busy} onClick={() => startWorld()}>
                Start Game
              </button>
              <button className="secondary" disabled={busy} onClick={startNewGame}>
                New Game
              </button>
            </div>
            <div className="button-row">
              <button className="secondary" disabled={busy} onClick={reloadCurrentNode}>
                Reload Node
              </button>
              {isDev && goal && !goal.won && (
                <button className="secondary" disabled={busy} onClick={handleMarkFound}>
                  Mark Found (dev)
                </button>
              )}
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
                    <strong>{historyTitle(world)}</strong>
                    <div className="meta">
                      <span>{formatCreatedAt(world.created_at)}</span>
                      <span>{world.node_count || 0} nodes</span>
                      {world.goal_moves !== null && (
                        <span>
                          {world.goal_won ? `won · ${world.goal_moves} mv` : `${world.goal_moves} mv`}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
            </div>
          </section>
        </aside>

        <main className="viewer-panel panel">
          <div
            className={`panorama-wrap ${worldState.worldId && !busy ? "clickable" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              pointerStartRef.current = null;
            }}
          >
            <div id="panorama" className={!worldState.worldId ? "empty" : ""} />
            {!worldState.worldId && <div className="empty-message">Start a game.</div>}
            {goal && !goal.won && (
              <div className="goal-banner">
                <span className="goal-label">Find:</span> {goal.target}
                <span className="goal-stage"> · move {goal.moves} · {goalStageLabel(goal.moves)}</span>
              </div>
            )}
            {goal?.won && !winDismissed && (
              <div className="win-overlay" role="dialog" aria-modal="true">
                <div className="win-card">
                  <h2>You found {goal.target}!</h2>
                  <p>
                    Solved in {goal.moves} move{goal.moves === 1 ? "" : "s"}.
                  </p>
                  {goal.wonEvidence && <p className="win-evidence">"{goal.wonEvidence}"</p>}
                  <div className="button-row">
                    <button disabled={busy} onClick={startNewGame}>
                      New Game
                    </button>
                    <button className="secondary" onClick={() => setWinDismissed(true)}>
                      Keep exploring
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="hud">
            <div>World: {worldState.worldId ?? "-"}</div>
            <div>Node: {worldState.nodeId ?? "-"}</div>
            <div>Cache: {cacheState}</div>
            <div>Click target: {targetState}</div>
            {goal && (
              <>
                <div>Origin: {goal.origin}</div>
                <div>Goal: {goal.target}</div>
                <div>
                  Move {goal.moves} · stage {goalStageLabel(goal.moves)}
                  {goal.won ? " · WON" : ""}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
