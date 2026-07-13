import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// dev 模式下 /api 代理目标：用 VITE_API_TARGET 覆盖后端端口，例如
//   VITE_API_TARGET=http://localhost:8008 pnpm dev:validation
// 注意：生产用法是 `pnpm build:validation` 后由后端同源托管 dist，无需代理。
const API_TARGET = process.env.VITE_API_TARGET || "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": API_TARGET } },
});
