import { useEffect, useRef, type JSX } from "react";
import { AlertTriangle, BookOpen, Search } from "lucide-react";

type WelcomeModalProps = {
  onGetStarted: () => void;
  onSkip: () => void;
};

export function WelcomeModal({ onGetStarted, onSkip }: WelcomeModalProps): JSX.Element {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) {
      return;
    }
    modal.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSkip();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusableElements = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");

      if (focusableElements.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (event.shiftKey) {
        if (!activeElement || activeElement === first || !modal.contains(activeElement)) {
          event.preventDefault();
          last?.focus();
        }
        return;
      }
      if (!activeElement || activeElement === last || !modal.contains(activeElement)) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onSkip]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="mx-4 w-full max-w-md rounded-lg border border-border bg-surface-0 p-6 shadow-lg dark:bg-surface-1"
      >
        <h2 id="welcome-title" className="m-0 font-display text-xl font-bold text-text-primary">
          Welcome to CanonKeeper
        </h2>
        <p className="mt-2 text-sm text-text-secondary">Your editorial workstation for fiction manuscripts.</p>
        <ul className="mt-4 list-none flex flex-col gap-3 p-0">
          <li className="flex items-start gap-3 text-sm text-text-primary">
            <BookOpen size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>Reads your manuscript and builds a scene-by-scene index</span>
          </li>
          <li className="flex items-start gap-3 text-sm text-text-primary">
            <Search size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>Tracks characters, locations, and facts across your story</span>
          </li>
          <li className="flex items-start gap-3 text-sm text-text-primary">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>Flags continuity issues and style patterns to review</span>
          </li>
        </ul>
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-text-muted underline transition-colors hover:text-text-primary cursor-pointer"
            onClick={onSkip}
          >
            Skip
          </button>
          <button
            type="button"
            className="rounded-sm border border-accent bg-accent px-5 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-strong cursor-pointer"
            onClick={onGetStarted}
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
