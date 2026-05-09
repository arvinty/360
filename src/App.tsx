import { type PointerEvent, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PROMPT,
  enterTarget,
  getWorldHistory,
  getWorldNode,
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

export default function App() {
  const viewerRef = useRef<PannellumViewer | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
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
  const [viewerPanDragging, setViewerPanDragging] = useState(false);
  /** True once this pointer session moved past the click threshold (pan / look drag). */
  const panGripRef = useRef(false);
  const pointerStartRef = useRef<PointerStart | null>(null);

  function renderPanorama(payload: NodePayload) {
    setActiveNode(payload);
    setWorldState({ worldId: payload.worldId, nodeId: payload.nodeId });
    setCacheState(payload.cacheHit ? "hit" : "miss");
    setTargetState(payload.target?.targetLabel ?? "-");
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
      setStatus("World ready. Drag to look around, click a target to enter it.");
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
    setStatus("Inspecting target...");
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
      renderPanorama(data);
      setStatus(
        data.target?.targetLabel
          ? `Entered ${data.target.targetLabel}.`
          : "Entered the clicked target."
      );
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

  useEffect(() => {
    if (busy || !worldState.worldId) {
      panGripRef.current = false;
      setViewerPanDragging(false);
    }
  }, [busy, worldState.worldId]);

  function shouldIgnorePointerTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest("button, a, textarea, input, select, .pnlm-controls, .pnlm-load-button")
    );
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || busy || !worldState.worldId || shouldIgnorePointerTarget(event.target)) {
      pointerStartRef.current = null;
      panGripRef.current = false;
      setViewerPanDragging(false);
      return;
    }
    panGripRef.current = false;
    setViewerPanDragging(false);
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: window.performance.now(),
      pointerId: event.pointerId,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const pointerStart = pointerStartRef.current;
    if (!pointerStart || event.pointerId !== pointerStart.pointerId || busy || !worldState.worldId) return;
    if (panGripRef.current) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD_PX) {
      panGripRef.current = true;
      setViewerPanDragging(true);
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    panGripRef.current = false;
    setViewerPanDragging(false);
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
          <div
            className={`panorama-wrap ${worldState.worldId && !busy ? "clickable" : ""} ${
              viewerPanDragging ? "viewer-pan-dragging" : ""
            }`}
            onPointerDown={handlePointerDown}
            onPointerMoveCapture={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              panGripRef.current = false;
              setViewerPanDragging(false);
              pointerStartRef.current = null;
            }}
          >
            <div id="panorama" className={!worldState.worldId ? "empty" : ""} />
            {!worldState.worldId && <div className="empty-message">Start or open a world.</div>}
          </div>

          <div className="hud">
            <div>World: {worldState.worldId ?? "-"}</div>
            <div>Node: {worldState.nodeId ?? "-"}</div>
            <div>Cache: {cacheState}</div>
            <div>Target: {targetState}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
