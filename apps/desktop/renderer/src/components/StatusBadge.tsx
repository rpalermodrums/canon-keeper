import type { ComponentType, JSX } from "react";

type StatusBadgeProps = {
  label: string;
  status: string;
  icon?: ComponentType<{ size?: number | string; className?: string }>;
};

function toneClasses(status: string): string {
  const s = status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  switch (s) {
    case "idle":
    case "ok":
    case "ready":
    case "open":
    case "confirmed":
      return "text-ok bg-ok-soft border-ok/25";
    case "busy":
    case "ingest":
    case "extract":
    case "style":
    case "continuity":
    case "export":
    case "medium":
    case "warn":
    case "inferred":
    case "restarting":
      return "text-warn bg-warn-soft border-warn/25";
    case "error":
    case "down":
    case "high":
    case "dismissed":
    case "resolved":
    case "missing-native":
      return "text-danger bg-danger-soft border-danger/25";
    default:
      return "text-text-muted bg-surface-1 border-border";
  }
}

function isBusy(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s === "busy" ||
    s === "restarting" ||
    s === "ingest" ||
    s === "extract" ||
    s === "style" ||
    s === "continuity" ||
    s === "export"
  );
}

export function StatusBadge({ label, status, icon: Icon }: StatusBadgeProps): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneClasses(status)}`}
      title={status}
    >
      {Icon ? (
        <Icon size={12} />
      ) : (
        <span
          className={`h-1.5 w-1.5 rounded-full bg-current ${isBusy(status) ? "animate-pulse-dot" : ""}`}
        />
      )}
      {label}
    </span>
  );
}
