declare global {
  interface PannellumViewer {
    destroy: () => void;
    setYaw: (yaw: number) => void;
    getYaw: () => number;
    setPitch: (pitch: number) => void;
    getPitch: () => number;
  }

  interface PannellumViewerOptions {
    type: "equirectangular";
    panorama: string;
    autoLoad?: boolean;
    showControls?: boolean;
    showZoomCtrl?: boolean;
    showFullscreenCtrl?: boolean;
    haov?: number;
    vaov?: number;
    hfov?: number;
    pitch?: number;
    yaw?: number;
    compass?: boolean;
    mouseZoom?: boolean;
    draggable?: boolean;
    keyboardZoom?: boolean;
  }

  interface Window {
    pannellum?: {
      viewer: (elementId: string, options: PannellumViewerOptions) => PannellumViewer;
    };
  }
}

export {};
