export type CommandPaletteSearchableItem = {
  label: string;
  subtitle: string;
  disabledReason?: string;
};

export function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      qi++;
    }
  }
  return qi === q.length;
}

export function nextCommandIndexOnArrowDown(currentIndex: number, itemCount: number): number {
  return Math.min(currentIndex + 1, itemCount - 1);
}

export function nextCommandIndexOnArrowUp(currentIndex: number): number {
  return Math.max(currentIndex - 1, 0);
}

export function filterAndOrderCommandItems<T extends CommandPaletteSearchableItem>(
  items: readonly T[],
  query: string
): readonly T[] {
  if (!query.trim()) {
    return items;
  }

  return items.filter(
    (item) =>
      fuzzyMatch(item.label, query) ||
      fuzzyMatch(item.subtitle, query) ||
      (item.disabledReason ? fuzzyMatch(item.disabledReason, query) : false)
  );
}
