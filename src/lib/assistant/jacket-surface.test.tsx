/**
 * The edited look is what the detector row shows and what Wear this logs.
 * No network and no closet write.
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DetectorSections } from "@/components/closet/detector-sections";
import { LookSheet } from "@/components/closet/look-sheet";
import { liveSnapshot } from "../__fixtures__/snapshot.ts";
import { clearJacketDrafts, draftStamp, rememberJacketDraft } from "../jacket-draft.ts";
import type { Garment, Look, Occasion } from "../types.ts";

vi.mock("@/components/closet/overlay", () => ({
  Overlay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/closet/wear-button", () => ({
  WearButton: ({ onWear }: { onWear: () => void }) => {
    onWear();
    return <button type="button">Wear this</button>;
  },
}));

function piece(id: string): Garment {
  const found = liveSnapshot.find((g) => g.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe("edited detector row", () => {
  it("shows the edited jacket and opens the original pieces", () => {
    const base = [piece("g_6lolc7ma0mk8"), piece("g_xi3w7tz3aren"), piece("g_rxglifsoqobm"), piece("g_8qqqzpwxuwti")];
    const edited = [piece("g_6lolc7ma0mk8"), piece("g_xi3w7tz3aren"), piece("g_rxglifsoqobm"), piece("g_qnmo5yzgl50b")];
    let opened: string[] = [];
    const markup = renderToStaticMarkup(
      <DetectorSections
        garments={liveSnapshot}
        occasion="weekday"
        season="fall"
        ways={[
          {
            id: "row-1",
            title: "Forgotten pieces",
            pieces: base,
            looks: { weekday: [base] },
            counts: { weekday: 1, out: 0, weekend: 0, travel: 0, comfy: 0 },
          },
        ]}
        project={(look) => ({
          show: look[0]?.id === "g_6lolc7ma0mk8" ? edited : look,
          base: look,
          warning: "Rainy out — you'll want a jacket.",
        })}
        onOpen={(pieces) => {
          opened = pieces.map((g) => g.id);
        }}
      />,
    );
    expect(markup).toContain("navy field jacket");
    expect(markup).toContain("data-weather-warned");
    expect(markup).toContain("Rainy out");
    expect(markup).not.toContain("brown chore jacket");
    expect(opened).toEqual([]);
    expect(markup).toContain("data-detector-card");
  });
});

describe("Wear this", () => {
  it("wears the outfit on the sheet, not a different Today look", () => {
    clearJacketDrafts();
    const todayIds = ["g_8qqqzpwxuwti", "g_6lolc7ma0mk8", "g_xi3w7tz3aren", "g_rxglifsoqobm"];
    const todayDraft = ["g_qnmo5yzgl50b", "g_6lolc7ma0mk8", "g_xi3w7tz3aren", "g_rxglifsoqobm"];
    const suggestionIds = ["g_oimadifuvalb", "g_yfkavdj5irwe", "g_yae8h1k9pjm1", "g_5josnvyoi4z9"];
    const suggestionDraft = ["g_oimadifuvalb", "g_yfkavdj5irwe", "g_yae8h1k9pjm1"];
    const stamp = draftStamp({ date: "2026-11-06", occasion: "weekday", season: "fall", weather: null });
    const suggestionStamp = draftStamp({ date: "2026-11-06", occasion: "out", season: "fall", weather: null });
    const store = (baseIds: string[], ids: string[], key: string) => {
      rememberJacketDraft({
        baseIds,
        ids,
        stamp: key,
        accountId: "",
        off: !ids.some((id) => id === "g_8qqqzpwxuwti" || id === "g_qnmo5yzgl50b" || id === "g_5josnvyoi4z9"),
        jacketId: ids.find((id) => id === "g_qnmo5yzgl50b" || id === "g_5josnvyoi4z9") ?? null,
        lastJacketId: null,
        weatherWarned: false,
        warning: null,
        note: null,
        outdoorsValid: true,
      });
    };
    store(todayIds, todayDraft, stamp);
    store(suggestionIds, suggestionDraft, suggestionStamp);
    const today: Look = {
      id: "today-2026-11-06",
      name: "Today",
      occasion: "weekday",
      garmentIds: todayIds,
      source: "manual",
      lookbook: false,
      createdAt: "2026-11-06T00:00:00.000Z",
    };
    const suggestion: Look = {
      id: "suggest-1",
      name: "A different look",
      occasion: "out" as Occasion,
      garmentIds: suggestionIds,
      source: "ai",
      lookbook: false,
      createdAt: "2026-11-06T00:00:00.000Z",
    };
    const received: string[][] = [];
    const wear = (look: Look, key: string) => {
      renderToStaticMarkup(
        <LookSheet
          look={look}
          pieces={look.garmentIds.map(piece)}
          draftBaseIds={look.garmentIds}
          draftStamp={key}
          book={[]}
          closet={liveSnapshot}
          onClose={() => {}}
          onWear={(ids) => received.push(ids)}
          onOpenLook={() => {}}
        />,
      );
    };
    wear(today, stamp);
    wear(suggestion, suggestionStamp);
    expect(received[0]?.slice().sort()).toEqual(todayDraft.slice().sort());
    expect(received[1]?.slice().sort()).toEqual(suggestionDraft.slice().sort());
    expect(received[0]).not.toEqual(received[1]);
    expect(received[1]).not.toEqual(todayIds);
    clearJacketDrafts();
  });
});
