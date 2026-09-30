import polo from "./polo.json" with { type: "json" };
import purple from "./purple.json" with { type: "json" };
import rrl from "./rrl.json" with { type: "json" };
import ald from "./ald.json" with { type: "json" };
import faloni from "./faloni.json" with { type: "json" };
import fiveFourFive from "./fiveFourFive.json" with { type: "json" };
import sweetStable from "./sweetStable.json" with { type: "json" };
import italianSummer from "./italianSummer.json" with { type: "json" };
import italianWinter from "./italianWinter.json" with { type: "json" };
import type { House } from "../houses.ts";

export type HouseKill = { when: string; message: string };

export type HouseHole = { missing: string; note: string };

/** One chip. hits(), houseKill(), and houseFingerprintOk read this — not a second copy in TypeScript. */
export type HouseProfile = {
  signals: string[];
  minSignals: number;
  anchors: string[];
  banned: string[];
  jackets: string[];
  shoes: string[];
  palette: string[];
  occasionNote: string;
  cardNote: string;
  gap: string;
  /** A hard row look must include each of these when the closet owns them. If one is missing from the closet, no look is hard. */
  requireOwned: string[];
  kills: HouseKill[];
  holes: HouseHole[];
};

export const HOUSE_PROFILES: Record<House, HouseProfile> = {
  polo: polo as HouseProfile,
  purple: purple as HouseProfile,
  rrl: rrl as HouseProfile,
  ald: ald as HouseProfile,
  faloni: faloni as HouseProfile,
  fiveFourFive: fiveFourFive as HouseProfile,
  sweetStable: sweetStable as HouseProfile,
  italianSummer: italianSummer as HouseProfile,
  italianWinter: italianWinter as HouseProfile,
};
