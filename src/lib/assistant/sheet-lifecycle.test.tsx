import "../sheet-test-dom.ts";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LookSheet } from "@/components/closet/look-sheet";
import { findButton, hostElement, type NodeEl } from "../sheet-test-dom.ts";
import { liveSnapshot } from "../__fixtures__/snapshot.ts";
import { clearJacketDrafts, draftStamp, setJacketDraftAccount } from "../jacket-draft.ts";
import { NOTE_HELD, NOTE_UNLOCK, NOTE_WHICH } from "../jacket-edit.ts";
import { pieceLabel } from "../piece-label.ts";
import type { Garment, Look } from "../types.ts";

vi.mock("@/components/closet/overlay", () => ({
  Overlay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/use-image", () => ({
  useImageSrc: () => undefined,
}));

vi.mock("@/components/closet/wear-button", () => ({
  WearButton: ({ onWear }: { onWear: () => void }) => (
    <button type="button" onClick={onWear}>
      Wear this
    </button>
  ),
}));

function piece(id: string): Garment {
  const found = liveSnapshot.find((g) => g.id === id);
  if (!found) throw new Error(id);
  return found;
}

const CHORE = "g_8qqqzpwxuwti";
const SHIRT = "g_6lolc7ma0mk8";
const CHINOS = "g_xi3w7tz3aren";
const STARS = "g_rxglifsoqobm";
const FIELD = "g_qnmo5yzgl50b";

function lookOf(ids: string[]): Look {
  return {
    id: "mounted-look",
    name: "Mounted",
    occasion: "weekday",
    garmentIds: ids,
    source: "manual",
    lookbook: false,
    createdAt: "2026-11-06T00:00:00.000Z",
  };
}

function weatherStamp(date: string, weather: { f: number; label: string; measured: true; highF?: number; wet?: boolean }) {
  return draftStamp({ date, occasion: "weekday", season: "fall", weather: { ...weather, code: 2 } });
}

async function mount(node: ReactNode): Promise<{ host: NodeEl; root: ReturnType<typeof createRoot> }> {
  const host = hostElement();
  const root = createRoot(host as unknown as Element);
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { host, root };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("mounted jacket sheet", () => {
  it("keeps Off and refreshes the weather warning while the sheet stays open", async () => {
    clearJacketDrafts();
    setJacketDraftAccount("acct-a");
    const ids = [CHORE, SHIRT, CHINOS, STARS];
    const warm = weatherStamp("2026-11-06", { f: 73, label: "Clear", measured: true });
    const wet = weatherStamp("2026-11-06", { f: 48, label: "Cold", measured: true, highF: 48, wet: true });
    function Harness({ stamp, wetDay }: { stamp: string; wetDay: boolean }) {
      return createElement(LookSheet, {
        look: lookOf(ids),
        pieces: ids.map(piece),
        book: [],
        closet: liveSnapshot,
        draftBaseIds: ids,
        draftStamp: stamp,
        jacketCtx: {
          occasion: "weekday",
          season: "fall",
          weatherF: wetDay ? 48 : 73,
          measured: true,
          ...(wetDay ? { highF: 48, wet: true } : {}),
        },
        onClose() {},
        onWear() {},
        onOpenLook() {},
      });
    }
    const { host, root } = await mount(createElement(Harness, { stamp: warm, wetDay: false }));
    await act(async () => {
      findButton(host, "Jacket off")!.click();
    });
    await flush();
    expect(host.textContent).not.toContain("you'll want a jacket");
    await act(async () => {
      root.render(createElement(Harness, { stamp: wet, wetDay: true }));
    });
    await flush();
    expect(host.textContent).toContain("you'll want a jacket");
    expect(host.textContent).not.toContain(pieceLabel(piece(CHORE), liveSnapshot));
    await act(async () => {
      root.render(createElement(Harness, { stamp: warm, wetDay: false }));
    });
    await flush();
    expect(host.textContent).not.toContain("you'll want a jacket");
    root.unmount();
  });

  it("drops another account's edit and yesterday's edit while the sheet stays open", async () => {
    clearJacketDrafts();
    setJacketDraftAccount("acct-a");
    const ids = [CHORE, SHIRT, CHINOS, STARS];
    const today = weatherStamp("2026-11-06", { f: 48, label: "Cold", measured: true, highF: 48, wet: true });
    const tomorrow = weatherStamp("2026-11-07", { f: 48, label: "Cold", measured: true, highF: 48, wet: true });
    function Harness({ stamp }: { stamp: string }) {
      return createElement(LookSheet, {
        look: lookOf(ids),
        pieces: ids.map(piece),
        book: [],
        closet: liveSnapshot,
        draftBaseIds: ids,
        draftStamp: stamp,
        jacketCtx: { occasion: "weekday", season: "fall", weatherF: 48, measured: true, highF: 48, wet: true },
        onClose() {},
        onWear() {},
        onOpenLook() {},
      });
    }
    const { host, root } = await mount(createElement(Harness, { stamp: today }));
    await act(async () => {
      findButton(host, "Jacket off")!.click();
    });
    await flush();
    expect(host.textContent).not.toContain(pieceLabel(piece(CHORE), liveSnapshot));
    setJacketDraftAccount("acct-b");
    await act(async () => {
      root.render(createElement(Harness, { stamp: today }));
    });
    await flush();
    expect(host.textContent).toContain(pieceLabel(piece(CHORE), liveSnapshot));
    await act(async () => {
      findButton(host, "Jacket off")!.click();
    });
    await flush();
    await act(async () => {
      root.render(createElement(Harness, { stamp: tomorrow }));
    });
    await flush();
    expect(host.textContent).toContain(pieceLabel(piece(CHORE), liveSnapshot));
    root.unmount();
    clearJacketDrafts();
  });

  it("Add after Next keeps the current jacket, and a locked or second jacket stays put", async () => {
    clearJacketDrafts();
    setJacketDraftAccount("acct-a");
    const ids = [CHORE, SHIRT, CHINOS, STARS];
    const chore = piece(CHORE);
    const field = piece(FIELD);
    const { host, root } = await mount(
      createElement(LookSheet, {
        look: lookOf(ids),
        pieces: [...ids.map(piece), field],
        book: [],
        closet: liveSnapshot,
        draftBaseIds: ids,
        draftStamp: weatherStamp("2026-11-06", { f: 64, label: "Fair", measured: true }),
        jacketCtx: { occasion: "weekend", season: "fall" },
        onClose() {},
        onWear() {},
        onOpenLook() {},
      }),
    );
    await act(async () => {
      findButton(host, "Try another jacket")!.click();
    });
    await flush();
    const alternate = pieceLabel(piece("g_ap5v0s67pg9d"), liveSnapshot);
    expect(host.textContent).toContain(alternate);
    await act(async () => {
      findButton(host, `Add ${pieceLabel(chore, liveSnapshot)}`)!.click();
    });
    await flush();
    expect(host.textContent).toContain(NOTE_HELD);
    expect(host.textContent).toContain(alternate);
    await act(async () => {
      root.render(
        createElement(LookSheet, {
          look: lookOf([field.id, SHIRT, CHINOS, STARS]),
          pieces: [field, piece(SHIRT), piece(CHINOS), piece(STARS), chore],
          book: [],
          closet: liveSnapshot,
          draftBaseIds: [field.id, SHIRT, CHINOS, STARS],
          initialLocked: [field.id],
          jacketCtx: { occasion: "weekend", season: "fall" },
          onClose() {},
          onWear() {},
          onOpenLook() {},
        }),
      );
    });
    await flush();
    await act(async () => {
      findButton(host, `Add ${pieceLabel(chore, liveSnapshot)}`)!.click();
    });
    await flush();
    expect(host.textContent).toContain(pieceLabel(field, liveSnapshot));
    expect(host.textContent).toContain(NOTE_HELD);
    const two = [chore, field, piece(SHIRT), piece(CHINOS), piece(STARS)];
    await act(async () => {
      root.render(
        createElement(LookSheet, {
          look: lookOf(two.map((g) => g.id)),
          pieces: two,
          book: [],
          closet: liveSnapshot,
          onClose() {},
          onWear() {},
          onOpenLook() {},
        }),
      );
    });
    await flush();
    await act(async () => {
      findButton(host, `Remove ${pieceLabel(chore, liveSnapshot)}`)!.click();
    });
    await flush();
    expect(host.textContent).toContain(NOTE_WHICH);
    expect(host.textContent).toContain(pieceLabel(chore, liveSnapshot));
    expect(host.textContent).toContain(pieceLabel(field, liveSnapshot));
    expect(host.textContent).not.toContain(NOTE_UNLOCK);
    root.unmount();
  });
});
