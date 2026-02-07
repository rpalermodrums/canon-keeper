import type { UserFacingError } from "../api/ipc";

export type LayoutMode = "mobile" | "tablet" | "desktop";

export function sanitizeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return "Unknown error";
  const raw = err.message;
  if (/SQLITE_BUSY/i.test(raw)) return "The database is temporarily busy. Please try again in a moment.";
  if (/SQLITE_LOCKED/i.test(raw)) return "The database is temporarily locked. Please try again in a moment.";
  if (/SQLITE_CORRUPT/i.test(raw)) {
    return "The database file appears to be damaged. Try running diagnostics from Settings.";
  }
  if (/SQLITE_READONLY/i.test(raw)) {
    return "The database cannot be written to. Check your file permissions.";
  }
  const stripped = raw.replace(/\n\s*at\s+.+/g, "").trim();
  return stripped || "Unknown error";
}

export function toUserFacingError(
  code: string,
  err: unknown,
  actionLabel?: string,
  action?: string
): Omit<UserFacingError, "id"> {
  return {
    code,
    message: sanitizeErrorMessage(err),
    actionLabel,
    action
  };
}

export function computeLayoutMode(width: number): LayoutMode {
  if (width < 768) {
    return "mobile";
  }
  if (width < 1200) {
    return "tablet";
  }
  return "desktop";
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

export function beginAction<Namespace extends string, Label extends string>(
  current: Map<Namespace, Set<Label>>,
  namespace: Namespace,
  label: Label
): Map<Namespace, Set<Label>> {
  const next = new Map(current);
  const actions = new Set(next.get(namespace) ?? []);
  actions.add(label);
  next.set(namespace, actions);
  return next;
}

export function endAction<Namespace extends string, Label extends string>(
  current: Map<Namespace, Set<Label>>,
  namespace: Namespace,
  label: Label
): Map<Namespace, Set<Label>> {
  const next = new Map(current);
  const actions = next.get(namespace);
  if (!actions) {
    return current;
  }
  const nextActions = new Set(actions);
  nextActions.delete(label);
  if (nextActions.size === 0) {
    next.delete(namespace);
  } else {
    next.set(namespace, nextActions);
  }
  return next;
}
