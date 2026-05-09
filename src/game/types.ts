export type Coord = readonly [number, number];

export type GradientPoint = { p: number; descriptor: string };

export type RoomCatalogEntry = {
  name: string;
  concept: string;
};

export type NavigationClueSet = {
  class_name: string;
  correct_object: string;
  decoy_objects: string[];
};

export type DoorClue = {
  direction: Direction;
  object: string;
  isCorrect: boolean;
};

export type Scenario = {
  mission_statement: string;
  start_room_descriptor: string;
  destination_room_descriptor: string;
  gradient_axes: string[];
  crisis_summary: string;
  step_budget: number;
  descriptor_curve: GradientPoint[];
  art_style: string;
  room_catalog: RoomCatalogEntry[];
  navigation_clue_sets: NavigationClueSet[];
};

export type RoomData = {
  coord: Coord;
  imageDataUrl: string;
  descriptor: string;
  gradientPosition: number;
  generatedAt: number;
  name: string;
  concept: string;
  catalogIndex: number;
  navigationClues?: DoorClue[];
};

export type RunStatus =
  | "idle"
  | "generating_scenario"
  | "briefing"
  | "generating_rooms"
  | "exploring"
  | "stepping"
  | "arrived"
  | "failed";

export type GameRun = {
  seed: string;
  worldPrompt: string;
  scenario: Scenario | null;
  startCoord: Coord;
  destinationCoord: Coord;
  currentCoord: Coord;
  visited: Record<string, RoomData>;
  /** coordKey -> catalog index, ensures room names stay unique within a run */
  coordToCatalogIndex: Record<string, number>;
  /** catalogIndex -> pregenerated room data (no coord assigned yet) */
  prebuiltRooms: Record<number, RoomData>;
  roomsReady: number;
  stepsTaken: number;
  /** consecutive steps that increased distance to destination (resets on a correct step) */
  wrongStreak: number;
  /** consecutive steps that left distance unchanged (resets on a correct step) */
  neutralStreak: number;
  status: RunStatus;
  error?: string;
};

export type WarningLevel = "slight" | "serious" | "extreme" | null;

export type Direction = "N" | "E" | "S" | "W";
