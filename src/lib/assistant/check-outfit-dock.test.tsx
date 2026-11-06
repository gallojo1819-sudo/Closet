/**
 * The dock's photo control, rendered the way the photo picker test renders: static markup,
 * plus the file handler with a mocked check. No live model, no closet.v6 write.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OutfitCheckBar } from "@/components/shell/outfit-check-bar";
import { StylistThread } from "@/components/shell/stylist-thread";
import { CHECK_HEIC_TEXT, CHECK_OVERSIZE_TEXT, CHECK_TYPE_TEXT, CHECK_USER_TURN } from "../outfit-check-copy.ts";
import { prepareOutfitPhoto, submitOutfitCheck } from "../outfit-check-client.ts";
import { jpegDataUrl } from "../images.ts";

vi.mock("../images.ts", () => ({
  jpegDataUrl: vi.fn(),
}));

const jpeg = vi.mocked(jpegDataUrl);

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

describe("outfit check dock", () => {
  it("the photo button is a 44px target labelled Check this outfit", () => {
    const markup = renderToStaticMarkup(
      <OutfitCheckBar pickerOpen={false} busy={false} onToggle={() => {}} onFile={() => {}} />,
    );
    expect(markup).toContain('aria-label="Check this outfit"');
    expect(markup).toContain("min-h-[44px]");
    expect(markup).toContain("min-w-[44px]");
    expect(markup).toContain("data-outfit-check");
    const dock = readFileSync(new URL("../../components/shell/stylist-dock.tsx", import.meta.url), "utf8");
    const copy = readFileSync(new URL("../outfit-check-copy.ts", import.meta.url), "utf8");
    expect(dock).toContain("<OutfitCheckBar");
    expect(dock).toContain("CHECK_USER_TURN");
    expect(copy).toContain('CHECK_BUTTON_LABEL = "Check this outfit"');
  });

  it("the picker offers take photo and choose from photos", () => {
    const markup = renderToStaticMarkup(
      <OutfitCheckBar pickerOpen busy={false} onToggle={() => {}} onFile={() => {}} />,
    );
    expect(markup).toContain("Take photo");
    expect(markup).toContain("Choose from Photos");
    expect(markup).toContain('capture="environment"');
    expect(markup).toContain("data-outfit-picker");
  });

  it("picking a jpeg shows the thumbnail and calls check once", async () => {
    const image = "data:image/jpeg;base64,abc";
    jpeg.mockResolvedValue(image);
    const prepared = await prepareOutfitPhoto(file("look.jpg", "image/jpeg"));
    expect(prepared).toEqual({ ok: true, image });
    expect(jpeg).toHaveBeenCalledWith(expect.any(File), 1024, 0.8);
    const check = vi.fn(async () => ({ ok: true as const, text: "Almost.\nTuck the shirt.", garmentIds: [] as string[], occasion: "weekend" as const }));
    const result = await submitOutfitCheck(
      { image, garments: [] },
      { check, deadlineMs: 1000 },
    );
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    const markup = renderToStaticMarkup(
      <StylistThread
        messages={[{ id: "u1", role: "user", text: CHECK_USER_TURN, createdAt: "2026-11-06T16:00:00.000Z" }]}
        images={{ u1: image }}
      />,
    );
    expect(markup).toContain(CHECK_USER_TURN);
    expect(markup).toContain(image);
    expect(markup).toContain("<img");
  });

  it("a HEIC the browser cannot read shows the plain refusal and does not check", async () => {
    jpeg.mockRejectedValue(new Error("jpeg"));
    const check = vi.fn();
    const prepared = await prepareOutfitPhoto(file("IMG.HEIC", "image/heic"));
    expect(prepared).toEqual({ ok: false, error: CHECK_HEIC_TEXT });
    expect(check).not.toHaveBeenCalled();
    const markup = renderToStaticMarkup(
      <OutfitCheckBar pickerOpen={false} busy={false} notice={CHECK_HEIC_TEXT} onToggle={() => {}} onFile={() => {}} />,
    );
    expect(markup).toContain(CHECK_HEIC_TEXT);
  });

  it("an oversize jpeg and a file that is not a photo show the plain refusal", async () => {
    jpeg.mockResolvedValue(`data:image/jpeg;base64,${"A".repeat(2_200_000)}`);
    const big = await prepareOutfitPhoto(file("big.jpg", "image/jpeg"));
    expect(big).toEqual({ ok: false, error: CHECK_OVERSIZE_TEXT });
    jpeg.mockClear();
    const pdf = await prepareOutfitPhoto(file("notes.pdf", "application/pdf"));
    expect(pdf).toEqual({ ok: false, error: CHECK_TYPE_TEXT });
    expect(jpeg).not.toHaveBeenCalled();
    const markup = renderToStaticMarkup(
      <OutfitCheckBar pickerOpen={false} busy={false} notice={CHECK_OVERSIZE_TEXT} onToggle={() => {}} onFile={() => {}} />,
    );
    expect(markup).toContain(CHECK_OVERSIZE_TEXT);
  });
});
