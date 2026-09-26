import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  freshMemory,
  markDirty,
  mergeForSync,
  packCloud,
  pushIfDirty,
  rememberPull,
  rowToCloud,
  shouldSchedulePush,
  type FetchCloud,
  type SyncMemory,
  type WriteResult,
} from "./commit.ts";
import { planStoragePuts } from "./guard.ts";
import type { CloudGarment, CloudLook, CloudMeta } from "./merge.ts";

/** Fake user — these tests never read or write closet.v6 or production. */
void "fake-user-joe";

const MINUTE = 60_000;

function garment(id: string, name = id): CloudGarment {
  return {
    id,
    name,
    archived: false,
    demo: false,
    imageSrc: `sb:u/${id}/o.jpg`,
    cutoutSrc: `sb:u/${id}/c.jpg`,
  };
}

function look(id: string, garmentIds: string[]): CloudLook {
  return { id, garmentIds };
}

function meta(garments: CloudGarment[], looks: CloudLook[] = []): CloudMeta {
  return {
    garments,
    looks,
    journal: [],
    avoid: {},
    drop: null,
    refPhoto: false,
    v: 6,
    deletedGarments: [],
    deletedLooks: [],
  };
}

function liveIds(cloud: CloudMeta | null): string[] {
  return (cloud?.garments ?? []).filter((g) => g.tombstone !== true && !g.archived).map((g) => g.id);
}

type Hub = {
  writes: () => number;
  puts: string[];
  cloud: () => CloudMeta | null;
  fetch: () => Promise<FetchCloud>;
  write: (
    expected: { rev: number | null; updatedAt: string | null },
    payload: CloudMeta,
  ) => Promise<WriteResult>;
};

function createHub(initial: CloudMeta): Hub {
  let rev = 1;
  let updatedAt = "2026-09-26T14:00:00.000Z";
  let packed = packCloud({ ...initial, deletedGarments: [], deletedLooks: [] });
  let writes = 0;
  const puts: string[] = [];
  const cloud = (): CloudMeta | null =>
    rowToCloud({
      garments: packed.garments,
      looks: packed.looks,
      journal: packed.journal,
      avoid: packed.avoid,
      drop: packed.drop,
      ref_photo: packed.refPhoto,
      v: 6,
      rev,
      updated_at: updatedAt,
      deleted_garments: packed.deletedGarments,
      deleted_looks: packed.deletedLooks,
    });
  return {
    writes: () => writes,
    puts,
    cloud,
    fetch: async () => ({ ok: true, cloud: cloud() }),
    write: async (expected, payload) => {
      const current = cloud();
      const live = liveIds(current);
      const nextLive = payload.garments.filter((g) => g.tombstone !== true && !g.archived);
      if (nextLive.length + 2 < live.length) {
        throw new Error(`shrink ${live.length} -> ${nextLive.length}`);
      }
      if (expected.rev !== rev) return { ok: false, conflict: true };
      rev += 1;
      writes += 1;
      updatedAt = `2026-09-26T14:00:${String(writes).padStart(2, "0")}.000Z`;
      packed = packCloud(payload);
      const paths = planStoragePuts({
        reason: "edit",
        userId: "u",
        garments: nextLive,
        existing: new Set(nextLive.flatMap((g) => ["o", "c", "t"].map((k) => `u/${g.id}/${k}.jpg`))),
      });
      puts.push(...paths);
      return { ok: true, rev, updatedAt };
    },
  };
}

function createClient(hub: Hub, initial: CloudMeta) {
  let mem: SyncMemory = freshMemory();
  let local = initial;
  let deletedGarments: string[] = [];
  let deletedLooks: string[] = [];
  let now = 0;
  const queue: { at: number; run: () => Promise<unknown> }[] = [];

  function considerSchedule() {
    if (!shouldSchedulePush(mem)) return;
    queue.push({ at: now + 1000, run: () => flush() });
  }

  async function flush() {
    const result = await pushIfDirty({
      mem,
      local,
      tombstones: { garments: deletedGarments, looks: deletedLooks },
      fetchCloud: () => hub.fetch(),
      write: (expected, payload) => hub.write(expected, payload),
      log: () => {},
    });
    mem = result.mem;
    if (result.merged) {
      local = {
        ...result.merged,
        garments: result.merged.garments.filter((g) => g.tombstone !== true),
        looks: result.merged.looks.filter((l) => l.tombstone !== true),
      };
      deletedGarments = [];
      deletedLooks = [];
    }
    return result;
  }

  return {
    local: () => local,
    memory: () => mem,
    async open() {
      const fetched = await hub.fetch();
      if (!fetched.ok) return;
      const merged = mergeForSync({
        local,
        cloud: fetched.cloud,
        tombstones: { garments: deletedGarments, looks: deletedLooks },
        base: mem.base,
      });
      mem = rememberPull(mem, fetched.cloud, merged);
      local = {
        ...merged,
        garments: merged.garments.filter((g) => g.tombstone !== true),
        looks: merged.looks.filter((l) => l.tombstone !== true),
      };
      considerSchedule();
    },
    focus() {
      considerSchedule();
    },
    reroll() {
      const ids = local.garments.slice(0, 2).map((g) => g.id);
      local = { ...local, drop: { date: "2026-09-26", garmentIds: ids } };
      considerSchedule();
    },
    editGarment(id: string, name: string) {
      local = {
        ...local,
        garments: local.garments.map((g) => (g.id === id ? { ...g, name } : g)),
      };
      mem = markDirty(mem);
      considerSchedule();
    },
    deleteGarment(id: string) {
      deletedGarments = [...new Set([...deletedGarments, id])];
      local = {
        ...local,
        garments: local.garments.filter((g) => g.id !== id),
        looks: local.looks
          .map((l) => ({ ...l, garmentIds: l.garmentIds.filter((gid) => gid !== id) }))
          .filter((l) => l.garmentIds.length >= 2),
      };
      mem = markDirty(mem);
      considerSchedule();
    },
    /** A buggy render dropped rows. Not a user delete. */
    loseWithoutDeleting(garmentIds: string[], lookIds: string[]) {
      const dropG = new Set(garmentIds);
      const dropL = new Set(lookIds);
      local = {
        ...local,
        garments: local.garments.filter((g) => !dropG.has(g.id)),
        looks: local.looks.filter((l) => !dropL.has(l.id)),
      };
      mem = markDirty(mem);
      considerSchedule();
    },
    async advance(ms: number) {
      now += ms;
      const due = queue.filter((job) => job.at <= now);
      for (const job of due) {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        await job.run();
      }
    },
    flush,
  };
}

describe("pushIfDirty", () => {
  it("a fresh client does not push before it has pulled", async () => {
    let writes = 0;
    const result = await pushIfDirty({
      mem: markDirty(freshMemory()),
      local: meta([garment("a"), garment("b")]),
      tombstones: { garments: [], looks: [] },
      fetchCloud: async () => ({ ok: true, cloud: meta([garment("a"), garment("cloud")]) }),
      write: async () => {
        writes += 1;
        return { ok: true, rev: 1, updatedAt: "t" };
      },
    });
    assert.equal(result.wrote, false);
    assert.equal(writes, 0);
    assert.equal(shouldSchedulePush(freshMemory()), false);
    assert.equal(shouldSchedulePush(markDirty(freshMemory())), false);
  });
});

describe("two clients", () => {
  const garments = ["g_keep", "g_x", "g1", "g2", "g3", "g4", "g5"].map((id) => garment(id));
  const looks = Array.from({ length: 20 }, (_, i) =>
    look(`l${i}`, [garments[i % garments.length]!.id, garments[(i + 1) % garments.length]!.id, garments[(i + 2) % garments.length]!.id]),
  );
  const seed = meta(garments, looks);

  it("idle clients do not write for 10 simulated minutes", async () => {
    const hub = createHub(seed);
    const a = createClient(hub, seed);
    const b = createClient(hub, seed);
    await a.open();
    await b.open();
    a.focus();
    b.focus();
    a.reroll();
    b.reroll();
    for (let minute = 0; minute < 10; minute++) await a.advance(MINUTE);
    await b.advance(10 * MINUTE);
    assert.equal(hub.writes(), 0);
    assert.deepEqual(hub.puts, []);
    assert.equal(liveIds(hub.cloud()).length, garments.length);
    assert.equal(hub.cloud()?.looks.length, looks.length);
  });

  it("a delete on A stays deleted when B edits and saves", async () => {
    const hub = createHub(seed);
    const a = createClient(hub, seed);
    const b = createClient(hub, seed);
    await a.open();
    await b.open();
    a.deleteGarment("g_x");
    await a.advance(1000);
    assert.equal(hub.cloud()?.deletedGarments?.includes("g_x"), true);
    assert.equal(liveIds(hub.cloud()).includes("g_x"), false);
    b.editGarment("g_keep", "Kept");
    await b.advance(1000);
    const cloud = hub.cloud();
    assert.equal(liveIds(cloud).includes("g_x"), false);
    assert.equal(cloud?.deletedGarments?.includes("g_x"), true);
    assert.equal(cloud?.garments.find((g) => g.id === "g_keep")?.name, "Kept");
    assert.equal(b.local().garments.some((g) => g.id === "g_x"), false);
  });

  it("concurrent edits to different garments both survive a conflict", async () => {
    const hub = createHub(seed);
    const a = createClient(hub, seed);
    const b = createClient(hub, seed);
    await a.open();
    await b.open();
    a.editGarment("g1", "Alpha");
    b.editGarment("g2", "Beta");
    await a.advance(1000);
    await b.advance(1000);
    const cloud = hub.cloud();
    assert.equal(cloud?.garments.find((g) => g.id === "g1")?.name, "Alpha");
    assert.equal(cloud?.garments.find((g) => g.id === "g2")?.name, "Beta");
    assert.equal(liveIds(cloud).length, garments.length);
  });

  it("a stale client cannot shrink garments or looks", async () => {
    const hub = createHub(seed);
    const stale = createClient(hub, meta(garments.slice(0, 4), looks.slice(0, 5)));
    await stale.open();
    assert.equal(stale.local().garments.length, garments.length);
    assert.equal(stale.local().looks.length, looks.length);
    assert.equal(hub.writes(), 0);
    const dropGarments = garments.slice(0, 3).map((g) => g.id);
    const dropLooks = looks.slice(0, 15).map((l) => l.id);
    stale.loseWithoutDeleting(dropGarments, dropLooks);
    stale.editGarment("g5", "Touched");
    await stale.advance(1000);
    const cloud = hub.cloud();
    assert.equal(liveIds(cloud).length, garments.length);
    assert.equal(cloud?.looks.length, looks.length);
    assert.ok(dropGarments.every((id) => liveIds(cloud).includes(id)));
    assert.ok(dropLooks.every((id) => cloud?.looks.some((l) => l.id === id)));
    assert.equal(cloud?.garments.find((g) => g.id === "g5")?.name, "Touched");
    assert.deepEqual(hub.puts, []);
  });
});

describe("conflict retry", () => {
  it("a stale rev is retried and both garment edits remain", async () => {
    const base = meta([garment("g1", "one"), garment("g2", "two")]);
    base.rev = 1;
    base.updatedAt = "t1";
    let server = meta([
      garment("g1", "Alpha"),
      garment("g2", "two"),
    ]);
    server.rev = 2;
    server.updatedAt = "t2";
    let mem = rememberPull(freshMemory(), base, base);
    mem = markDirty(mem);
    const local = {
      ...base,
      garments: base.garments.map((g) => (g.id === "g2" ? { ...g, name: "Beta" } : g)),
    };
    let fetches = 0;
    let writes = 0;
    const result = await pushIfDirty({
      mem,
      local,
      tombstones: { garments: [], looks: [] },
      fetchCloud: async () => {
        fetches += 1;
        if (fetches === 1) return { ok: true, cloud: { ...base, rev: 1, updatedAt: "t1" } };
        return { ok: true, cloud: server };
      },
      write: async (expected, payload) => {
        writes += 1;
        if (expected.rev === 1) return { ok: false, conflict: true };
        const stored = rowToCloud({
          garments: payload.garments,
          looks: payload.looks,
          journal: payload.journal,
          avoid: payload.avoid,
          drop: payload.drop,
          ref_photo: payload.refPhoto,
          v: 6,
          rev: 3,
          updated_at: "t3",
          deleted_garments: payload.deletedGarments,
          deleted_looks: payload.deletedLooks,
        });
        server = stored ?? server;
        return { ok: true, rev: 3, updatedAt: "t3" };
      },
    });
    assert.equal(result.wrote, true);
    assert.equal(writes, 2);
    assert.equal(server.garments.find((g) => g.id === "g1")?.name, "Alpha");
    assert.equal(server.garments.find((g) => g.id === "g2")?.name, "Beta");
  });
});

describe("tombstone round trip", () => {
  it("embeds a delete in jsonb and reads it back", () => {
    const packed = packCloud({
      ...meta([garment("keep")], [look("stay", ["keep", "other"])]),
      deletedGarments: ["g_x"],
      deletedLooks: ["gone-look"],
    });
    const cloud = rowToCloud({
      garments: packed.garments,
      looks: packed.looks,
      journal: packed.journal,
      avoid: packed.avoid,
      drop: packed.drop,
      ref_photo: false,
      v: 6,
      deleted_garments: packed.deletedGarments,
      deleted_looks: packed.deletedLooks,
    });
    assert.equal(cloud?.garments.some((g) => g.id === "g_x"), false);
    assert.equal(cloud?.deletedGarments?.includes("g_x"), true);
    assert.equal(cloud?.deletedLooks?.includes("gone-look"), true);
    assert.equal(packed.garments.some((g) => g.id === "g_x" && g.tombstone === true), true);
  });
});
