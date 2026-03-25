export type RelativePosition = "before" | "after";

export function reorderByIds<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
  position: RelativePosition = "before",
): T[] {
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;

  const next = [...items];
  const [removed] = next.splice(sourceIndex, 1);
  const adjustedTargetIndex = next.findIndex((item) => item.id === targetId);
  if (adjustedTargetIndex < 0) return items;

  const insertIndex = position === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  next.splice(insertIndex, 0, removed!);
  return next;
}
