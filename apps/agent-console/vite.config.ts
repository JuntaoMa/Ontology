import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8")
) as { version: string };

export default defineConfig({
  plugins: [vue()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    strictPort: true,
    proxy: {
      "/health": "http://127.0.0.1:4310",
      "/profiles": "http://127.0.0.1:4310",
      "/datasets": "http://127.0.0.1:4310",
      "/runtimes": {
        target: "http://127.0.0.1:4310",
        ws: true,
      },
    },
  },
  clearScreen: false,
});
