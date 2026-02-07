import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  deriveWorkingSuccessTransition,
  normalizePhaseToStage,
  pickLatest,
  resolveSuccessTimerCompletion,
  type ProcessingRow
} from "./progressBannerUtils";

const STAGE_LABELS: Record<string, string> = {
  ingest: "Reading your manuscript",
  scenes: "Finding scenes",
  style: "Analyzing style",
  extract: "Extracting characters and locations",
  extraction: "Extracting characters and locations",
  continuity: "Checking for continuity issues"
};

type ProgressBannerProps = {
  processingState: ProcessingRow[];
  statusPhase: string;
};

function friendlyStageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1);
}

function fileNameFromPath(filePath: string): string {
  const pieces = filePath.split(/[\\/]/).filter(Boolean);
  return pieces[pieces.length - 1] ?? filePath;
}

export function ProgressBanner({ processingState, statusPhase }: ProgressBannerProps): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const wasWorkingRef = useRef(false);

  const runningRows = useMemo(
    () => processingState.filter((row) => row.status === "running"),
    [processingState]
  );
  const activeRows = useMemo(
    () => processingState.filter((row) => row.status === "running" || row.status === "pending"),
    [processingState]
  );

  const hasRunningRows = runningRows.length > 0;
  const isWorking = hasRunningRows;

  useEffect(() => {
    const transition = deriveWorkingSuccessTransition(isWorking, wasWorkingRef.current);
    wasWorkingRef.current = transition.nextWasWorking;
    setShowSuccess(transition.nextShowSuccess);

    if (transition.hideAfterMs === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      const resolved = resolveSuccessTimerCompletion();
      setShowSuccess(resolved.nextShowSuccess);
      wasWorkingRef.current = resolved.nextWasWorking;
    }, transition.hideAfterMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isWorking]);

  const activeRow = useMemo(() => {
    const running = pickLatest(runningRows);
    if (running) {
      return running;
    }
    const pending = pickLatest(activeRows);
    if (pending) {
      return pending;
    }
    if (statusPhase === "idle") {
      return null;
    }
    const phaseStage = normalizePhaseToStage(statusPhase);
    const phaseRows = processingState.filter((row) => row.stage === phaseStage);
    return pickLatest(phaseRows) ?? pickLatest(processingState);
  }, [activeRows, processingState, runningRows, statusPhase]);

  const activeFileName = activeRow?.document_path ? fileNameFromPath(activeRow.document_path) : null;

  const queueRemaining = useMemo(() => {
    const queuedFiles = Array.from(
      new Set(
        activeRows
          .map((row) => row.document_path)
          .filter((path): path is string => typeof path === "string" && path.length > 0)
      )
    );
    if (queuedFiles.length === 0) {
      return 0;
    }
    if (!activeRow?.document_path) {
      return queuedFiles.length;
    }
    return Math.max(
      queuedFiles.filter((path) => path !== activeRow.document_path).length,
      0
    );
  }, [activeRow?.document_path, activeRows]);

  if (!isWorking && !showSuccess) {
    return null;
  }

  const stageLabel = activeRow
    ? friendlyStageLabel(activeRow.stage)
    : friendlyStageLabel(normalizePhaseToStage(statusPhase));

  const headline = showSuccess ? "All files analyzed." : `${stageLabel}...`;
  const details = !showSuccess
    ? [
        activeFileName ? `Working on ${activeFileName}.` : null,
        `${queueRemaining} files remaining after this one.`
      ].filter((line): line is string => Boolean(line))
    : [];

  return (
    <section className="rounded-md border border-accent/20 bg-accent-soft/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-text-primary">
            {showSuccess ? (
              <CheckCircle2 size={16} className="text-ok" />
            ) : (
              <Loader2 size={16} className="animate-spin text-accent" />
            )}
            <span className="truncate">{headline}</span>
          </div>
          {!collapsed && details.length > 0 ? (
            <div className="mt-1 space-y-0.5 text-xs text-text-muted">
              {details.map((line) => (
                <p key={line} className="m-0 truncate">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="text-text-muted hover:text-text-primary cursor-pointer"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand progress details" : "Minimize progress details"}
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
    </section>
  );
}
