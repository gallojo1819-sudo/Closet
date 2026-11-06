import { createHash } from "node:crypto";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LookSheet } from "@/components/closet/look-sheet";
import { liveSnapshot } from "./__fixtures__/snapshot.ts";
import { backToLooksLabel } from "./closet-layers.ts";
import { looksForHero } from "./lookbook.ts";
import type { Garment, Look } from "./types.ts";

vi.mock("@/components/closet/overlay", () => ({
  Overlay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

/** Canonical day for the parity hash. Clock runs below re-pin to this before hashing. */
const PIN = "2026-11-04";
const PARITY_HASH = "ddeda83f23759b394c2926fb1b655aefff000116813a1a0c6dcd0a8dc3ee892e";

function pinDay(day: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${day}T16:00:00.000Z`));
}

beforeEach(() => {
  pinDay(process.env.R5_CLOCK ?? PIN);
});

afterEach(() => {
  vi.useRealTimers();
});

function heroCards(looks: Look[], garments: Garment[]): Look[] {
  return looks.filter(
    (look) => look.garmentIds.filter((id) => garments.some((g) => g.id === id)).length >= 3,
  );
}

function piecesOf(look: Look, garments: Garment[]): Garment[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  return look.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => Boolean(g));
}

describe("Back to looks", () => {
  it("renders Back before the plate, with the card count, and still has Close", () => {
    let hero: Garment | null = null;
    let cards: Look[] = [];
    for (const garment of liveSnapshot) {
      const cardsFor = heroCards(looksForHero(garment, liveSnapshot), liveSnapshot);
      if (cardsFor.length >= 2) {
        hero = garment;
        cards = cardsFor;
        break;
      }
    }
    expect(hero, "a snapshot piece with two or more looks").toBeTruthy();
    const look = cards[0]!;
    const pieces = piecesOf(look, liveSnapshot);
    const label = backToLooksLabel(cards.length);
    expect(label).toBe(`← Back to ${cards.length} ${cards.length === 1 ? "look" : "looks"}`);

    const withBack = renderToStaticMarkup(
      <LookSheet
        look={look}
        pieces={pieces}
        book={cards}
        closet={liveSnapshot}
        onClose={() => {}}
        onWear={() => {}}
        onOpenLook={() => {}}
        onBack={() => {}}
        backLabel={label}
      />,
    );
    const backAt = withBack.indexOf(label);
    const plateAt = withBack.indexOf("aspect-[4/5]");
    expect(backAt).toBeGreaterThanOrEqual(0);
    expect(plateAt).toBeGreaterThan(backAt);
    expect(withBack).toContain(">Close<");

    const without = renderToStaticMarkup(
      <LookSheet
        look={look}
        pieces={pieces}
        book={cards}
        closet={liveSnapshot}
        onClose={() => {}}
        onWear={() => {}}
        onOpenLook={() => {}}
      />,
    );
    expect(without).not.toContain("← Back");
    expect(without).not.toContain("data-look-back");
    expect(without).toContain(">Close<");
  });
});

describe("looksForHero parity", () => {
  it("ids and garment ids over every snapshot piece hash to the base", () => {
    pinDay(PIN);
    expect(liveSnapshot.length).toBeGreaterThan(0);
    const lines: string[] = [];
    const garments = [...liveSnapshot].sort((a, b) => a.id.localeCompare(b.id));
    for (const garment of garments) {
      const looks = looksForHero(garment, liveSnapshot, { today: PIN });
      const body = looks.map((look) => `${look.id}:${look.garmentIds.join(",")}`).join(";");
      lines.push(`${garment.id}|${body}`);
    }
    expect(lines).toHaveLength(liveSnapshot.length);
    expect(createHash("sha256").update(lines.join("\n")).digest("hex")).toBe(PARITY_HASH);
  });
});
