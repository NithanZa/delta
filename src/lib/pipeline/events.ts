export type RunStage = "select" | "extract" | "synthesis" | "insights" | "finalize" | "error";

export type RunEvent = {
  stage: RunStage;
  message: string;
  level?: "info" | "warn" | "error";
  /** Optional structured payload (snapshot id, counts, …) for the UI. */
  data?: Record<string, unknown>;
};

export type OnEvent = (event: RunEvent) => void;
