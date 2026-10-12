import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False during server rendering and the hydration pass, true from the first client render
 * after it. For text the server cannot know (today's date in the reader's time zone).
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
