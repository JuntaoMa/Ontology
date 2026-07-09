import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/@antv/") || id.includes("/bubblesets-js/")) return "antv-g6";
          return "vendor";
        },
      },
    },
  },
});
