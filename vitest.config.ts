import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/lib/stylist/**/*.test.ts", "src/lib/house-profiles/**/*.test.ts"],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
});
