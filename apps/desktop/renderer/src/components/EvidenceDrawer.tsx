import { useEffect, useMemo, useRef, type JSX } from "react";
import { Pin, PinOff, Quote, X } from "lucide-react";
import type { EvidenceItem } from "../api/ipc";
import type { LayoutMode } from "../state/useCanonkeeperApp";
import { CopyButton } from "./CopyButton";

type EvidenceDrawerProps = {
  open: boolean;
  title: string;
  sourceLabel: string;
  evidence: EvidenceItem[];
  layoutMode: LayoutMode;
  pinned: boolean;
  onTogglePin: () => void;
  onClose: () => void;
};

function locationLabel(item: EvidenceItem): string {
  const pathPart = item.documentPath ?? "unknown document";
  const chunkPart = item.chunkOrdinal !== null ? `chunk ${item.chunkOrdinal}` : "chunk ?";
  const linePart =
    item.lineStart !== null
      ? `line ${item.lineStart}${item.lineEnd && item.lineEnd !== item.lineStart ? `-${item.lineEnd}` : ""}`
      : "line ?";
  return `${pathPart} | ${chunkPart} | ${linePart}`;
}

export function EvidenceDrawer({
  open,
  title,
  sourceLabel,
  evidence,
  layoutMode,
  pinned,
  onTogglePin,
  onClose
}: EvidenceDrawerProps): JSX.Element | null {
  const dialogRef = useRef<HTMLElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const panelClassName = useMemo(() => {
    if (layoutMode === "mobile") {
      return "fixed inset-3 z-40 flex h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] flex-col rounded-md border border-border bg-surface-2 shadow-lg dark:bg-surface-1";
    }
    return "fixed top-0 right-0 z-40 flex h-full w-full max-w-[520px] flex-col border-l border-border bg-surface-2 shadow-lg dark:bg-surface-1";
  }, [layoutMode]);

  useEffect(() => {
    if (!open) {
      return;
    }
    lastFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const node = dialogRef.current;
    const initialTarget = node?.querySelector<HTMLElement>("[data-autofocus]");
    initialTarget?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) {
        return;
      }
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      lastFocused.current?.focus();
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/30 animate-fade-in dark:bg-black/55"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={dialogRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-label="Evidence"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Quote size={16} className="shrink-0 text-accent" />
              Evidence
            </div>
            <div className="mt-0.5 truncate text-xs text-text-muted">{title}</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-text-muted">{sourceLabel}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer"
              type="button"
              onClick={onTogglePin}
              title={pinned ? "Unpin evidence panel" : "Pin evidence panel"}
              data-autofocus
            >
              <span className="inline-flex items-center gap-1">
                {pinned ? <PinOff size={12} /> : <Pin size={12} />}
                {pinned ? "Unpin" : "Pin"}
              </span>
            </button>
            <button
              className="rounded-sm border border-transparent bg-transparent p-1.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
              type="button"
              onClick={onClose}
              aria-label="Close evidence"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {evidence.length === 0 ? (
            <p className="text-center text-sm text-text-muted">No evidence excerpts available.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {evidence.map((item, index) => (
                <article
                  key={`${item.chunkId}-${index}`}
                  className="rounded-sm border border-border bg-white p-3 dark:bg-surface-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-xs text-text-muted">{locationLabel(item)}</div>
                    <CopyButton text={item.excerpt} label="Copy" />
                  </div>
                  <div className="mt-2 border-l-3 border-accent pl-3 text-sm italic text-text-secondary">
                    &quot;{item.excerpt}&quot;
                  </div>
                  <div className="mt-1.5 font-mono text-xs text-text-muted">
                    span {item.quoteStart}-{item.quoteEnd}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
