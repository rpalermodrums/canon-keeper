import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ComponentType } from "react";
import { Search } from "lucide-react";
import {
  filterAndOrderCommandItems,
  nextCommandIndexOnArrowDown,
  nextCommandIndexOnArrowUp
} from "./commandPaletteUtils";

type CommandPaletteItem = {
  id: string;
  label: string;
  subtitle: string;
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  category?: string;
  enabled?: boolean;
  disabledReason?: string;
};

type CommandPaletteProps = {
  open: boolean;
  items: CommandPaletteItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
};

export function CommandPalette({ open, items, onSelect, onClose }: CommandPaletteProps): JSX.Element | null {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => filterAndOrderCommandItems(items, query), [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleSelect = useCallback(
    (item: CommandPaletteItem) => {
      if (item.enabled === false) {
        return;
      }
      const { id } = item;
      onSelect(id);
      onClose();
    },
    [onSelect, onClose]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((index) => nextCommandIndexOnArrowDown(index, filtered.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((index) => nextCommandIndexOnArrowUp(index));
      } else if (e.key === "Enter" && filtered[activeIndex]) {
        e.preventDefault();
        handleSelect(filtered[activeIndex]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, activeIndex, handleSelect]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/30 pt-[15vh] animate-fade-in dark:bg-black/50"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="w-full max-w-[560px] overflow-hidden rounded-lg border border-border bg-surface-2 shadow-lg animate-scale-in dark:bg-surface-1">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={16} className="text-text-muted" />
          <input
            ref={inputRef}
            className="flex-1 border-none bg-transparent px-0 py-1 text-sm text-text-primary outline-none placeholder:text-text-muted"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands..."
          />
          <kbd className="text-[10px]">Esc</kbd>
        </div>
        <ul ref={listRef} className="m-0 max-h-[360px] list-none overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-text-muted">No matching commands</li>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <button
                    className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors cursor-pointer ${
                      i === activeIndex
                        ? "bg-accent-soft text-accent-strong dark:text-accent"
                        : item.enabled === false
                          ? "bg-transparent text-text-muted"
                          : "bg-transparent text-text-primary hover:bg-surface-1 dark:hover:bg-surface-2"
                    }`}
                    type="button"
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setActiveIndex(i)}
                    disabled={item.enabled === false}
                  >
                    {Icon ? (
                      <Icon size={18} className="shrink-0 text-text-muted" />
                    ) : (
                      <span className="w-[18px]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="truncate text-xs text-text-muted">{item.subtitle}</div>
                      {item.enabled === false && item.disabledReason ? (
                        <div className="truncate text-xs text-warn">{item.disabledReason}</div>
                      ) : null}
                    </div>
                    {item.category ? (
                      <span className="shrink-0 rounded-full border border-border bg-surface-1 px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-muted dark:bg-surface-2">
                        {item.category}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </section>
    </div>
  );
}
