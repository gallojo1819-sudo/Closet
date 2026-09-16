import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accountPool,
  decideLink,
  mergeAccount,
  mergeGarments,
  shouldApplyCloud,
  unionById,
  type CloudMeta,
} from "./merge.ts";

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
  it("drops demo and archived, never ships sample as the account rack", () => {
    const pool = accountPool([g("real"), g("sample", { demo: true }), g("old", { archived: true })]);
    assert.deepEqual(
      pool.map((x) => x.id),
      ["real"],
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

  it("after first link, a cloud delete drops that id; unpushed local adds stay", () => {
    const local = [g("keep"), g("gone"), g("new-on-phone")];
    const cloud = [g("keep")];
    const next = mergeGarments({
      local,
      cloud,
      lastCloudIds: ["keep", "gone"],
    });
    assert.deepEqual(
      next.map((x) => x.id).sort(),
      ["keep", "new-on-phone"],
    );
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
    assert.ok(!result.next.looks.some((l) => l.id === "look-a"));
  });
});
