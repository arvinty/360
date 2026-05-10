import { useEffect, useId, useRef } from "react";

type Props = {
  imageDataUrl: string;
  initialYaw?: number;
  onReady?: () => void;
  onYawChange?: (yaw: number) => void;
  viewerRef?: React.MutableRefObject<PannellumViewer | null>;
};

export function Pannellum({ imageDataUrl, initialYaw, onReady, onYawChange, viewerRef }: Props) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const containerId = `pano-${reactId}`;
  const localRef = useRef<PannellumViewer | null>(null);
  const yawCbRef = useRef(onYawChange);
  yawCbRef.current = onYawChange;

  useEffect(() => {
    if (!window.pannellum) return;
    if (localRef.current) {
      localRef.current.destroy();
      localRef.current = null;
    }
    const v = window.pannellum.viewer(containerId, {
      type: "equirectangular",
      panorama: imageDataUrl,
      autoLoad: true,
      showControls: false,
      showZoomCtrl: false,
      showFullscreenCtrl: false,
      haov: 360,
      vaov: 180,
      hfov: 100,
      pitch: 0,
      yaw: initialYaw ?? 0,
      compass: false,
      mouseZoom: false,
      draggable: true,
      keyboardZoom: false,
    });
    localRef.current = v;
    if (viewerRef) viewerRef.current = v;
    onReady?.();

    const container = document.getElementById(containerId);
    const onWheel = (event: WheelEvent) => {
      const cur = localRef.current;
      if (!cur || event.ctrlKey) return;
      // only intercept if the event is happening over our viewer
      const target = event.target as Node | null;
      if (!container || !target || !container.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();

      const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      // detect trackpad: small pixel deltas → scale up so two-finger swipes feel responsive
      const isTrackpad = event.deltaMode === 0 && Math.abs(event.deltaX) < 50 && Math.abs(event.deltaY) < 50;
      const yawScale = isTrackpad ? 0.35 : 0.08;
      const pitchScale = isTrackpad ? 0.25 : 0.06;
      const yawDelta = event.deltaX * deltaScale * yawScale;
      const pitchDelta = event.deltaY * deltaScale * pitchScale;

      try {
        cur.setYaw(cur.getYaw() + yawDelta);
        cur.setPitch(Math.max(-85, Math.min(85, cur.getPitch() - pitchDelta)));
      } catch { /* viewer torn down */ }
    };
    // capture phase + on window so we get the event before any inner canvas swallows it
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });

    let raf = 0;
    let last = NaN;
    const tick = () => {
      const cur = localRef.current;
      if (cur && yawCbRef.current) {
        try {
          const y = cur.getYaw();
          if (last !== y) {
            last = y;
            yawCbRef.current(y);
          }
        } catch { /* not ready yet */ }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      if (localRef.current) {
        localRef.current.destroy();
        localRef.current = null;
      }
      window.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
      if (viewerRef) viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUrl]);

  return <div id={containerId} className="pannellum-stage" />;
}
