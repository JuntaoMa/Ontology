import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    exclude: ["node_modules/**", "dist-web/**", "dist-server/**"],
  },
});
