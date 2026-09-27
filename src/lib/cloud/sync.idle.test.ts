import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

register(new URL("../../../scripts/ts-ext.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { setSupabaseForTests } = await import("./client.ts");
const { peekPendingEdit } = await import("./edit.ts");
const { startCloudSync } = await import("./sync.ts");
const { useCloset } = await import("../store.ts");

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

describe("startCloudSync idle", () => {
  it("focus, visibility, and online do not write, and a refused push does not retry", async () => {
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
});
