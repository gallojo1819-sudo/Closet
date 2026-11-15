import { useEffect, useState } from "react";

/**
 * Idea rows for one Lookbook open. Nothing is scheduled until `ready` (the
 * ranked week row is in). The idle callback, the timeout fallback and the
 * Object.is check on `inputs` are the ones the page used inline. `deps` are
 * the rest of that effect's list (salt, week ids, the rotation callbacks).
 * A Re-dress that changes salt and the week together is one build.
 */
export function useIdeaRows<W, S>(opts: {
  ready: boolean;
  inputs: readonly unknown[];
  deps: readonly unknown[];
  build: () => { ways: W; shown: S };
}): { ways: W | null; shown: S | null; ready: boolean } {
  const { ready, inputs, deps, build } = opts;
  const [held, setHeld] = useState<{ inputs: readonly unknown[]; ways: W; shown: S } | null>(null);

  useEffect(() => {
    if (!ready) return;
    const snapshot = inputs;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const built = build();
      setHeld({ inputs: snapshot, ways: built.ways, shown: built.shown });
    };
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") {
      const id = idle(run, { timeout: 1500 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(id);
      };
    }
    const id = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
    // `inputs` and `deps` are read element by element, the page's old list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ...inputs, ...deps]);

  const matched = Boolean(held && held.inputs.every((value, i) => Object.is(value, inputs[i])));
  const live = ready && matched && held ? held : null;
  return { ways: live ? live.ways : null, shown: live ? live.shown : null, ready: Boolean(live) };
}
