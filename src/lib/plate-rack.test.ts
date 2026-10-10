import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  nearestIndex,
  RAIL_PAD,
  rackIdentity,
  rackPose,
  railTilt,
  scrubIndex,
  spotlightPose,
  stepIndex,
  SWING_REST,
  swingKick,
  swingSettled,
  swingStep,
  tiltFromPointer,
} from "./plate-rack.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const BANNED =
  /\b(Polo|Purple|RRL|ALD|Faloni|545|Sweet Stable|Italian summer|Italian winter)\b/;

describe("The Rail and Spotlight geometry", () => {
  it("every hanger rests within ±0.5°, neighbours lean opposite ways, and the rail inset is small", () => {
    for (let i = 0; i < 40; i++) {
      const t = railTilt(i);
      assert.ok(Math.abs(t) <= 0.5 && Math.abs(t) > 0, `hanger ${i}: ${t}`);
      assert.ok(Math.sign(railTilt(i + 1)) !== Math.sign(t), `hangers ${i} and ${i + 1} lean the same way`);
    }
    assert.equal(railTilt(-1), railTilt(5));
    assert.equal(RAIL_PAD, 8);
  });

  it("spotlight: 1.15× at the centre, ~0.88× beside it, ~0.76× two out, and monotonic in the fractional offset", () => {
    assert.deepEqual(spotlightPose(0), { scale: 1.15, rotateY: 0, opacity: 1, z: 100 });
    assert.equal(Object.is(spotlightPose(-0).rotateY, -0), false);
    close(spotlightPose(1).scale, 0.88);
    close(spotlightPose(-1).scale, 0.88);
    close(spotlightPose(1).opacity, 0.6);
    close(spotlightPose(2).scale, 0.76);
    assert.equal(spotlightPose(1).rotateY, -6);
    assert.equal(spotlightPose(-1).rotateY, 6);
    assert.equal(spotlightPose(3).opacity, 0);
    assert.equal("saturate" in spotlightPose(1), false);
    // Pulling a card in: scale and opacity rise all the way, with no step, as |offset| falls.
    let last = spotlightPose(2.5);
    for (let a = 2.4; a >= -1e-9; a -= 0.1) {
      const p = spotlightPose(a);
      assert.ok(p.scale >= last.scale, `scale at ${a.toFixed(1)}`);
      assert.ok(p.opacity >= last.opacity, `opacity at ${a.toFixed(1)}`);
      assert.ok(p.z >= last.z);
      last = p;
    }
    // The z is rackPose's, so the slide stacking rule is unchanged.
    for (const a of [0, 0.4, 1, 1.6, 2, 3]) assert.equal(spotlightPose(a).z, rackPose(a).z);
  });

  it("the scrubber maps a position along the strip to the look under it", () => {
    assert.equal(scrubIndex(0, 9), 0);
    assert.equal(scrubIndex(0.11, 9), 0);
    assert.equal(scrubIndex(0.12, 9), 1);
    assert.equal(scrubIndex(0.5, 9), 4);
    assert.equal(scrubIndex(0.999, 9), 8);
    assert.equal(scrubIndex(1, 9), 8);
    assert.equal(scrubIndex(1.5, 9), 8);
    assert.equal(scrubIndex(-1, 9), 0);
    assert.equal(scrubIndex(0.5, 0), 0);
  });

  it("a scroll swings the hangers 1–2° against the motion and the spring settles them back to 0", () => {
    const kicked = swingKick(SWING_REST, 40);
    assert.ok(kicked.angle < 0 && kicked.angle >= -2, `against the motion: ${kicked.angle}`);
    assert.ok(swingKick(SWING_REST, -40).angle > 0);
    assert.ok(Math.abs(swingKick(SWING_REST, 10000).angle) <= 2, "never past 2°");
    assert.equal(swingKick(SWING_REST, 0), SWING_REST);
    let s = swingKick(swingKick(SWING_REST, 30), 30);
    let steps = 0;
    while (!swingSettled(s) && steps < 400) {
      s = swingStep(s);
      steps += 1;
    }
    assert.ok(steps > 3 && steps < 200, `${steps} frames`);
    assert.deepEqual(s, SWING_REST);
    assert.equal(Object.is(swingStep({ angle: -0.001, velocity: 0 }).angle, -0), false);
  });
});

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
    // The centre-change z-index write repaints the slides' stacking context: the track makes
    // itself that context, high in the page's order (cheap layerization), so the repaint covers
    // one row, not the page container. The dots overlap the track's bottom padding and sit above it.
    assert.match(css, /\.plate-rack-track\s*\{[^}]*position: relative;\s*isolation: isolate;\s*z-index: 90;/);
    assert.match(css, /\.plate-rack-scrub\s*\{\s*position: relative;\s*z-index: 91;/);
    assert.match(css, /\.plate-rack-arrow\s*\{[^}]*z-index: 120;/);
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
    // Snaps are smooth unless reduced; the scrubber's drag passes "auto" so the row follows the finger.
    assert.match(source, /behavior: behavior \?\? \(reduced \? "auto" : "smooth"\)/);
    assert.match(source, /scrollToIndex\(i, "auto"\)/);
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

  it("only the centre card spreads its collage; the rack has no flat-lay rules left", () => {
    const rack = css.slice(css.indexOf("/* Lookbook rack:"), css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    // The FlatLay-era rack rules are gone with FlatLay; the spread lives on .collage-piece.
    assert.equal(rack.includes(".flat-piece"), false);
    assert.match(
      css,
      /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.is-center \.plate-rack-card:hover \.collage-piece,\s*\.plate-rack-slide\.is-center button:focus-visible \.collage-piece,[^{]*\{\s*transform: translate\(var\(--hx, 0\), var\(--hy, 0\)\) rotate\(var\(--hr, 0deg\)\);/,
    );
    // The resting tile has no transform of its own, so the side cards stay put.
    assert.match(css, /\.collage-piece \{[^}]*transform: translate\(0, 0\) rotate\(0deg\);/);
    // The stacked-kit hover scale is gone with the kit.
    assert.equal(css.includes(".plate-rack-card:hover .look-kit-plate"), false);
    // The card surface is CD's: warm card, 18px radius, 18/18/16 padding.
    assert.match(rack, /\.plate-rack-card \{[^}]*background: var\(--color-card\);[^}]*border-radius: 18px;[^}]*padding: 18px 18px 16px;/);
    // Today's FlatLay fan (closet.tsx, look-builder.tsx still use it) is untouched.
    assert.match(css, /\.group:hover \.flat-piece,\s*\.group:focus-visible \.flat-piece,\s*\.group:focus-within \.flat-piece\s*\{\s*transform: translate\(var\(--sx, 0\), var\(--sy, 0\)\) rotate\(var\(--sr, 0deg\)\);/);
  });

  it("The Rail (≥640px) and Spotlight (<640px) share the engine: one markup, CSS splits the look", () => {
    // Which look is in force is a ref from the width query, never state; the swing is off under reduced motion.
    assert.match(source, /const RAIL_QUERY = "\(min-width: 640px\)";/);
    assert.match(source, /railRef\.current = window\.matchMedia\(RAIL_QUERY\)\.matches;/);
    assert.match(source, /const kickSwing = useCallback\(\s*\(dx: number\) => \{\s*if \(!railRef\.current \|\| reducedRef\.current\) return;/);
    assert.match(source, /row\.style\.setProperty\("--swing"/);
    // The rail writes no poses; Spotlight writes spotlightPose from the fractional offset each frame.
    const loop = source.slice(source.indexOf("const measure = "), source.indexOf("const scrollToIndex"));
    assert.match(loop, /if \(!railRef\.current\) \{[\s\S]*spotlightPose\(offsets\[i\]!\)/);
    assert.equal(loop.includes("railTilt("), false, "the resting tilt is render-time, not per frame");
    // Hanger, hook, tag and scrubber in the markup; the scrubber thumb is the look's jacket, else its top.
    assert.match(source, /className="plate-rack-hang" style=\{\{ \["--tilt" as string\]: `\$\{railTilt\(i\)\}deg` \}\}/);
    assert.match(source, /<Hook \/>/);
    assert.match(source, /className="plate-rack-tag"/);
    assert.match(source, /className="plate-rack-scrub"/);
    assert.match(source, /slots\.find\(\(p\) => p\.slot === "outer"\) \?\? slots\.find\(\(p\) => p\.slot === "top"\)/);
    assert.equal(source.includes("plate-rack-dots"), false);
    assert.equal(source.includes("plate-rack-dot"), false);
    // Tap-to-open stays the card's own button; a drag still swallows its click; the sheet opener is untouched.
    assert.match(source, /swallowClick\.current = true;/);
    assert.match(source, /if \(railRef\.current \|\| i === centerRef\.current\) return;/);
    assert.equal(source.includes("onOpen"), false);
    // CSS: rail decoration and hooks only from 640px; scrubber only below; poses ignored on the rail.
    assert.match(css, /\.plate-rack-rail \{\s*display: none;/);
    assert.match(css, /@media \(min-width: 640px\) \{\s*\.plate-rack-rail \{\s*display: block;/);
    assert.match(css, /\.plate-rack-hook \{\s*display: none;/);
    assert.match(css, /\.plate-rack-hang \{\s*transform-origin: 50% 0;/);
    assert.match(css, /\.plate-rack-hang \{\s*transform: rotate\(calc\(var\(--tilt, 0deg\) \+ var\(--swing, 0deg\)\)\);/);
    assert.match(css, /@media \(min-width: 640px\) \{\s*\.plate-rack-scrub \{\s*display: none;/);
    assert.match(css, /\.plate-rack-track\.is-dragging \.plate-rack-pose \{\s*transition: none;/);
    assert.match(css, /@media \(min-width: 640px\) and \(hover: hover\) and \(pointer: fine\) \{[^}]*\.plate-rack-slide:hover \{\s*z-index: 101 !important;/);
    assert.match(css, /\.plate-rack-row \.plate-rack-slide:hover \.plate-rack-card \{\s*transform: translateY\(12px\) scale\(1\.1\);/);
    assert.match(css, /\.plate-rack-row:hover \.plate-rack-slide:not\(:hover\) \.plate-rack-card \{\s*opacity: 0\.82;/);
    const reduce = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(reduce, /\.plate-rack-row \.plate-rack-slide:hover \.plate-rack-card,\s*\.is-center \.plate-rack-card:hover \{\s*transform: none;/);
    for (const rel of ["../components/closet/plate-rack.tsx", "./plate-rack.ts", "../components/closet/detector-sections.tsx", "../styles.css"]) {
      assert.equal(BANNED.test(readFileSync(new URL(rel, import.meta.url), "utf8")), false, rel);
    }
  });

  it("the rack never animates paint: no filter, no box-shadow transition, no 3D row, no isolated row", () => {
    const rack = css.slice(css.indexOf("/* Lookbook rack:"), css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf("/* Lookbook rack:")));
    assert.ok(rack.length > 0);
    for (const banned of ["filter", "saturate", "preserve-3d", "translateZ", "-webkit-overflow-scrolling"]) {
      assert.equal(rack.includes(banned), false, banned);
    }
    // Only the track isolates (with a high z-index); an isolated row or slide janks the composited poses.
    assert.equal(rack.split("isolation: isolate").length - 1, 1);
    assert.equal(/\.plate-rack-(row|slide|pose|card)\s*\{[^}]*isolation/.test(rack), false);
    // The centre card's deeper shadow is a pseudo-element that fades in by opacity.
    assert.match(rack, /\.plate-rack-card::after\s*\{[^}]*box-shadow:[^}]*transition: opacity 300ms/);
    assert.match(rack, /\.is-center \.plate-rack-card::after\s*\{\s*opacity: 1;/);
    for (const block of rack.split("}")) {
      assert.equal(/transition:[^;]*box-shadow/s.test(block), false, block.trim().slice(0, 60));
    }
  });
});
