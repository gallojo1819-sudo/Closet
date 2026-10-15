import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/lib/stylist/**/*.test.ts", "src/lib/house-profiles/**/*.test.ts", "src/lib/rotation.test.ts", "src/lib/redress-fill.test.ts", "src/lib/redress-live.test.ts", "src/lib/redress-rowdupe.test.ts", "src/lib/lookbook-header-count.test.tsx", "src/lib/stylist-notes/**/*.test.ts", "src/lib/snapshot-live.test.ts", "src/lib/today-pin.test.ts", "src/lib/stylist-today.test.ts", "src/lib/stylist-session.test.ts","src/lib/piece-label.test.ts", "src/lib/lookbook-crossrow.test.ts", "src/lib/photo-source.test.tsx"],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
});
