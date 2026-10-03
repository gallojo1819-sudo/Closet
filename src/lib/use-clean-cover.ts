import { useSyncExternalStore } from "react";
import { coverByteRev, subscribeCoverBytes } from "./plate.ts";

/** Re-render when a cover hash says the file is, or is not, the phone photo. */
export function useCoverByteRev(): number {
  return useSyncExternalStore(subscribeCoverBytes, coverByteRev, () => 0);
}
