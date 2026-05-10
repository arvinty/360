import { useGameRun } from "./hooks/useGameRun";
import { PromptEntry } from "./components/PromptEntry";
import { BriefingScreen } from "./components/BriefingScreen";
import { LoadingScreen } from "./components/LoadingScreen";
import { GameView } from "./components/GameView";
import { EndScreen } from "./components/EndScreen";
import { DebugPanel } from "./components/DebugPanel";

export default function App() {
  const { run, submitPrompt, beginExploration, step, warpTo, regenerateRoom, reset, replaySameWorld, loadCached, warningLevel } = useGameRun();

  let screen: JSX.Element | null = null;

  if (run.status === "idle" || run.status === "generating_scenario") {
    screen = (
      <PromptEntry
        onSubmit={submitPrompt}
        onLoadCached={loadCached}
        loading={run.status === "generating_scenario"}
        error={run.error}
      />
    );
  } else if ((run.status === "briefing" || run.status === "generating_rooms") && run.scenario) {
    const total = run.scenario.room_catalog.length;
    screen = (
      <BriefingScreen
        scenario={run.scenario}
        onBegin={() => void beginExploration()}
        roomsReady={run.roomsReady}
        roomsTotal={total}
        startReady={!!run.prebuiltRooms[0]}
      />
    );
  } else if (run.status === "exploring" || run.status === "stepping") {
    screen = (
      <GameView
        run={run}
        onStep={step}
        onAbandon={reset}
        onWarp={warpTo}
        onRegenerate={(coord) => void regenerateRoom(coord)}
        warningLevel={warningLevel}
      />
    );
  } else if (run.status === "arrived" || run.status === "failed") {
    screen = (
      <EndScreen
        run={run}
        onReplay={reset}
        onSameWorld={replaySameWorld}
      />
    );
  }

  return (
    <>
      {screen}
      <DebugPanel run={run} />
    </>
  );
}
