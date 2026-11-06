import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backToLooksLabel,
  closeAll,
  escTarget,
  popOne,
  pushedDepth,
  topLayer,
  type ClosetLayerState,
} from "./closet-layers.ts";

afterEach(() => {
  vi.useRealTimers();
});

const piece: ClosetLayerState = {
  openId: "piece",
  listOpen: false,
  lookOpen: false,
  lookFromList: false,
};

describe("closet layers", () => {
  it("pops one layer at a time, list path then piece", () => {
    const list: ClosetLayerState = { ...piece, listOpen: true };
    const look: ClosetLayerState = { ...list, lookOpen: true, lookFromList: true };
    expect(topLayer(look)).toBe("look");
    expect(pushedDepth(look)).toBe(3);

    const afterLook = popOne(look);
    expect(topLayer(afterLook)).toBe("list");
    expect(afterLook.openId).toBe("piece");
    expect(afterLook.lookFromList).toBe(false);
    expect(pushedDepth(afterLook)).toBe(2);

    const afterList = popOne(afterLook);
    expect(topLayer(afterList)).toBe("piece");
    expect(afterList.listOpen).toBe(false);
    expect(pushedDepth(afterList)).toBe(1);

    const afterPiece = popOne(afterList);
    expect(topLayer(afterPiece)).toBeNull();
    expect(afterPiece).toEqual({
      openId: null,
      listOpen: false,
      lookOpen: false,
      lookFromList: false,
    });
    expect(popOne(afterPiece)).toEqual(afterPiece);
  });

  it("close-all clears the piece, the list and the look", () => {
    const full: ClosetLayerState = {
      openId: "piece",
      listOpen: true,
      lookOpen: true,
      lookFromList: true,
    };
    expect(closeAll(full)).toEqual({
      openId: null,
      listOpen: false,
      lookOpen: false,
      lookFromList: false,
    });
    expect(pushedDepth(closeAll(full))).toBe(0);
  });

  it("an outfit-path look has no list and no pushed entry", () => {
    const outfit: ClosetLayerState = {
      openId: null,
      listOpen: false,
      lookOpen: true,
      lookFromList: false,
    };
    expect(topLayer(outfit)).toBe("look");
    expect(pushedDepth(outfit)).toBe(0);
    const closed = popOne(outfit);
    expect(topLayer(closed)).toBeNull();
    expect(closed.openId).toBeNull();
    expect(closed.listOpen).toBe(false);
  });

  it("popping an outfit look leaves the piece when that sheet is still open", () => {
    const overPiece: ClosetLayerState = {
      openId: "piece",
      listOpen: false,
      lookOpen: true,
      lookFromList: false,
    };
    const next = popOne(overPiece);
    expect(topLayer(next)).toBe("piece");
    expect(next.listOpen).toBe(false);
    expect(next.lookOpen).toBe(false);
  });

  it("alternates keep the depth: the look stays the top, and one pop returns to the list", () => {
    const open: ClosetLayerState = {
      openId: "piece",
      listOpen: true,
      lookOpen: true,
      lookFromList: true,
    };
    const depth = pushedDepth(open);
    expect(depth).toBe(3);
    expect(topLayer(open)).toBe("look");
    expect(pushedDepth(open)).toBe(depth);
    expect(topLayer(popOne(open))).toBe("list");
  });

  it("Escape prefers the outline, then one layer, then select mode", () => {
    let layers: ClosetLayerState = {
      openId: "piece",
      listOpen: true,
      lookOpen: true,
      lookFromList: true,
    };
    expect(escTarget({ outlineOpen: true, selecting: true, layers })).toBe("outline");
    expect(escTarget({ outlineOpen: false, selecting: true, layers })).toBe("look");
    layers = popOne(layers);
    expect(escTarget({ outlineOpen: false, selecting: true, layers })).toBe("list");
    layers = popOne(layers);
    expect(escTarget({ outlineOpen: false, selecting: true, layers })).toBe("piece");
    layers = popOne(layers);
    expect(escTarget({ outlineOpen: false, selecting: true, layers })).toBe("select");
    expect(escTarget({ outlineOpen: false, selecting: false, layers })).toBe("none");
  });

  it("from the list, one Escape returns to the piece", () => {
    const layers: ClosetLayerState = { ...piece, listOpen: true };
    expect(escTarget({ outlineOpen: false, selecting: false, layers })).toBe("list");
    expect(topLayer(popOne(layers))).toBe("piece");
  });

  it("labels Back with the real count", () => {
    expect(backToLooksLabel(5)).toBe("← Back to 5 looks");
    expect(backToLooksLabel(1)).toBe("← Back to 1 look");
    expect(backToLooksLabel(2)).toBe("← Back to 2 looks");
    expect(backToLooksLabel(5)).not.toContain("with");
  });
});
