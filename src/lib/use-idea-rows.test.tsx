import "./sheet-test-dom.ts";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { hostElement } from "./sheet-test-dom.ts";
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

let calls = 0;

function Probe({
  ready,
  occasion,
  salt,
  weekIds,
  garments,
}: {
  ready: boolean;
  occasion: string;
  salt: number;
  weekIds: string[];
  garments: string[];
}) {
  const rows = useIdeaRows({
    ready,
    inputs: [garments, occasion],
    deps: [salt, weekIds],
    build: () => {
      calls += 1;
      return { ways: ["way"], shown: ["row"] };
    },
  });
  return createElement("p", null, rows.ready ? "ready" : "pending");
}

describe("idea rows once per open", () => {
  it("builds once when the ranked row lands, and once more for a re-dress", async () => {
    calls = 0;
    const garments = ["g1", "g2"];
    const weekIds = ["g1"];
    const host = hostElement();
    const root = createRoot(host as unknown as Element);

    await act(async () => {
      root.render(createElement(Probe, { ready: false, occasion: "weekday", salt: 0, weekIds, garments }));
    });
    const mounted = calls;
    expect(host.textContent).toBe("pending");
    expect(mounted).toBe(0);

    await act(async () => {
      root.render(createElement(Probe, { ready: true, occasion: "weekday", salt: 0, weekIds, garments }));
    });
    const ranked = calls;
    expect(host.textContent).toBe("ready");
    expect(ranked).toBe(1);

    // New inputs and deps arrays, same piece references: the render after an unchanged merge.
    await act(async () => {
      root.render(createElement(Probe, { ready: true, occasion: "weekday", salt: 0, weekIds, garments }));
    });
    const equalArrays = calls;
    expect(equalArrays).toBe(1);

    await act(async () => {
      root.render(createElement(Probe, { ready: true, occasion: "weekend", salt: 0, weekIds, garments }));
    });
    const occasion = calls;
    expect(occasion).toBe(2);

    await act(async () => {
      root.render(
        createElement(Probe, { ready: true, occasion: "weekend", salt: 1, weekIds: ["g2"], garments }),
      );
    });
    const redress = calls;
    expect(redress).toBe(3);
    console.log("once-per-open", JSON.stringify({ mounted, ranked, equalArrays, occasion, redress }));
    root.unmount();
  });
});
