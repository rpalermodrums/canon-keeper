export type ProcessingRow = {
  stage: string;
  status: string;
  error: string | null;
  updated_at: number;
  document_path: string;
};

export const SUCCESS_BANNER_HIDE_DELAY_MS = 5000;

export type WorkingSuccessTransition = {
  nextWasWorking: boolean;
  nextShowSuccess: boolean;
  hideAfterMs: number | null;
};

export function pickLatest<T extends { updated_at: number }>(rows: readonly T[]): T | null {
  if (rows.length === 0) {
    return null;
  }
  return [...rows].sort((a, b) => b.updated_at - a.updated_at)[0] ?? null;
}

export function normalizePhaseToStage(phase: string): string {
  if (phase === "extract") {
    return "extraction";
  }
  return phase;
}

export function deriveWorkingSuccessTransition(isWorking: boolean, wasWorking: boolean): WorkingSuccessTransition {
  if (isWorking) {
    return {
      nextWasWorking: true,
      nextShowSuccess: false,
      hideAfterMs: null
    };
  }

  if (!wasWorking) {
    return {
      nextWasWorking: false,
      nextShowSuccess: false,
      hideAfterMs: null
    };
  }

  return {
    nextWasWorking: true,
    nextShowSuccess: true,
    hideAfterMs: SUCCESS_BANNER_HIDE_DELAY_MS
  };
}

export function resolveSuccessTimerCompletion(): Pick<WorkingSuccessTransition, "nextWasWorking" | "nextShowSuccess"> {
  return {
    nextWasWorking: false,
    nextShowSuccess: false
  };
}
