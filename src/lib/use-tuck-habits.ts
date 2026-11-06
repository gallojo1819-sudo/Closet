import { useCloset } from "./store.ts";
import { emptyTaste, tuckHabitIds } from "./taste.ts";

/** Ids the stylist has learned to wear untucked. Same source On You already uses. */
export function useTuckHabits(): string[] {
  const taste = useCloset((s) => s.taste);
  return tuckHabitIds(taste ?? emptyTaste());
}
