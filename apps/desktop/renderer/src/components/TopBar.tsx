import type { JSX } from "react";
import { Command, PanelLeft } from "lucide-react";
import type { AppSection, LayoutMode } from "../state/useCanonkeeperApp";
import { APP_SECTIONS } from "../state/useCanonkeeperApp";
import { Breadcrumb } from "./Breadcrumb";
import { StatusBadge } from "./StatusBadge";
import type { WorkerStatus } from "../api/ipc";
import { ThemeToggle, type Theme } from "./ThemeToggle";

type TopBarProps = {
  activeSection: AppSection;
  projectName: string | null;
  status: WorkerStatus | null;
  statusLabel: string;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  layoutMode: LayoutMode;
  onToggleMobileNav: () => void;
  onOpenCommandPalette: () => void;
};

export function TopBar({
  activeSection,
  projectName,
  status,
  statusLabel,
  theme,
  onThemeChange,
  layoutMode,
  onToggleMobileNav,
  onOpenCommandPalette
}: TopBarProps): JSX.Element {
  const section = APP_SECTIONS.find((s) => s.id === activeSection);
  const isMobile = layoutMode === "mobile";
  const statusTone = status?.phase ?? status?.state ?? "down";

  const segments = [
    ...(projectName ? [{ label: projectName }] : [{ label: "No project" }]),
    ...(section ? [{ icon: section.icon, label: section.label }] : [])
  ];

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-surface-0/92 px-5 py-3 backdrop-blur-md dark:bg-surface-0/90">
      <div className="flex items-center gap-3 min-w-0">
        {isMobile ? (
          <button
            className="inline-flex items-center justify-center rounded-sm border border-border bg-surface-2 p-1.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer dark:bg-surface-1"
            type="button"
            aria-label="Toggle navigation"
            onClick={onToggleMobileNav}
          >
            <PanelLeft size={16} />
          </button>
        ) : null}
        <Breadcrumb segments={segments} />
        <StatusBadge label={statusLabel} status={statusTone} />
      </div>
      <div className="flex items-center gap-2">
        {isMobile ? null : <ThemeToggle theme={theme} onChange={onThemeChange} />}
        <button
          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer dark:bg-surface-1"
          type="button"
          onClick={onOpenCommandPalette}
        >
          <Command size={14} />
          <span>Cmd+K</span>
        </button>
      </div>
    </header>
  );
}
