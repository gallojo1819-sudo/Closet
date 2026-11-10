/**
 * @vitest-environment happy-dom
 *
 * The look sheet button, the dock's one auto-ask, and Undo. No live model call.
 */
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LookSheet } from "@/components/closet/look-sheet";
import { StylistDock } from "@/components/shell/stylist-dock";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { limitMessage, SIGNED_OUT } from "../auth/ai-quota.ts";
import { clearJacketDrafts, readJacketDraft, setJacketDraftAccount } from "../jacket-draft.ts";
import { offerLookSwaps } from "../look-sheet-swaps.ts";
import { swapIsLegal } from "../look-swap.ts";
import { livePool } from "../rack.ts";
import { oversizedOf } from "../stylist/oversized.ts";
import { isShortOuter } from "../stylist/short-outer.ts";
import { emptyTaste } from "../taste.ts";
import { isKnitTop } from "../tuck.ts";
import type { Garment, Look } from "../types.ts";
import { putImage } from "@/lib/images";
import { setLookAskAuth, signedInLookAskAuth } from "./look-ask-auth-mock.ts";
import { useCloset } from "../store.ts";

const calls = vi.hoisted(() => ({
  askAboutLook: vi.fn(),
  askStylist: vi.fn(),
  checkOutfit: vi.fn(),
}));

vi.mock("@/lib/auth/use-current-user", async () => import("./look-ask-auth-mock.ts"));

vi.mock("@/lib/ask-about-look", () => ({
  askAboutLook: (input: unknown) => calls.askAboutLook(input),
}));

vi.mock("@/lib/ai", () => ({
  askStylist: (input: unknown) => calls.askStylist(input),
  trendLayer: vi.fn(async () => ({ ok: false })),
}));

vi.mock("@/lib/outfit-check-ask", () => ({
  checkOutfit: (input: unknown) => calls.checkOutfit(input),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

vi.mock("@/components/closet/overlay", () => ({
  Overlay: ({ children }: { children: ReactNode }) => <div data-overlay>{children}</div>,
}));

vi.mock("@/components/closet/wear-button", () => ({
  WearButton: ({ onWear }: { onWear: () => void }) => (
    <button type="button" onClick={onWear}>
      Wear this
    </button>
  ),
}));

vi.mock("@/lib/use-image", () => ({
  useImageSrc: () => "",
}));

vi.mock("@/lib/images", async () => {
  const actual = await vi.importActual<typeof import("@/lib/images")>("@/lib/images");
  return {
    ...actual,
    getImage: vi.fn(async () => null),
    putImage: vi.fn(async () => {}),
  };
});

const POOL = livePool(JSON.parse(readFileSync(resolve("src/lib/__fixtures__/engine-garments.json"), "utf8")) as Garment[]);
const FLANNEL = "g_2b6fao81vqrs";
const VEST = "g_ef0u3ljnwa09";
const CORDS = "g_cfm8n594jea7";
const BOOTS = "g_b4zsf3dfrhdv";
const VEST_IDS = [FLANNEL, VEST, CORDS, BOOTS];

function piece(id: string): Garment {
  const found = POOL.find((g) => g.id === id);
  if (!found) throw new Error(id);
  return found;
}

function legalKnit(): string {
  const base = VEST_IDS.map(piece);
  for (const cand of POOL) {
    if (cand.id === FLANNEL || !isKnitTop(cand) || oversizedOf(cand) || isShortOuter(cand)) continue;
    const next = base.map((g) => (g.id === FLANNEL ? cand : g));
    if (swapIsLegal(next, { occasion: "weekend", season: "fall" }, POOL)) return cand.id;
  }
  throw new Error("no legal knit");
}

function lookOf(): Look {
  return {
    id: "vest-look",
    name: "Vest look",
    occasion: "weekend",
    garmentIds: VEST_IDS,
    source: "manual",
    lookbook: false,
    createdAt: "2026-11-10T15:00:00.000Z",
  };
}

function mount(ui: ReactNode): { root: Root; host: HTMLDivElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(ui);
  });
  return { root, host };
}

function unmount(mounted: { root: Root; host: HTMLDivElement }) {
  act(() => mounted.root.unmount());
  mounted.host.remove();
}

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function sheet(onWear: (ids: string[]) => void = () => {}) {
  return (
    <LookSheet
      look={lookOf()}
      pieces={VEST_IDS.map(piece)}
      draftBaseIds={VEST_IDS}
      draftStamp="look:vest"
      book={[]}
      closet={POOL}
      onClose={() => {}}
      onWear={onWear}
      onOpenLook={() => {}}
    />
  );
}

describe("ask about this look, on the sheet", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    clearJacketDrafts();
    setJacketDraftAccount("");
    setLookAskAuth(signedInLookAskAuth());
    calls.askAboutLook.mockReset();
    calls.askStylist.mockReset();
    calls.checkOutfit.mockReset();
    calls.askAboutLook.mockResolvedValue({
      ok: true,
      text: "Almost.\nTuck the blue plaid flannel shirt.",
      swaps: [],
      occasion: "weekend",
    });
    calls.askStylist.mockResolvedValue({ ok: true, text: "A weekday look.", garmentIds: [], occasion: "weekday", source: "live" });
    useCloset.setState({ garments: POOL, looks: [], messages: [], taste: emptyTaste(), hydrated: false });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    clearJacketDrafts();
  });

  it("the button is 44px and opens the dock on the live ids", async () => {
    const view = mount(
      <>
        {sheet()}
        <StylistDock />
      </>,
    );
    const button = document.querySelector('[aria-label="Ask about this look"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.textContent).toContain("Ask about this look");
    expect(button.className).toContain("min-h-[44px]");
    await act(async () => {
      button.click();
    });
    await flush();
    const chip = document.querySelector("[data-focus-look]");
    expect(chip?.textContent).toContain("This look:");
    expect(calls.askAboutLook).toHaveBeenCalledTimes(1);
    const payload = calls.askAboutLook.mock.calls[0]?.[0] as { data: { lookIds: string[]; occasion: string; prompt: string } };
    expect(payload.data.lookIds).toEqual(VEST_IDS);
    expect(payload.data.occasion).toBe("weekend");
    expect(payload.data.prompt).toBe("What would make this better?");
    expect(document.querySelector("[data-stylist-dock]")?.className).toContain("z-[70]");
    unmount(view);
  });

  it("auto-asks once, and a reopen without a new tap does not ask again", async () => {
    const view = mount(
      <>
        {sheet()}
        <StylistDock />
      </>,
    );
    const button = document.querySelector('[aria-label="Ask about this look"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    await flush();
    expect(calls.askAboutLook).toHaveBeenCalledTimes(1);
    await act(async () => {
      useCloset.setState({ hydrated: false });
    });
    await flush();
    expect(calls.askAboutLook).toHaveBeenCalledTimes(1);
    const close = document.querySelector('[aria-label="Close the stylist"]') as HTMLButtonElement;
    await act(async () => {
      close.click();
    });
    const fab = document.querySelector("[data-stylist-fab]") as HTMLButtonElement;
    await act(async () => {
      fab.click();
    });
    await flush();
    expect(calls.askAboutLook).toHaveBeenCalledTimes(1);
    expect(calls.askStylist).not.toHaveBeenCalled();
    await act(async () => {
      button.click();
    });
    await flush();
    expect(calls.askAboutLook).toHaveBeenCalledTimes(2);
    unmount(view);
  });

  it("does not auto-ask when signed out, and signing in later does not send", async () => {
    setLookAskAuth({ user: null, isPending: false });
    const view = mount(
      <>
        {sheet()}
        <StylistDock />
      </>,
    );
    const button = document.querySelector('[aria-label="Ask about this look"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    await flush();
    expect(calls.askAboutLook).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(SIGNED_OUT);
    expect(document.querySelector("[data-focus-look]")?.textContent).toContain("This look:");
    expect(document.querySelector("[data-look-ask-hint]")?.textContent).toContain("What would make this better?");
    await act(async () => {
      setLookAskAuth(signedInLookAskAuth());
    });
    await flush();
    expect(calls.askAboutLook).not.toHaveBeenCalled();
    unmount(view);
  });

  it("shows the limit and spends no further ask when the server is at the cap", async () => {
    calls.askAboutLook.mockResolvedValue({ ok: false, error: limitMessage(86400), reason: "quota" });
    const view = mount(
      <>
        {sheet()}
        <StylistDock />
      </>,
    );
    const button = document.querySelector('[aria-label="Ask about this look"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    await flush();
    expect(calls.askAboutLook).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Too many requests");
    expect(document.querySelector("[data-focus-look]")).toBeTruthy();
    await act(async () => {
      useCloset.setState({ hydrated: false });
    });
    await flush();
    expect(calls.askAboutLook).toHaveBeenCalledTimes(1);
    unmount(view);
  });

  it("applies a legal swap, Undo restores it, and Save and Wear use the swapped ids", async () => {
    const knit = legalKnit();
    const worn: string[][] = [];
    calls.askAboutLook.mockResolvedValue({
      ok: true,
      text: "Almost.\nSwap the blue plaid flannel shirt.",
      swaps: [{ fromId: FLANNEL, toId: knit, slot: "top" }],
      occasion: "weekend",
    });
    const view = mount(
      <>
        {sheet((ids) => worn.push(ids))}
        <StylistDock />
      </>,
    );
    const beforeLooks = useCloset.getState().looks.length;
    await act(async () => {
      (document.querySelector('[aria-label="Ask about this look"]') as HTMLButtonElement).click();
    });
    await flush();
    const draft = readJacketDraft(VEST_IDS, "look:vest");
    expect(draft?.ids).toContain(knit);
    expect(draft?.ids).not.toContain(FLANNEL);
    expect(draft?.preSwapIds).toEqual(VEST_IDS);
    const undo = document.querySelector("[data-undo-swap]") as HTMLButtonElement;
    expect(undo).toBeTruthy();
    expect(undo.className).toContain("min-h-[44px]");
    expect(undo.getAttribute("aria-label")).toBe("Undo swap");
    expect(useCloset.getState().looks.length).toBe(beforeLooks);
    expect(putImage).not.toHaveBeenCalled();

    await act(async () => {
      undo.click();
    });
    expect(readJacketDraft(VEST_IDS, "look:vest")?.ids).toEqual(VEST_IDS);
    expect(readJacketDraft(VEST_IDS, "look:vest")?.preSwapIds ?? null).toBeNull();
    expect(document.querySelector("[data-undo-swap]")).toBeNull();

    calls.askAboutLook.mockResolvedValue({
      ok: true,
      text: "Almost.\nSwap the blue plaid flannel shirt.",
      swaps: [{ fromId: FLANNEL, toId: knit, slot: "top" }],
      occasion: "weekend",
    });
    await act(async () => {
      (document.querySelector('[aria-label="Ask about this look"]') as HTMLButtonElement).click();
    });
    await flush();
    expect(readJacketDraft(VEST_IDS, "look:vest")?.ids).toContain(knit);
    const save = [...document.querySelectorAll("button")].find((button) => button.textContent === "Save look") as HTMLButtonElement;
    await act(async () => {
      save.click();
    });
    const saved = useCloset.getState().looks[0];
    expect(saved?.garmentIds).toContain(knit);
    expect(saved?.garmentIds).not.toContain(FLANNEL);
    expect(document.querySelector("[data-undo-swap]")).toBeNull();
    const wear = [...document.querySelectorAll("button")].find((button) => button.textContent === "Wear this") as HTMLButtonElement;
    await act(async () => {
      wear.click();
    });
    expect(worn.at(-1)).toContain(knit);
    expect(worn.at(-1)).not.toContain(FLANNEL);
    unmount(view);
  });

  it("leaves the draft alone when the sheet unmounts before the reply", async () => {
    let resolveAsk: (value: unknown) => void = () => {};
    calls.askAboutLook.mockImplementation(() => new Promise((resolve) => {
      resolveAsk = resolve;
    }));
    const view = mount(
      <>
        {sheet()}
        <StylistDock />
      </>,
    );
    await act(async () => {
      (document.querySelector('[aria-label="Ask about this look"]') as HTMLButtonElement).click();
    });
    unmount(view);
    await act(async () => {
      resolveAsk({
        ok: true,
        text: "Almost.\nTuck the blue plaid flannel shirt.",
        swaps: [{ fromId: FLANNEL, toId: legalKnit(), slot: "top" }],
        occasion: "weekend",
      });
    });
    await flush();
    expect(readJacketDraft(VEST_IDS, "look:vest")).toBeNull();
    expect(offerLookSwaps([{ fromId: FLANNEL, toId: legalKnit(), slot: "top" }])).toBe(false);
  });

  it("an ordinary send with no focus look calls askStylist", async () => {
    const view = mount(<StylistDock />);
    const fab = document.querySelector("[data-stylist-fab]") as HTMLButtonElement;
    await act(async () => {
      fab.click();
    });
    const input = document.querySelector("input") as HTMLInputElement;
    const form = input.closest("form") as HTMLFormElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "How should I care for wool?");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(calls.askAboutLook).not.toHaveBeenCalled();
    unmount(view);
  });
});
