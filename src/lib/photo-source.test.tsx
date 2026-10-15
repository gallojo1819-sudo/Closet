/**
 * The "On me · Reference" full-body sheet and the One-piece tab's hangtag row each offer two
 * ways in: "Take photo" (an input with capture="environment") and "Choose from Photos" (an
 * input with no capture, so iOS and Android offer the photo library, and no multiple, since
 * each takes one file). Both accept HEIC (CAMERA_ACCEPT). The sheet and the row are rendered
 * to markup here as the app mounts them; no garments are needed and nothing is stored.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HangtagSource } from "@/components/add/hangtag-source";
import { RefPhotoDialog } from "@/components/shell/top-bar";
import { CAMERA_ACCEPT, CHOOSE_PHOTOS_LABEL, TAKE_PHOTO_LABEL } from "./camera.ts";

type Attrs = Record<string, string | true>;

/** Every <input> in the markup as an attribute map (bare attributes are `true`). */
function inputs(markup: string): Attrs[] {
  const out: Attrs[] = [];
  for (const tag of markup.match(/<input\b[^>]*>/g) ?? []) {
    const attrs: Attrs = {};
    const body = tag.slice("<input".length, tag.endsWith("/>") ? -2 : -1);
    for (const m of body.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)) {
      attrs[m[1]] = m[2] === undefined ? true : m[2];
    }
    out.push(attrs);
  }
  return out;
}

function byLabel(list: Attrs[], label: string): Attrs {
  const hits = list.filter((a) => a["aria-label"] === label);
  expect(hits, `one input labelled ${label}`).toHaveLength(1);
  return hits[0];
}

function expectTwoWays(markup: string) {
  const files = inputs(markup).filter((a) => a.type === "file");
  expect(files).toHaveLength(2);

  const cam = byLabel(files, TAKE_PHOTO_LABEL);
  expect(cam.capture).toBe("environment");
  expect(cam.accept).toBe(CAMERA_ACCEPT);
  expect("multiple" in cam).toBe(false);

  const lib = byLabel(files, CHOOSE_PHOTOS_LABEL);
  expect("capture" in lib).toBe(false);
  expect("multiple" in lib).toBe(false);
  expect(lib.accept).toBe(CAMERA_ACCEPT);

  for (const input of files) {
    expect(input.accept).toContain(".heic");
    expect(input.accept).toContain("image/heic");
    expect(input.accept).toContain("image/*");
  }
}

describe("photo picker: take or choose", () => {
  it("the full-body sheet has a camera input and a library input", () => {
    const markup = renderToStaticMarkup(<RefPhotoDialog onClose={() => {}} />);
    expectTwoWays(markup);
    expect(markup).toContain(`>${TAKE_PHOTO_LABEL}</button>`);
    expect(markup).toContain(`>${CHOOSE_PHOTOS_LABEL}</button>`);
    expect(markup).toContain("Add photo");
    expect(markup).toContain("It never leaves this browser");
  });

  it("the hangtag row has a camera input and a library input", () => {
    const markup = renderToStaticMarkup(<HangtagSource busy={false} onFile={() => {}} />);
    expectTwoWays(markup);
    expect(markup).toContain(`Hangtag · ${TAKE_PHOTO_LABEL}`);
    expect(markup).toContain(`Hangtag · ${CHOOSE_PHOTOS_LABEL}`);
  });

  it("no camera-only input is left in the sheet or the studio", () => {
    const root = new URL("../components/", import.meta.url);
    const studio = readFileSync(new URL("add/studio.tsx", root), "utf8");
    const topBar = readFileSync(new URL("shell/top-bar.tsx", root), "utf8");
    for (const src of [studio, topBar]) {
      expect(src).not.toMatch(/capture=/);
      expect(src).not.toMatch(/accept="image\/\*"/);
    }
    expect(studio).toContain("<HangtagSource busy={busy} onFile={(file) => void processHangtag(file)} />");
    expect(topBar).toContain("<PhotoSourceInputs camRef={camRef} libRef={libRef}");
  });
});
