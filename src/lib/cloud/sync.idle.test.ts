import { readFileSync } from "node:fs";
import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

register(new URL("../../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { setSupabaseForTests } = await import("./client.ts");
const { peekPendingEdit } = await import("./edit.ts");
const { resetCloudSyncForTests, startCloudSync } = await import("./sync.ts");
const { getAccount, patchAccount, setAccountProgress } = await import("./account.ts");
const { isSavedAccountCopy } = await import("./copy.ts");
const { useCloset } = await import("../store.ts");

let online = true;

function setOnline(value: boolean) {
  online = value;
  const current = globalThis.navigator as { __closetOnline?: boolean };
  if (current?.__closetOnline) return;
  const fake = new Proxy(globalThis.navigator, {
    get(target, prop, receiver) {
      if (prop === "onLine") return online;
      if (prop === "__closetOnline") return true;
      const got = Reflect.get(target, prop, receiver);
      return typeof got === "function" ? got.bind(target) : got;
    },
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: fake });
}

/** Fake user — this drives the real sync module. It does not touch closet.v6 or production. */
void "fake-user-joe";

type Calls = { rpc: number; update: number; upload: number };

function installDom() {
  const win = new Map<string, Set<(ev?: unknown) => void>>();
  const doc = new Map<string, Set<(ev?: unknown) => void>>();
  const add = (map: typeof win, type: string, fn: (ev?: unknown) => void) => {
    const set = map.get(type) ?? new Set();
    set.add(fn);
    map.set(type, set);
  };
  const remove = (map: typeof win, type: string, fn: (ev?: unknown) => void) => {
    map.get(type)?.delete(fn);
  };
  const fire = (map: typeof win, type: string) => {
    for (const fn of map.get(type) ?? []) fn();
  };
  const windowFake = {
    addEventListener: (type: string, fn: (ev?: unknown) => void) => add(win, type, fn),
    removeEventListener: (type: string, fn: (ev?: unknown) => void) => remove(win, type, fn),
    dispatch: (type: string) => fire(win, type),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    location: { origin: "https://preview.example", pathname: "/", search: "" },
  };
  const documentFake = {
    visibilityState: "visible",
    addEventListener: (type: string, fn: (ev?: unknown) => void) => add(doc, type, fn),
    removeEventListener: (type: string, fn: (ev?: unknown) => void) => remove(doc, type, fn),
    dispatch: (type: string) => fire(doc, type),
  };
  Object.defineProperty(globalThis, "window", { value: windowFake, configurable: true });
  Object.defineProperty(globalThis, "document", { value: documentFake, configurable: true });
  return { windowFake, documentFake };
}

function cloudRow() {
  return {
    garments: [
      {
        id: "g1",
        name: "Navy oxford",
        archived: false,
        demo: false,
        imageSrc: "sb:u/g1/o.jpg",
        cutoutSrc: "sb:u/g1/c.jpg",
        colors: ["navy"],
        category: "top",
        subtype: "oxford",
      },
    ],
    looks: [{ id: "l1", garmentIds: ["g1", "g2"], name: "Office" }],
    journal: [],
    avoid: {},
    drop: null,
    ref_photo: false,
    v: 6,
    rev: 4,
    updated_at: "2026-09-26T14:00:00.000Z",
    deleted_garments: [],
    deleted_looks: [],
  };
}

function fakeSupabase(calls: Calls) {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    maybeSingle: async () => ({ data: cloudRow(), error: null }),
    insert() {
      calls.update += 1;
      return chain;
    },
    update() {
      calls.update += 1;
      return chain;
    },
  };
  return {
    auth: {
      onAuthStateChange(cb: (event: string, session: unknown) => void) {
        queueMicrotask(() =>
          cb("INITIAL_SESSION", {
            user: { id: "5d458205-b3ca-433a-8b75-4c0a2bbfa1ee", email: "joe@prereal.com" },
          }),
        );
        return { data: { subscription: { unsubscribe() {} } } };
      },
      startAutoRefresh: async () => {},
      stopAutoRefresh: async () => {},
      getSession: async () => ({ data: { session: { user: { id: "u" } } } }),
    },
    from() {
      return chain;
    },
    rpc() {
      calls.rpc += 1;
      return Promise.resolve({
        data: null,
        error: { code: "42501", message: "permission denied for function closet_meta_push" },
      });
    },
    storage: {
      from() {
        return {
          list: async () => ({ data: [], error: null }),
          upload: async () => {
            calls.upload += 1;
            return { error: null };
          },
          remove: async () => ({ error: null }),
          download: async () => ({ data: null, error: null }),
        };
      },
    },
  };
}

function oxford(name: string) {
  return {
    id: "g1",
    name,
    category: "top",
    subtype: "oxford",
    colors: ["navy"],
    archived: false,
    demo: false,
    imageSrc: "sb:u/g1/o.jpg",
    cutoutSrc: "sb:u/g1/c.jpg",
  } as never;
}

function nameOf(rows: { id: string; name?: string }[] | undefined): string | undefined {
  return rows?.find((g) => g.id === "g1")?.name;
}

async function waitUntil(pred: () => boolean, label: string) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 3000) throw new Error(label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("startCloudSync idle", () => {
  it("focus, visibility, and online do not write, and a refused push does not retry", async () => {
    resetCloudSyncForTests();
    setOnline(true);
    installDom();
    const calls: Calls = { rpc: 0, update: 0, upload: 0 };
    setSupabaseForTests(fakeSupabase(calls) as never);
    useCloset.setState({
      garments: [
        {
          id: "g1",
          name: "Stale oxford",
          category: "top",
          subtype: "oxford",
          colors: ["navy"],
          archived: false,
          demo: false,
          imageSrc: "sb:u/g1/o.jpg",
          cutoutSrc: "sb:u/g1/c.jpg",
        } as never,
      ],
      looks: [],
    });
    const stop = startCloudSync();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const win = globalThis.window as unknown as { dispatch: (type: string) => void };
    const doc = globalThis.document as unknown as { dispatch: (type: string) => void };
    win.dispatch("focus");
    doc.dispatch("visibilitychange");
    win.dispatch("online");
    win.dispatch("pageshow");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls.rpc, 0);
    assert.equal(calls.update, 0);
    assert.equal(calls.upload, 0);

    useCloset.getState().updateGarment("g1", { name: "Edited" });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const rpcAfterEdit = calls.rpc;
    assert.ok(rpcAfterEdit >= 1);
    assert.equal(peekPendingEdit(), false);

    win.dispatch("focus");
    doc.dispatch("visibilitychange");
    win.dispatch("online");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(calls.rpc, rpcAfterEdit);
    assert.equal(calls.update, 0);
    assert.equal(calls.upload, 0);
    stop();
    setSupabaseForTests(null);
  });

  it("an edit during a slow push stays in the store and is pushed", async () => {
    resetCloudSyncForTests();
    setAccountProgress(null);
    setOnline(true);
    installDom();
    const calls: Calls = { rpc: 0, update: 0, upload: 0 };
    const payloads: { id: string; name?: string }[][] = [];
    let release: () => void = () => {};
    let row = cloudRow();
    const chain = {
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      maybeSingle: async () => ({ data: row, error: null }),
      insert() {
        calls.update += 1;
        return chain;
      },
      update() {
        calls.update += 1;
        return chain;
      },
    };
    setSupabaseForTests({
      auth: {
        onAuthStateChange(cb: (event: string, session: unknown) => void) {
          queueMicrotask(() =>
            cb("INITIAL_SESSION", {
              user: { id: "5d458205-b3ca-433a-8b75-4c0a2bbfa1ee", email: "joe@prereal.com" },
            }),
          );
          return { data: { subscription: { unsubscribe() {} } } };
        },
        startAutoRefresh: async () => {},
        stopAutoRefresh: async () => {},
        getSession: async () => ({ data: { session: { user: { id: "u" } } } }),
      },
      from() {
        return chain;
      },
      rpc(_name: string, args: { p_garments: { id: string; name?: string }[] }) {
        calls.rpc += 1;
        const finish = () => {
          const nextRev = Number(row.rev) + 1;
          row = {
            ...row,
            garments: args.p_garments as typeof row.garments,
            rev: nextRev,
            updated_at: `2026-09-26T14:00:${String(nextRev).padStart(2, "0")}.000Z`,
          };
          payloads.push(args.p_garments);
          return {
            data: { ok: true, rev: nextRev, updated_at: row.updated_at },
            error: null,
          };
        };
        if (calls.rpc === 1) {
          return new Promise((resolve) => {
            release = () => resolve(finish());
          });
        }
        return Promise.resolve(finish());
      },
      storage: {
        from() {
          return {
            list: async () => ({ data: [], error: null }),
            upload: async () => {
              calls.upload += 1;
              return { error: null };
            },
            remove: async () => ({ error: null }),
            download: async () => ({ data: null, error: null }),
          };
        },
      },
    } as never);
    useCloset.setState({ garments: [oxford("Stale oxford")], looks: [] });
    const stop = startCloudSync();
    try {
      await waitUntil(
        () => getAccount().progress === "1 pieces · Saved to your account",
        "pull did not finish",
      );
      useCloset.getState().updateGarment("g1", { name: "First" });
      await waitUntil(() => calls.rpc >= 1, "push did not start");
      useCloset.getState().updateGarment("g1", { name: "Second" });
      release();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(useCloset.getState().garments.find((g) => g.id === "g1")?.name, "Second");
      await waitUntil(() => calls.rpc >= 2, "second push did not start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(nameOf(payloads[0]), "First");
      assert.equal(nameOf(payloads[payloads.length - 1]), "Second");
      assert.equal(useCloset.getState().garments.find((g) => g.id === "g1")?.name, "Second");
      assert.equal(calls.update, 0);
      assert.equal(peekPendingEdit(), false);
    } finally {
      stop();
      setSupabaseForTests(null);
    }
  });

  it("an edit during a push does not revert another device's change", async () => {
    resetCloudSyncForTests();
    setAccountProgress(null);
    setOnline(true);
    installDom();
    const calls: Calls = { rpc: 0, update: 0, upload: 0 };
    const payloads: { id: string; name?: string }[][] = [];
    let release: () => void = () => {};
    const piece = (id: string, name: string) => ({
      id,
      name,
      createdAt: "2026-01-01T00:00:00.000Z",
      archived: false,
      demo: false,
      imageSrc: `sb:u/${id}/o.jpg`,
      cutoutSrc: `sb:u/${id}/c.jpg`,
      colors: ["navy"],
      category: "top",
      subtype: "oxford",
      wornOn: [] as string[],
    });
    let row = {
      ...cloudRow(),
      garments: [piece("g1", "Navy oxford"), piece("g2", "X"), piece("g3", "Old")],
    };
    const chain = {
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      maybeSingle: async () => ({ data: row, error: null }),
      insert() {
        calls.update += 1;
        return chain;
      },
      update() {
        calls.update += 1;
        return chain;
      },
    };
    setSupabaseForTests({
      auth: {
        onAuthStateChange(cb: (event: string, session: unknown) => void) {
          queueMicrotask(() =>
            cb("INITIAL_SESSION", {
              user: { id: "5d458205-b3ca-433a-8b75-4c0a2bbfa1ee", email: "joe@prereal.com" },
            }),
          );
          return { data: { subscription: { unsubscribe() {} } } };
        },
        startAutoRefresh: async () => {},
        stopAutoRefresh: async () => {},
        getSession: async () => ({ data: { session: { user: { id: "u" } } } }),
      },
      from() {
        return chain;
      },
      rpc(_name: string, args: { p_garments: { id: string; name?: string }[] }) {
        calls.rpc += 1;
        const finish = () => {
          const nextRev = Number(row.rev) + 1;
          row = {
            ...row,
            garments: args.p_garments as typeof row.garments,
            rev: nextRev,
            updated_at: `2026-09-26T14:00:${String(nextRev).padStart(2, "0")}.000Z`,
          };
          payloads.push(args.p_garments);
          return {
            data: { ok: true, rev: nextRev, updated_at: row.updated_at },
            error: null,
          };
        };
        if (calls.rpc === 1) {
          return new Promise((resolve) => {
            release = () => resolve(finish());
          });
        }
        return Promise.resolve(finish());
      },
      storage: {
        from() {
          return {
            list: async () => ({ data: [], error: null }),
            upload: async () => {
              calls.upload += 1;
              return { error: null };
            },
            remove: async () => ({ error: null }),
            download: async () => ({ data: null, error: null }),
          };
        },
      },
    } as never);
    useCloset.setState({
      garments: [piece("g1", "Navy oxford"), piece("g2", "X"), piece("g3", "Old")] as never,
      looks: [],
    });
    const stop = startCloudSync();
    try {
      await waitUntil(
        () => getAccount().progress === "3 pieces · Saved to your account",
        "pull did not finish",
      );
      row = {
        ...row,
        rev: 5,
        updated_at: "2026-09-26T14:05:00.000Z",
        garments: row.garments.map((g) => (g.id === "g2" ? { ...g, name: "Y" } : g)),
      };
      useCloset.getState().updateGarment("g1", { name: "Local" });
      await waitUntil(() => calls.rpc >= 1, "push did not start");
      useCloset.getState().updateGarment("g3", { name: "During" });
      release();
      await waitUntil(() => calls.rpc >= 2, "second push did not start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      const second = payloads[payloads.length - 1];
      assert.equal(second?.find((g) => g.id === "g2")?.name, "Y");
      assert.equal(second?.find((g) => g.id === "g3")?.name, "During");
      assert.equal(calls.update, 0);
    } finally {
      stop();
      setSupabaseForTests(null);
    }
  });

  it("an offline edit survives going back online and a focus pull", async () => {
    resetCloudSyncForTests();
    setOnline(true);
    installDom();
    const calls: Calls = { rpc: 0, update: 0, upload: 0 };
    let reads = 0;
    setSupabaseForTests({
      ...fakeSupabase(calls),
      from() {
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          maybeSingle: async () => {
            reads += 1;
            return { data: cloudRow(), error: null };
          },
          insert() {
            calls.update += 1;
            return chain;
          },
          update() {
            calls.update += 1;
            return chain;
          },
        };
        return chain;
      },
    } as never);
    useCloset.setState({ garments: [oxford("Stale oxford")], looks: [] });
    const stop = startCloudSync();
    try {
      await waitUntil(() => reads >= 1, "first pull did not run");
      setOnline(false);
      useCloset.getState().updateGarment("g1", { name: "Pocket" });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      assert.equal(calls.rpc, 0);
      assert.equal(calls.update, 0);
      const readsBefore = reads;
      setOnline(true);
      const win = globalThis.window as unknown as { dispatch: (type: string) => void };
      win.dispatch("online");
      win.dispatch("focus");
      await waitUntil(() => reads > readsBefore, "focus pull did not run");
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(useCloset.getState().garments.find((g) => g.id === "g1")?.name, "Pocket");
      assert.equal(calls.rpc, 0);
    } finally {
      stop();
      setOnline(true);
      setSupabaseForTests(null);
    }
  });

  it("a table update errcode 40001 is retried instead of aborting", async () => {
    resetCloudSyncForTests();
    setAccountProgress(null);
    setOnline(true);
    installDom();
    const calls: Calls = { rpc: 0, update: 0, upload: 0 };
    const bodies: { rev?: number }[] = [];
    let updates = 0;
    const chain = {
      select(cols?: string) {
        if (cols === "updated_at") {
          return Promise.resolve(
            updates === 1
              ? {
                  data: null,
                  error: {
                    code: "40001",
                    message: "closet_meta: stale write refused (rev must be 5, got 4)",
                  },
                }
              : { data: [{ updated_at: "2026-09-26T15:00:00.000Z" }], error: null },
          );
        }
        return chain;
      },
      eq() {
        return chain;
      },
      maybeSingle: async () => ({ data: cloudRow(), error: null }),
      insert() {
        calls.update += 1;
        return chain;
      },
      update(body: { rev?: number }) {
        updates += 1;
        calls.update += 1;
        bodies.push(body);
        return chain;
      },
    };
    setSupabaseForTests({
      auth: {
        onAuthStateChange(cb: (event: string, session: unknown) => void) {
          queueMicrotask(() =>
            cb("INITIAL_SESSION", {
              user: { id: "5d458205-b3ca-433a-8b75-4c0a2bbfa1ee", email: "joe@prereal.com" },
            }),
          );
          return { data: { subscription: { unsubscribe() {} } } };
        },
        startAutoRefresh: async () => {},
        stopAutoRefresh: async () => {},
        getSession: async () => ({ data: { session: { user: { id: "u" } } } }),
      },
      from() {
        return chain;
      },
      rpc() {
        calls.rpc += 1;
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST202",
            message: "Could not find the function public.closet_meta_push in the schema cache",
          },
        });
      },
      storage: {
        from() {
          return {
            list: async () => ({ data: [], error: null }),
            upload: async () => {
              calls.upload += 1;
              return { error: null };
            },
            remove: async () => ({ error: null }),
            download: async () => ({ data: null, error: null }),
          };
        },
      },
    } as never);
    useCloset.setState({ garments: [oxford("Stale oxford")], looks: [] });
    const stop = startCloudSync();
    try {
      await waitUntil(
        () => getAccount().progress === "1 pieces · Saved to your account",
        "pull did not finish",
      );
      useCloset.getState().updateGarment("g1", { name: "Kept" });
      await waitUntil(() => calls.update >= 2, "rev conflict was not retried");
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(bodies[0]?.rev, 5);
      assert.equal(bodies[1]?.rev, 5);
      assert.equal(useCloset.getState().garments.find((g) => g.id === "g1")?.name, "Kept");
      assert.equal(peekPendingEdit(), false);
      assert.equal(calls.rpc, 1);
    } finally {
      stop();
      setSupabaseForTests(null);
    }
  });

  it("a failed thumb count keeps its error, not the saved line", async () => {
    resetCloudSyncForTests();
    setAccountProgress(null);
    patchAccount({ localOnly: false });
    setOnline(true);
    installDom();
    const calls: Calls = { rpc: 0, update: 0, upload: 0 };
    let lists = 0;
    const base = fakeSupabase(calls);
    const pending = {
      ...cloudRow(),
      garments: cloudRow().garments.map((g) => ({
        ...g,
        imageSrc: "idb:g1:o",
        cutoutSrc: "idb:g1:c",
      })),
    };
    const chain = {
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      maybeSingle: async () => ({ data: pending, error: null }),
      insert() {
        calls.update += 1;
        return chain;
      },
      update() {
        calls.update += 1;
        return chain;
      },
    };
    setSupabaseForTests({
      ...base,
      from() {
        return chain;
      },
      storage: {
        from() {
          return {
            list: async () => {
              lists += 1;
              return { data: null, error: { statusCode: 403, message: "list refused" } };
            },
            upload: async () => {
              calls.upload += 1;
              return { error: null };
            },
            remove: async () => ({ error: null }),
            download: async () => ({ data: null, error: null }),
          };
        },
      },
    } as never);
    useCloset.setState({
      garments: [{ ...(oxford("Navy oxford") as object), imageSrc: "idb:g1:o", cutoutSrc: "idb:g1:c" }] as never,
      looks: [],
    });
    const stop = startCloudSync();
    try {
      await waitUntil(() => lists >= 1, "thumb count did not run");
      await waitUntil(() => getAccount().localOnly === true, "thumb failure not flagged");
      await new Promise((resolve) => setTimeout(resolve, 30));
      const progress = getAccount().progress ?? "";
      assert.equal(isSavedAccountCopy(progress), false);
      assert.equal(progress.includes("Saved to your account"), false);
      assert.equal(progress.includes("on this phone."), false);
      assert.equal(progress, "Backup failed · 403 list refused");
    } finally {
      stop();
      setSupabaseForTests(null);
      setAccountProgress(null);
      patchAccount({ localOnly: false });
    }
  });
});

describe("header saved copy", () => {
  it("app shell keeps the count-first saved line off the banner", () => {
    const shell = readFileSync(
      new URL("../../components/shell/app-shell.tsx", import.meta.url),
      "utf8",
    );
    assert.equal(shell.includes("isSavedAccountCopy(progress)"), true);
  });
});
