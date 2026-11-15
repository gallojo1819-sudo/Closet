/**
 * A throwing or rejecting week dress still resolves the page: ranked looks are
 * empty, the skeleton clears, and the idea rows build once.
 */
import "./sheet-test-dom.ts";
import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { hostElement } from "./sheet-test-dom.ts";
import { settleWeek } from "./rank-week.ts";
import { useIdeaRows } from "./use-idea-rows.ts";

const win = window as unknown as {
  requestIdleCallback: (cb: () => void, opts?: { timeout?: number }) => number;
  cancelIdleCallback: (id: number) => void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};
win.requestIdleCallback = (cb) => {
  cb();
  return 1;
};
win.cancelIdleCallback = () => {};
win.setTimeout = globalThis.setTimeout.bind(globalThis);
win.clearTimeout = globalThis.clearTimeout.bind(globalThis);

let builds = 0;

function Page({ dress }: { dress: () => string[] | Promise<string[]> }) {
  const [ranked, setRanked] = useState<{ key: string; looks: string[] } | null>(null);
  useEffect(() => {
    let cancel = false;
    const timer = window.setTimeout(() => {
      void settleWeek(dress).then((next) => {
        if (!cancel) setRanked({ key: "week", looks: next ?? [] });
      });
    }, 0);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [dress]);
  const ready = ranked?.key === "week";
  const idea = useIdeaRows({
    ready,
    inputs: ["closet"],
    deps: [ranked?.looks.join(",") ?? ""],
    build: () => {
      builds += 1;
      return { ways: ["way"], shown: ["row"] };
    },
  });
  const skeleton = !idea.ready;
  return createElement("p", null, skeleton ? "Finding your looks…" : `ready:${ranked?.looks.length ?? -1}`);
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("week dress failures", () => {
  it("a throw resolves an empty ranked row and builds idea rows once", async () => {
    builds = 0;
    const host = hostElement();
    const root = createRoot(host as unknown as Element);
    const dress = () => {
      throw new Error("dress failed");
    };
    await act(async () => {
      root.render(createElement(Page, { dress }));
    });
    await flush();
    expect(host.textContent).toBe("ready:0");
    expect(builds).toBe(1);
    await act(async () => {
      root.render(createElement(Page, { dress }));
    });
    await flush();
    expect(builds).toBe(1);
  });

  it("a rejection resolves an empty ranked row and does not build again", async () => {
    builds = 0;
    const host = hostElement();
    const root = createRoot(host as unknown as Element);
    const dress = () => Promise.reject(new Error("dress rejected"));
    await act(async () => {
      root.render(createElement(Page, { dress }));
    });
    await flush();
    expect(host.textContent).toBe("ready:0");
    expect(builds).toBe(1);
  });
});
