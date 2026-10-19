/**
 * The daily pick, on every page: once the closet is settled (hydrated, and not the sample rack
 * while an account is still loading its closet), today's weather is read and the day's look
 * is rolled into the store in memory (rerollDrop with the day's frozen season bucket,
 * daily-pick.ts), so the Today page, the stylist dock and the ask all read one drop dated
 * today wherever the app was opened. It was the Today page's effect; a dock opened on Closet
 * or Lookbook then saw yesterday's drop until Today was visited. The pick stays in memory on
 * purpose: a gate-open setDrop stamps setAt, which mergeDrop lets outrank a Skip made on another
 * device. Until the pick lands, todayLookPieces computes the same look itself.
 */
import { useEffect } from "react";
import { useAccount } from "./cloud/account";
import { liveIdsKey } from "./daily-pick";
import { hasRealPieces, livePool } from "./rack";
import { useCloset } from "./store";
import { persistGate } from "./store-persist";
import { todayOccasion } from "./style";
import { freezeTodaySeason } from "./today-season";
import { todayNY } from "./utils";
import { getNycWeather } from "./weather";

export function useDailyPick(): void {
  const hydrated = useCloset((s) => s.hydrated);
  const garmentsAll = useCloset((s) => s.garments);
  const account = useAccount();
  const garments = livePool(garmentsAll);
  /* The pick re-runs when the set of live ids changes, not on every count blip. */
  const liveKey = liveIdsKey(garments);
  /* The sample rack is not a closet to dress while the real one is still coming: a signed-in
     (or still pending) account loads its closet from the cloud after hydration. */
  const sampleOnly = garments.length > 0 && !hasRealPieces(garmentsAll);
  const settled = !sampleOnly || (!account.pending && !account.user);

  useEffect(() => {
    if (!hydrated || !settled) return;
    let cancelled = false;
    (async () => {
      const setDrop = useCloset.getState().setDrop;
      const drop = useCloset.getState().drop;
      let weather = drop?.weather;
      try {
        const live = await getNycWeather();
        if (live) weather = live;
      } catch {
        weather = drop?.weather;
      }
      if (cancelled) return;
      const owned = livePool(useCloset.getState().garments).filter((g) => !g.archived);
      const current = useCloset.getState().drop;
      const wasOpen = persistGate.open;
      const inMemory = (run: () => void) => {
        persistGate.open = false;
        try {
          run();
        } finally {
          persistGate.open = wasOpen;
        }
      };
      if (!owned.length) {
        if (weather && current?.weather?.f !== weather.f) {
          inMemory(() =>
            setDrop({
              date: todayNY(),
              garmentIds: [],
              worn: false,
              verdict: "pending",
              weather,
            }),
          );
        }
        return;
      }
      const wornToday =
        current &&
        current.date === todayNY() &&
        (current.worn || current.verdict === "worn");
      if (wornToday) {
        if (weather && current.weather?.f !== weather.f) {
          inMemory(() => setDrop({ ...current, weather }));
        }
        return;
      }
      const liveToday =
        current &&
        current.date === todayNY() &&
        current.garmentIds.filter((id) => owned.some((g) => g.id === id)).length >= 2;
      if (liveToday) {
        /* Today's look stays. Only its weather is refreshed, in memory. */
        if (weather && current.weather?.f !== weather.f) {
          inMemory(() => setDrop({ ...current, weather }));
        }
        return;
      }
      /* No look for today, or a broken one. The day's pick (daily-pick.ts): the same closet on
         the same day gives the same look, under the season bucket frozen for today. It stays in
         memory: an automatic pick must not carry a setAt stamp, which a gate-open write would
         give it and which mergeDrop lets outrank a Skip the user made on another device. */
      const season = freezeTodaySeason(weather?.f);
      inMemory(() =>
        useCloset.getState().rerollDrop(weather, todayOccasion(current), undefined, undefined, { season }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, settled, liveKey]);
}
