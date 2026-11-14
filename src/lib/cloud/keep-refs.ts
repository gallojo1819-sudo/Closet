/**
 * A cloud merge builds new arrays even when nothing changed. Hand the store
 * the references it already holds when the JSON is the same, so a Lookbook
 * build in flight is not thrown out. Key order that differs is a real change:
 * the new value is kept, which is what the store did before this helper.
 */

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function keepSameRefs<T extends object>(current: T, next: Partial<T>): Partial<T> {
  const kept: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    const incoming = next[key];
    kept[key] = sameJson(current[key], incoming) ? current[key] : incoming;
  }
  return kept;
}

export function changedKeys<T extends object>(current: T, next: Partial<T>): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(next)) {
    if (!sameJson(current[key as keyof T], next[key as keyof T])) changed.push(key);
  }
  return changed;
}
