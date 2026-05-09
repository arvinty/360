import { type PointerEvent, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PROMPT,
  enterTarget,
  type Goal,
  getWorldMoveTree,
  getWorldHistory,
  getWorldNode,
  markGoalFound,
  type MoveTreeNode,
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
const TOAST_INFO_DURATION_MS = 3500;
const TOAST_ERROR_DURATION_MS = 6000;

type PointerStart = {
  x: number;
  y: number;
  time: number;
  pointerId: number;
};

type ToastTone = "info" | "error";

type Toast = {
  message: string;
  tone: ToastTone;
  key: number;
};

type TreeRenderRow = {
  node: MoveTreeNode;
  hasSiblingPath: boolean[];
  branchType: "root" | "tee" | "elbow";
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

function historyTitle(world: WorldSummary): string {
  const originShort = world.goal_origin_short || world.goal_origin;
  const targetShort = world.goal_target_short || world.goal_target;
  if (originShort && targetShort) {
    return `${originShort} → ${targetShort}`;
  }
  return world.prompt_preview || "Untitled world";
}

function goalDisplayTarget(goal: Goal): string {
  return goal.targetShort || goal.target;
}

function buildTreeRows(nodes: MoveTreeNode[]): TreeRenderRow[] {
  if (!nodes.length) return [];
  const byParent = new Map<string, MoveTreeNode[]>();
  const allIds = new Set(nodes.map((node) => node.node_id));

  for (const node of nodes) {
    const parentId = node.parent_node_id ?? "__root__";
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(node);
    byParent.set(parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.step - right.step);
  }

  const roots = nodes
    .filter((node) => !node.parent_node_id || !allIds.has(node.parent_node_id))
    .sort((left, right) => left.step - right.step);

  const rows: TreeRenderRow[] = [];
  const visited = new Set<string>();

  function walk(node: MoveTreeNode, guides: boolean[], branchType: TreeRenderRow["branchType"]) {
    if (visited.has(node.node_id)) return;
    visited.add(node.node_id);
    rows.push({ node, hasSiblingPath: guides, branchType });
    const children = byParent.get(node.node_id) ?? [];
    children.forEach((child, index) => {
      const hasNextSibling = index < children.length - 1;
      walk(child, [...guides, hasNextSibling], hasNextSibling ? "tee" : "elbow");
    });
  }

  roots.forEach((root, index) => {
    const hasNextRoot = index < roots.length - 1;
    walk(root, [hasNextRoot], "root");
  });

  return rows;
}

export default function App() {
  const viewerRef = useRef<PannellumViewer | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [history, setHistory] = useState<WorldSummary[]>([]);
  const [moveTreeLoading, setMoveTreeLoading] = useState(false);
  const [moveTreeError, setMoveTreeError] = useState("");
  const [moveTree, setMoveTree] = useState<MoveTreeNode[]>([]);
  const [worldState, setWorldState] = useState<{
    worldId: string | null;
    nodeId: string | null;
  }>({
    worldId: null,
    nodeId: null,
  });
  const [activeNode, setActiveNode] = useState<NodePayload | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [winDismissed, setWinDismissed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyStatus, setBusyStatus] = useState<string | null>(null);
  const [viewerPanDragging, setViewerPanDragging] = useState(false);
  /** True once this pointer session moved past the click threshold (pan / look drag). */
  const panGripRef = useRef(false);
  const pointerStartRef = useRef<PointerStart | null>(null);
  const toastSeqRef = useRef(0);
  const isDev = import.meta.env.DEV;

  function pushToast(message: string, tone: ToastTone = "info") {
    toastSeqRef.current += 1;
    setToast({ message, tone, key: toastSeqRef.current });
  }

  function renderPanorama(payload: NodePayload) {
    setActiveNode(payload);
    setWorldState({ worldId: payload.worldId, nodeId: payload.nodeId });
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

  async function loadMoveTree(worldIdOverride?: string) {
    const targetWorldId = worldIdOverride ?? worldState.worldId;
    if (!targetWorldId) {
      setMoveTree([]);
      setMoveTreeError("");
      setMoveTreeLoading(false);
      return;
    }
    setMoveTreeLoading(true);
    setMoveTreeError("");
    try {
      const data = await getWorldMoveTree(targetWorldId);
      setMoveTree(data.nodes);
    } catch (error) {
      setMoveTreeError(getErrorMessage(error));
    } finally {
      setMoveTreeLoading(false);
    }
  }

  async function startWorld(promptOverride?: string) {
    setBusy(true);
    setBusyStatus("Starting world…");
    pushToast("Starting world and generating origin + goal…");
    setWinDismissed(false);
    try {
      const data = await startWorldRequest(promptOverride ?? prompt);
      renderPanorama(data);
      pushToast("World ready. Drag to look, click a target to enter.");
      await loadMoveTree(data.worldId);
      await loadHistory();
    } catch (error) {
      pushToast(`Error: ${getErrorMessage(error)}`, "error");
    } finally {
      setBusyStatus(null);
      setBusy(false);
    }
  }

  function returnToHero() {
    setWorldState({ worldId: null, nodeId: null });
    setActiveNode(null);
    setGoal(null);
    setWinDismissed(false);
    setPrompt("");
    setDrawerOpen(false);
    setMoveTree([]);
    setMoveTreeError("");
    setMoveTreeLoading(false);
  }

  async function handleMarkFound() {
    if (!worldState.worldId) return;
    setBusy(true);
    setBusyStatus("Marking goal found…");
    try {
      const updated = await markGoalFound(worldState.worldId);
      setGoal(updated);
      pushToast(`Marked ${goalDisplayTarget(updated)} as found.`);
    } catch (error) {
      pushToast(`Error: ${getErrorMessage(error)}`, "error");
    } finally {
      setBusyStatus(null);
      setBusy(false);
    }
  }

  async function openWorld(worldId: string) {
    if (!worldId) return;
    setBusy(true);
    setBusyStatus("Opening world…");
    setWinDismissed(false);
    setDrawerOpen(false);
    pushToast("Opening world…");
    try {
      const data = await getWorldNode(worldId);
      renderPanorama(data);
      await loadMoveTree(data.worldId);
      pushToast("World loaded. Drag to look, click a target to enter.");
    } catch (error) {
      pushToast(`Error: ${getErrorMessage(error)}`, "error");
    } finally {
      setBusyStatus(null);
      setBusy(false);
    }
  }

  async function enterClickedTarget(pitch: number, yaw: number) {
    if (!worldState.worldId || !worldState.nodeId || !activeNode) {
      pushToast("Start a game first.", "error");
      return;
    }

    setBusy(true);
    setBusyStatus("Inspecting target…");
    pushToast("Inspecting target…");
    try {
      const data = await enterTarget({
        worldId: worldState.worldId,
        parentNodeId: worldState.nodeId,
        sourceImageUrl: activeNode.imageUrl,
        pitch,
        yaw,
        onProgress: (progress) => {
          setBusyStatus(progress === "inspect" ? "Inspecting target…" : "Generating next view…");
          pushToast(progress === "inspect" ? "Inspecting target…" : "Generating next view…");
        },
      });
      renderPanorama(data);
      if (data.goal?.won) {
        const moves = data.goal.moves;
        pushToast(
          `You found ${goalDisplayTarget(data.goal)} in ${moves} move${moves === 1 ? "" : "s"}!`
        );
      } else if (data.target?.targetLabel) {
        pushToast(`Entered ${data.target.targetLabel}.`);
      } else {
        pushToast("Entered the clicked target.");
      }
      await loadMoveTree(data.worldId);
      await loadHistory();
    } catch (error) {
      pushToast(`Error: ${getErrorMessage(error)}`, "error");
    } finally {
      setBusyStatus(null);
      setBusy(false);
    }
  }

  async function reloadCurrentNode() {
    if (!worldState.worldId || !worldState.nodeId) {
      pushToast("Start a game first.", "error");
      return;
    }

    setBusy(true);
    setBusyStatus("Reloading current scene…");
    pushToast("Reloading current node…");
    try {
      const data = await getWorldNode(worldState.worldId, worldState.nodeId);
      renderPanorama(data);
      await loadMoveTree(data.worldId);
      pushToast("Reload complete.");
    } catch (error) {
      pushToast(`Error: ${getErrorMessage(error)}`, "error");
    } finally {
      setBusyStatus(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    if (!worldState.worldId) return;
    void loadMoveTree(worldState.worldId);
  }, [worldState.worldId]);

  useEffect(() => {
    if (drawerOpen) void loadHistory();
  }, [drawerOpen]);

  useEffect(() => {
    if (!toast) return undefined;
    const duration = toast.tone === "error" ? TOAST_ERROR_DURATION_MS : TOAST_INFO_DURATION_MS;
    const timer = window.setTimeout(() => {
      setToast((current) => (current && current.key === toast.key ? null : current));
    }, duration);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && drawerOpen) {
        setDrawerOpen(false);
        return;
      }
      if (
        isDev &&
        event.key === "F" &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        worldState.worldId &&
        goal &&
        !goal.won &&
        !busy
      ) {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
        event.preventDefault();
        void handleMarkFound();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    if (!activeNode) return undefined;

    if (viewerRef.current) {
      viewerRef.current.destroy();
      viewerRef.current = null;
    }

    if (!window.pannellum) {
      pushToast("Error: Pannellum failed to load.", "error");
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

  async function openWorldNode(nodeId: string) {
    if (!worldState.worldId || !nodeId) return;
    setBusy(true);
    setBusyStatus("Jumping to selected scene…");
    pushToast("Jumping to selected scene…");
    try {
      const data = await getWorldNode(worldState.worldId, nodeId);
      renderPanorama(data);
      pushToast("Moved to selected scene.");
    } catch (error) {
      pushToast(`Error: ${getErrorMessage(error)}`, "error");
    } finally {
      setBusyStatus(null);
      setBusy(false);
    }
  }

  function moveNodeLabel(node: MoveTreeNode): string {
    if (node.is_origin) return "Start";
    if (node.target_label) return node.target_label;
    return "Scene";
  }

  const hasWorld = Boolean(worldState.worldId);
  const targetShort = goal ? goalDisplayTarget(goal) : "";
  const currentSceneLabel =
    activeNode?.target?.targetLabel || goal?.originShort || goal?.origin || "Start";
  const sessionStatusText = busyStatus || `Current scene: ${currentSceneLabel}`;
  const treeRows = buildTreeRows(moveTree);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          type="button"
          className="icon-button"
          aria-label={drawerOpen ? "Close history" : "Open history"}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M4 6h16M4 12h16M4 18h16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <h1 className="topbar-title">360 Explorer</h1>
        <div className="topbar-spacer" />
        {hasWorld && (
          <button
            type="button"
            className="icon-button"
            aria-label="Reload current view"
            disabled={busy}
            onClick={reloadCurrentNode}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M21 12a9 9 0 1 1-3.2-6.9M21 4v5h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </header>

      <main className="stage">
        <div
          className={`panorama-wrap ${hasWorld && !busy ? "clickable" : ""} ${
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
          <div id="panorama" className={!hasWorld ? "empty" : ""} />

          {!hasWorld && (
            <div className="hero">
              <div className="hero-card">
                <h2 className="hero-title">Where do you want to go?</h2>
                <p className="hero-subtitle">
                  Describe a place, or leave it empty and we'll surprise you.
                </p>
                <textarea
                  className="hero-input"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={`Optional. Example: ${DEFAULT_PROMPT}`}
                  rows={3}
                />
                <button
                  type="button"
                  className="hero-cta"
                  disabled={busy}
                  onClick={() => startWorld()}
                >
                  Start Game
                </button>
              </div>
            </div>
          )}

          {hasWorld && goal && !goal.won && (
            <div className="goal-banner">
              <span className="goal-label">Find:</span> {targetShort}
            </div>
          )}

          {hasWorld && goal?.won && !winDismissed && (
            <div className="win-overlay" role="dialog" aria-modal="true">
              <div className="win-card">
                <h2>You found {targetShort}!</h2>
                <p>
                  Solved in {goal.moves} move{goal.moves === 1 ? "" : "s"}.
                </p>
                {goal.wonEvidence && <p className="win-evidence">"{goal.wonEvidence}"</p>}
                <div className="button-row">
                  <button type="button" disabled={busy} onClick={returnToHero}>
                    New Game
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setWinDismissed(true)}
                  >
                    Keep exploring
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        {hasWorld && (
          <aside className="session-map-panel" aria-label="Session move map">
            <div className="session-map-head">
              <h3 className="move-map-title">Move Map</h3>
            </div>
            <div className="move-map-list">
              {moveTreeLoading && <div className="placeholder">Loading move map…</div>}
              {!moveTreeLoading && moveTreeError && (
                <div className="placeholder">Failed to load move map: {moveTreeError}</div>
              )}
              {!moveTreeLoading && !moveTreeError && moveTree.length === 0 && (
                <div className="placeholder">No moves yet.</div>
              )}
              {!moveTreeLoading &&
                !moveTreeError &&
                treeRows.map((row) => (
                  <button
                    type="button"
                    key={row.node.node_id}
                    className={`move-map-node ${
                      row.node.node_id === worldState.nodeId ? "active" : ""
                    }`}
                    onClick={() => openWorldNode(row.node.node_id)}
                    disabled={busy}
                    title={formatCreatedAt(row.node.created_at)}
                  >
                    <span className="tree-guides" aria-hidden="true">
                      {row.hasSiblingPath.map((hasSibling, index) => (
                        <span
                          // eslint-disable-next-line react/no-array-index-key
                          key={`${row.node.node_id}-g-${index}`}
                          className={`tree-guide ${hasSibling ? "line" : "empty"}`}
                        />
                      ))}
                      {row.branchType !== "root" && (
                        <span className={`tree-branch ${row.branchType}`} />
                      )}
                    </span>
                    <span className="node-step">#{row.node.step}</span>
                    <span className="node-label">{moveNodeLabel(row.node)}</span>
                  </button>
                ))}
            </div>
          </aside>
        )}
        {hasWorld && <div className="session-status-bar">{sessionStatusText}</div>}
      </main>

      {toast && (
        <div className={`toast toast-${toast.tone}`} key={toast.key} role="status">
          {toast.message}
        </div>
      )}

      {drawerOpen && (
        <div
          className="drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`drawer ${drawerOpen ? "open" : ""}`} aria-hidden={!drawerOpen}>
        <div className="drawer-head">
          <h2 className="drawer-title">History</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close history"
            onClick={() => setDrawerOpen(false)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="drawer-new"
          onClick={returnToHero}
          disabled={busy}
        >
          <span className="plus" aria-hidden="true">+</span> New game
        </button>
        <div className="drawer-list">
          {historyLoading && <div className="placeholder">Loading…</div>}
          {!historyLoading && historyError && (
            <div className="placeholder">Failed to load history: {historyError}</div>
          )}
          {!historyLoading && !historyError && history.length === 0 && (
            <div className="placeholder">No games yet. Start one to see it here.</div>
          )}
          {!historyLoading &&
            !historyError &&
            history.map((world) => (
              <button
                type="button"
                className={`history-item ${
                  world.world_id === worldState.worldId ? "active" : ""
                }`}
                key={world.world_id}
                onClick={() => openWorld(world.world_id)}
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
      </aside>
    </div>
  );
}
