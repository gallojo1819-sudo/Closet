import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accountPool,
  decideLink,
  mergeAccount,
  mergeDrop,
  mergeGarments,
  shouldApplyCloud,
  unionById,
  type CloudMeta,
} from "./merge.ts";
import { emptyTaste, type TasteVeto } from "../taste.ts";

/** Fake user — tests never read or write closet.v6. */
const FAKE_USER = "fake-user-joe";

function g(id: string, extra: { demo?: boolean; archived?: boolean } = {}) {
  return { id, demo: extra.demo, archived: extra.archived };
}

function meta(ids: string[], extra: Partial<CloudMeta> = {}): CloudMeta {
  return {
    garments: ids.map((id) => g(id)),
    looks: extra.looks ?? [],
    journal: extra.journal ?? [],
    avoid: extra.avoid ?? {},
    drop: extra.drop ?? null,
    refPhoto: extra.refPhoto ?? false,
    v: extra.v ?? 6,
  };
}

describe("accountPool", () => {
  it("drops demo and keeps archived until a tombstone", () => {
    const pool = accountPool([g("real"), g("sample", { demo: true }), g("old", { archived: true })]);
    assert.deepEqual(
      pool.map((x) => x.id).sort(),
      ["old", "real"],
    );
  });
});

describe("decideLink", () => {
  it("pushes Joe's 145 when cloud is empty", () => {
    assert.equal(decideLink(145, 0), "push");
  });
  it("pulls onto an empty phone when the account has garments", () => {
    assert.equal(decideLink(0, 145), "pull");
  });
  it("unions when both sides have garments", () => {
    assert.equal(decideLink(12, 145), "union");
  });
  it("keeps when both are empty", () => {
    assert.equal(decideLink(0, 0), "keep");
  });
});

describe("shouldApplyCloud", () => {
  it("never applies an empty cloud over a non-empty local rack", () => {
    assert.equal(shouldApplyCloud(145, 0), false);
    assert.equal(shouldApplyCloud(143, 0), false);
    assert.equal(shouldApplyCloud(1, 0), false);
  });
  it("applies a cloud that has garments", () => {
    assert.equal(shouldApplyCloud(0, 145), true);
    assert.equal(shouldApplyCloud(145, 145), true);
  });
});

describe("unionById", () => {
  it("keeps both sides by id and lets local win on overlap", () => {
    const local = [{ id: "a", name: "local" }, { id: "c" }];
    const cloud = [{ id: "a", name: "cloud" }, { id: "b" }];
    const next = unionById(local, cloud);
    assert.equal(next.length, 3);
    assert.equal(next.find((x) => x.id === "a")?.name, "local");
    assert.ok(next.some((x) => x.id === "b"));
    assert.ok(next.some((x) => x.id === "c"));
  });
});

describe("mergeGarments", () => {
  it("never replaces a non-empty local rack with []", () => {
    const next = mergeGarments({
      local: [g("a"), g("b")],
      cloud: [],
      lastCloudIds: null,
    });
    assert.equal(next.length, 2);
    assert.deepEqual(
      next.map((x) => x.id),
      ["a", "b"],
    );
  });

  it("first link unions by id — never replace 145 with []", () => {
    const local = Array.from({ length: 145 }, (_, i) => g(`l${i}`));
    const cloud = [g("l0"), g("cloud-only")];
    const next = mergeGarments({ local, cloud, lastCloudIds: null });
    assert.equal(next.length, 146);
    assert.ok(next.some((x) => x.id === "cloud-only"));
    assert.ok(next.some((x) => x.id === "l144"));
  });

  it("pulls cloud onto an empty phone", () => {
    const cloud = Array.from({ length: 3 }, (_, i) => g(`c${i}`));
    const next = mergeGarments({ local: [], cloud, lastCloudIds: null });
    assert.equal(next.length, 3);
  });

  it("keeps a new local plate when the cloud cutout has not changed", () => {
    const base = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c.jpg" }];
    const local = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "idb:a:c" }];
    const cloud = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c.jpg" }];
    const next = mergeGarments({ local, cloud, lastCloudIds: ["a"], base });
    assert.equal(next[0]?.cutoutSrc, "idb:a:c");
    assert.equal(next[0]?.imageSrc, "sb:u/a/o.jpg");
  });

  it("an emptied local plate wins when reprint is true and the cloud cutout has not changed", () => {
    type Row = { id: string; imageSrc: string; cutoutSrc: string; reprint?: boolean };
    const base: Row[] = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c-693a12d9.jpg" }];
    const local: Row[] = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "", reprint: true }];
    const cloud: Row[] = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c-693a12d9.jpg" }];
    const next = mergeGarments({ local, cloud, lastCloudIds: ["a"], base });
    assert.equal(next[0]?.cutoutSrc, "");
    assert.equal(next[0]?.imageSrc, "sb:u/a/o.jpg");
    assert.equal(next[0]?.reprint, true);
    assert.notEqual(next[0]?.imageSrc, "sb:u/a/c-693a12d9.jpg");
  });

  it("keeps a new local plate and does not copy it onto the original", () => {
    const base = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c-693a12d9.jpg" }];
    const local = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c-aabbccdd.jpg", reprint: false }];
    const cloud = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c-693a12d9.jpg" }];
    const next = mergeGarments({ local, cloud, lastCloudIds: ["a"], base });
    assert.equal(next[0]?.cutoutSrc, "sb:u/a/c-aabbccdd.jpg");
    assert.equal(next[0]?.imageSrc, "sb:u/a/o.jpg");
  });

  it("a changed cloud cutout wins over an emptied local plate", () => {
    const base = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c-old.jpg" }];
    const local = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "", reprint: true }];
    const cloud = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c-new.jpg" }];
    const next = mergeGarments({ local, cloud, lastCloudIds: ["a"], base });
    assert.equal(next[0]?.cutoutSrc, "sb:u/a/c-new.jpg");
    assert.equal(next[0]?.imageSrc, "sb:u/a/o.jpg");
  });

  it("cloud cutout wins when the cloud cover changed", () => {
    const base = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c.jpg" }];
    const local = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "idb:a:c" }];
    const cloud = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c-abc12345.jpg" }];
    const next = mergeGarments({ local, cloud, lastCloudIds: ["a"], base });
    assert.equal(next[0]?.cutoutSrc, "sb:u/a/c-abc12345.jpg");
    assert.equal(next[0]?.imageSrc, "sb:u/a/o.jpg");
  });

  it("closet_meta sb: srcs win over local idb: on the same id", () => {
    const local = [{ id: "a", imageSrc: "idb:a:o", cutoutSrc: "idb:a:c" }];
    const cloud = [{ id: "a", imageSrc: "sb:u/a/o.jpg", cutoutSrc: "sb:u/a/c.jpg" }];
    const next = mergeGarments({ local, cloud, lastCloudIds: ["a"] });
    assert.equal(next[0]?.imageSrc, "sb:u/a/o.jpg");
    assert.equal(next[0]?.cutoutSrc, "sb:u/a/c.jpg");
  });

  it("tombstone blocks g_x even when lastCloudIds is null", () => {
    const local = [g("keep"), g("new-on-phone")];
    const cloud = [g("keep"), g("g_x")];
    const next = mergeGarments({
      local,
      cloud,
      lastCloudIds: null,
      tombstones: ["g_x"],
    });
    assert.deepEqual(next.map((x) => x.id).sort(), ["keep", "new-on-phone"]);
  });

  it("a missing cloud id is not a delete; only a tombstone drops it", () => {
    const local = [g("keep"), g("gone"), g("new-on-phone")];
    const cloud = [g("keep")];
    const kept = mergeGarments({
      local,
      cloud,
      lastCloudIds: ["keep", "gone"],
    });
    assert.deepEqual(kept.map((x) => x.id).sort(), ["gone", "keep", "new-on-phone"]);
    const dropped = mergeGarments({
      local,
      cloud,
      lastCloudIds: ["keep", "gone"],
      tombstones: ["gone"],
    });
    assert.deepEqual(dropped.map((x) => x.id).sort(), ["keep", "new-on-phone"]);
  });

  it("concurrent edits to different garments both survive", () => {
    const base = [
      { id: "g1", name: "one" },
      { id: "g2", name: "two" },
    ];
    const local = [
      { id: "g1", name: "one" },
      { id: "g2", name: "beta" },
    ];
    const cloud = [
      { id: "g1", name: "alpha" },
      { id: "g2", name: "two" },
    ];
    const next = mergeGarments({ local, cloud, lastCloudIds: ["g1", "g2"], base });
    assert.equal(next.find((g) => g.id === "g1")?.name, "alpha");
    assert.equal(next.find((g) => g.id === "g2")?.name, "beta");
  });
});

describe("mergeAccount", () => {
  it(`fake user ${FAKE_USER}: empty cloud does not wipe 145`, () => {
    const local = meta(Array.from({ length: 145 }, (_, i) => `g${i}`));
    const result = mergeAccount({
      local,
      cloud: meta([]),
      lastCloudIds: null,
    });
    assert.equal(result.action, "push");
    assert.equal(result.appliedCloud, false);
    assert.equal(result.next.garments.length, 145);
  });

  it("null cloud (never linked) with local pieces is a push, local kept", () => {
    const local = meta(["a", "b"]);
    const result = mergeAccount({ local, cloud: null, lastCloudIds: null });
    assert.equal(result.action, "push");
    assert.equal(result.next.garments.length, 2);
  });

  it("empty phone pulls the account rack", () => {
    const result = mergeAccount({
      local: meta([]),
      cloud: meta(["a", "b", "c"]),
      lastCloudIds: null,
    });
    assert.equal(result.action, "pull");
    assert.equal(result.appliedCloud, true);
    assert.equal(result.next.garments.length, 3);
  });

  it("both sides union by id and keep looks that still resolve", () => {
    const local = meta(["a"], {
      looks: [{ id: "look-a", garmentIds: ["a", "missing"] }],
    });
    const cloud = meta(["b"], {
      looks: [{ id: "look-b", garmentIds: ["b", "a"] }],
    });
    const result = mergeAccount({ local, cloud, lastCloudIds: null });
    assert.equal(result.action, "union");
    assert.equal(result.next.garments.length, 2);
    assert.ok(result.next.looks.some((l) => l.id === "look-b"));
    const short = result.next.looks.find((l) => l.id === "look-a");
    assert.equal(short?.broken, true);
    assert.deepEqual(short?.garmentIds, ["a"]);
  });

  it("tombstone drops g_x and a look that falls under 2 pieces; looks do not grow", () => {
    const local = meta(["keep", "other"], {
      looks: [
        { id: "stay", garmentIds: ["keep", "other"] },
        { id: "die", garmentIds: ["g_x", "keep"] },
      ],
    });
    const cloud = meta(["keep", "other", "g_x"], {
      looks: [
        { id: "stay", garmentIds: ["keep", "other"] },
        { id: "die", garmentIds: ["g_x"] },
        { id: "cloud-extra", garmentIds: ["g_x", "other"] },
      ],
    });
    const before = local.looks.length;
    const result = mergeAccount({
      local,
      cloud,
      lastCloudIds: null,
      tombstones: ["g_x"],
    });
    assert.ok(!result.next.garments.some((g) => g.id === "g_x"));
    assert.ok(result.next.looks.some((l) => l.id === "stay"));
    assert.ok(!result.next.looks.some((l) => l.garmentIds.includes("g_x")));
    assert.ok(result.next.looks.length <= before + 1);
    const die = result.next.looks.find((l) => l.id === "die");
    assert.equal(die?.broken, true);
    assert.ok(!die?.garmentIds.includes("g_x"));
  });

  it("source-less vetoes on the cloud side do not come back; a typed one is kept", () => {
    const local: CloudMeta = { ...meta(["a", "b"]), taste: emptyTaste() };
    const old: TasteVeto[] = [
      { kind: "pairing", a: "shirt", b: "loafer" },
      { kind: "pairing", a: "knit", b: "sneaker" },
      { kind: "piece", id: "a" },
    ];
    const cloud: CloudMeta = { ...meta(["a", "b"]), taste: { ...emptyTaste(), vetoes: old } };
    const merged = mergeAccount({ local, cloud, lastCloudIds: null });
    assert.equal(merged.next.taste?.vetoes.length ?? 0, 0);

    const typed: TasteVeto = { kind: "piece", id: "b", source: "ask" };
    const cloudTyped: CloudMeta = { ...meta(["a", "b"]), taste: { ...emptyTaste(), vetoes: [...old, typed] } };
    const mergedTyped = mergeAccount({ local, cloud: cloudTyped, lastCloudIds: null });
    assert.deepEqual(mergedTyped.next.taste?.vetoes, [typed]);
  });
});

describe("mergeDrop", () => {
  const allowed = new Set(["a", "b", "c", "d"]);
  const drop = (date: string, garmentIds: string[], extra: { setAt?: string; occasion?: string } = {}) => ({
    date,
    garmentIds,
    ...extra,
  });

  it("the later date wins, whichever side holds it", () => {
    const old = drop("2026-10-07", ["a", "b"]);
    const fresh = drop("2026-10-08", ["c", "d"]);
    assert.deepEqual(mergeDrop(old, fresh, allowed), fresh);
    assert.deepEqual(mergeDrop(fresh, old, allowed), fresh);
  });

  it("same date: the newer setAt wins, setAt beats none, and with neither local stays", () => {
    const earlier = drop("2026-10-08", ["a", "b"], { setAt: "2026-10-08T09:00:00.000Z" });
    const later = drop("2026-10-08", ["c", "d"], { setAt: "2026-10-08T10:00:00.000Z" });
    const unstamped = drop("2026-10-08", ["c", "d"]);
    assert.deepEqual(mergeDrop(earlier, later, allowed), later);
    assert.deepEqual(mergeDrop(later, earlier, allowed), later);
    assert.deepEqual(mergeDrop(unstamped, earlier, allowed), earlier);
    assert.deepEqual(mergeDrop(earlier, unstamped, allowed), earlier);
    const local = drop("2026-10-08", ["a", "b"]);
    assert.deepEqual(mergeDrop(local, unstamped, allowed), local);
  });

  it("a side with fewer than two allowed pieces never nulls a sound drop", () => {
    const sound = drop("2026-10-08", ["a", "b"]);
    assert.deepEqual(mergeDrop(drop("2026-10-08", ["a"]), sound, allowed), sound);
    assert.deepEqual(mergeDrop(sound, drop("2026-10-08", ["zzz", "b"]), allowed), sound);
    assert.deepEqual(mergeDrop(null, sound, allowed), sound);
    assert.deepEqual(mergeDrop(sound, null, allowed), sound);
    assert.equal(mergeDrop(drop("2026-10-09", ["a"]), drop("2026-10-08", ["zzz"]), allowed), null);
    assert.equal(mergeDrop(null, null, allowed), null);
  });

  it("a skipped out drop with setAt survives a same-date weekday cloud drop without one", () => {
    const local = drop("2026-10-08", ["a", "b"], { occasion: "out", setAt: "2026-10-08T12:00:00.000Z" });
    const cloud = drop("2026-10-08", ["c", "d"], { occasion: "weekday" });
    const merged = mergeDrop(local, cloud, allowed);
    assert.equal(merged?.occasion, "out");
    assert.deepEqual(merged?.garmentIds, ["a", "b"]);
  });
});
