import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nearestIndex, rackIdentity, rackPose, stepIndex, tiltFromPointer } from "./plate-rack.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

describe("plate rack geometry", () => {
  it("the centre card is upright and full size, and -0 never leaks out", () => {
    const pose = rackPose(0);
    // Fade is opacity only: no saturate/filter, which re-rasters a moving card every frame.
    assert.deepEqual(pose, { scale: 1, rotateY: 0, opacity: 1, z: 100 });
    assert.equal(Object.is(pose.rotateY, -0), false);
    assert.equal(Object.is(rackPose(-0).rotateY, -0), false);
  });

  it("neighbours shrink, fade and turn away in mirror image", () => {
    const right = rackPose(1);
    const left = rackPose(-1);
    close(right.scale, 0.84);
    close(left.scale, 0.84);
    close(right.opacity, 0.72);
    close(left.opacity, 0.72);
    assert.equal("saturate" in right, false);
    assert.equal(right.rotateY, -14);
    assert.equal(left.rotateY, 14);
    assert.equal(right.z, 90);
    assert.equal(left.z, 90);
    // The clamp holds past two cards out; the third card out is gone.
    close(rackPose(2).scale, 0.68);
    assert.equal(rackPose(2).rotateY, -28);
    assert.equal(rackPose(2.4).rotateY, -28);
    close(rackPose(2.4).opacity, 0.44);
    assert.equal(rackPose(3).opacity, 0);
    assert.equal(rackPose(-3).opacity, 0);
    assert.equal(rackPose(3).z, 75);
    close(rackPose(0.5).scale, 0.92);
    close(rackPose(-0.5).opacity, 0.86);
    assert.equal(rackPose(0.5).rotateY, -7);
  });

  it("nearestIndex picks the smallest |offset|, ties go low, and nothing is index 0", () => {
    assert.equal(nearestIndex([1.2, -0.3, 0.3]), 1);
    assert.equal(nearestIndex([0.5, -0.5]), 0);
    assert.equal(nearestIndex([-0.5, 0.5, 2]), 0);
    assert.equal(nearestIndex([2, 1, 0]), 2);
    assert.equal(nearestIndex([]), 0);
  });

  it("stepIndex walks one hanger and stops at the ends", () => {
    assert.equal(stepIndex(0, -1, 5), 0);
    assert.equal(stepIndex(0, 1, 5), 1);
    assert.equal(stepIndex(4, 1, 5), 4);
    assert.equal(stepIndex(3, -1, 5), 2);
    assert.equal(stepIndex(0, 1, 1), 0);
    assert.equal(stepIndex(0, -1, 0), 0);
  });

  it("rackIdentity changes exactly when the plates' keys do", () => {
    const weekday = rackIdentity(["weekday:0", "weekday:1", "weekday:2"]);
    assert.equal(weekday, rackIdentity(["weekday:0", "weekday:1", "weekday:2"]));
    // Same count, different occasion → a different row.
    assert.notEqual(weekday, rackIdentity(["weekend:0", "weekend:1", "weekend:2"]));
    // One look fewer → a different row.
    assert.notEqual(weekday, rackIdentity(["weekday:0", "weekday:1"]));
    assert.notEqual(rackIdentity(["a", "b"]), rackIdentity(["b", "a"]));
    // Unkeyed plates fall back to their index; numbers and strings are not confused.
    assert.equal(rackIdentity([null, undefined]), rackIdentity([null, null]));
    assert.notEqual(rackIdentity([null, undefined]), rackIdentity([undefined]));
    assert.equal(rackIdentity([1, 2]), rackIdentity(["1", "2"]));
    assert.notEqual(rackIdentity(["1", "2"]), rackIdentity(["12"]));
    assert.equal(rackIdentity([]), "");
  });

  it("tilt follows the pointer from the centre of the card, rounded to a tenth", () => {
    assert.deepEqual(tiltFromPointer(0.5, 0.5), { rx: 0, ry: 0 });
    assert.deepEqual(tiltFromPointer(1, 0), { rx: 5, ry: 6 });
    assert.deepEqual(tiltFromPointer(0, 1), { rx: -5, ry: -6 });
    assert.deepEqual(tiltFromPointer(0.75, 0.25), { rx: 2.5, ry: 3 });
    assert.deepEqual(tiltFromPointer(2, -1), { rx: 5, ry: 6 });
    const centre = tiltFromPointer(0.5, 0.5);
    assert.equal(Object.is(centre.rx, -0), false);
    assert.equal(Object.is(centre.ry, -0), false);
  });
});

describe("plate rack component and styles", () => {
  const source = readFileSync(new URL("../components/closet/plate-rack.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  it("is a labelled carousel region on a scroll-snap track", () => {
    assert.match(source, /role="region"/);
    assert.match(source, /aria-roledescription="carousel"/);
    assert.match(source, /aria-label=\{label\}/);
    assert.match(source, /className="plate-rack-track"/);
    assert.match(source, /className="plate-rack"/);
    assert.match(source, /"plate-rack-slide"/);
    assert.match(source, /aria-label="Previous outfit"/);
    assert.match(source, /aria-label="Next outfit"/);
    assert.match(source, /prefers-reduced-motion/);
    assert.match(source, /\(hover: hover\) and \(pointer: fine\)/);
    assert.match(source, /ResizeObserver/);
    assert.match(source, /requestAnimationFrame/);
    assert.match(source, /from "@\/lib\/plate-rack"/);
    for (const name of ["rackPose", "nearestIndex", "stepIndex", "tiltFromPointer", "rackIdentity"]) {
      assert.ok(source.includes(`${name}(`), name);
    }
  });

  it("the setup effect re-runs when the plates change, so a new row starts on card 0", () => {
    const setup = source.slice(source.indexOf("useLayoutEffect(() => {"), source.indexOf("useEffect(() => {"));
    assert.ok(setup.length > 0);
    assert.match(setup, /track\.scrollLeft = 0;\s*measure\(\);/);
    assert.match(setup, /\}, \[measure, identity\]\);/);
    assert.match(source, /const identity = rackIdentity\(keys\);/);
    assert.match(source, /key=\{keys\[i\]\}/);
  });

  it("stacks by the plan's z-index on the slide, set per centre change, with no depth math and no filter", () => {
    assert.match(source, /zIndex: rackPose\(offset\)\.z/);
    assert.match(source, /className=\{cn\("plate-rack-slide", i === active && "is-center"\)\}\s*style=\{slideStyle\(i - active\)\}/);
    // Not in the scroll loop: a z-index write repaints the row every frame, transform and opacity do not.
    const loop = source.slice(source.indexOf("const measure = "), source.indexOf("const scrollToIndex"));
    assert.equal(loop.includes("zIndex"), false);
    for (const banned of ["translateZ", "DEPTH", "depthOf", "saturate", "style.filter", "filter:"]) {
      assert.equal(source.includes(banned), false, banned);
    }
  });

  it("hover tilt reads the slide's own rect and is rAF-throttled", () => {
    const tilt = source.slice(source.indexOf("const onTilt = "), source.indexOf("const onTiltEnd = "));
    assert.ok(tilt.length > 0);
    assert.match(tilt, /el: e\.currentTarget/);
    assert.match(tilt, /if \(tiltFrame\.current\) return;\s*tiltFrame\.current = requestAnimationFrame\(/);
    assert.match(tilt, /t\.el\.getBoundingClientRect\(\)/);
    assert.equal(tilt.includes("querySelector"), false);
    assert.equal(tilt.includes("plate-rack-card"), false);
    const endAt = source.indexOf("const onTiltEnd = ");
    const end = source.slice(endAt, source.indexOf("return (", endAt));
    assert.match(end, /cancelAnimationFrame\(tiltFrame\.current\)/);
  });

  it("the scroll loop writes transforms, and only the centre index is React state", () => {
    // One piece of state: which card is centred. Poses go straight to style, never through setState.
    assert.equal(source.split("useState").length - 1, 2, "one useState import, one call");
    assert.equal(source.split("setCenter(").length - 1, 1);
    assert.match(source, /if \(next !== centerRef\.current\) \{\s*centerRef\.current = next;\s*setCenter\(next\);/);
    const loop = source.slice(source.indexOf("const measure = "), source.indexOf("const scrollToIndex"));
    assert.ok(loop.length > 0);
    assert.equal(/\bset[A-Z]\w*\(/.test(loop.replace(/setCenter\(next\)/, "").replace(/\.setProperty\(/g, "")), false, "no other setState in the loop");
    // Reads (rects) come before writes (styles): no layout thrash per frame.
    assert.ok(loop.indexOf("getBoundingClientRect") < loop.indexOf("style.transform"));
    assert.equal(/\.style\.(width|height|margin|padding|left|top)\s*=/.test(loop), false);
    assert.match(source, /behavior: reduced \? "auto" : "smooth"/);
  });

  it("the stylesheet snaps the rack and leaves This week's swipe row alone", () => {
    assert.match(css, /\.look-swipe > \* \{\s*flex: 0 0 84%;/);
    assert.match(css, /\.plate-rack-track\s*\{[^}]*scroll-snap-type: x mandatory/);
    assert.match(css, /\.plate-rack-slide\s*\{[^}]*scroll-snap-align: center/);
    assert.match(css, /\.plate-rack-track::-webkit-scrollbar\s*\{\s*display: none/);
    assert.match(css, /\.plate-rack-pose\s*\{[^}]*will-change: transform, opacity;/);
    const reduce = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(reduce, /\.plate-rack-track\.is-ready \.plate-rack-pose,\s*\.plate-rack-card,\s*\.plate-rack-card::after,[^{]*\{\s*transition: none/);
    assert.match(reduce, /\.plate-rack-card:hover\s*\{[^}]*transform: none/);
  });

  it("only the centre card fans its flat-lay; the side cards keep their resting pose", () => {
    const rack = css.slice(css.indexOf("/* Lookbook rack:"), css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(rack, /\.plate-rack-slide:not\(\.is-center\) \.flat-piece\s*\{\s*transform: rotate\(var\(--rr, 0deg\)\) !important;/);
    assert.match(rack, /\.plate-rack-slide\.is-center button:focus-visible \.flat-piece\s*\{\s*transform: translate\(var\(--sx, 0\), var\(--sy, 0\)\) rotate\(var\(--sr, 0deg\)\);/);
    // The stacked-kit hover scale is gone with the kit.
    assert.equal(css.includes(".plate-rack-card:hover .look-kit-plate"), false);
    // Today's hover fan is the one the centre card inherits, untouched.
    assert.match(css, /\.group:hover \.flat-piece,\s*\.group:focus-visible \.flat-piece,\s*\.group:focus-within \.flat-piece\s*\{\s*transform: translate\(var\(--sx, 0\), var\(--sy, 0\)\) rotate\(var\(--sr, 0deg\)\);/);
  });

  it("the rack never animates paint: no filter, no box-shadow transition, no 3D row", () => {
    const rack = css.slice(css.indexOf("/* Lookbook rack:"), css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf("/* Lookbook rack:")));
    assert.ok(rack.length > 0);
    for (const banned of ["filter", "saturate", "preserve-3d", "translateZ", "-webkit-overflow-scrolling"]) {
      assert.equal(rack.includes(banned), false, banned);
    }
    assert.equal(rack.includes("isolation: isolate"), false, "an isolated row janks the composited poses");
    // The centre card's deeper shadow is a pseudo-element that fades in by opacity.
    assert.match(rack, /\.plate-rack-card::after\s*\{[^}]*box-shadow:[^}]*transition: opacity 300ms/);
    assert.match(rack, /\.is-center \.plate-rack-card::after\s*\{\s*opacity: 1;/);
    for (const block of rack.split("}")) {
      assert.equal(/transition:[^;]*box-shadow/s.test(block), false, block.trim().slice(0, 60));
    }
  });
});
