import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
  build: {
    rollupOptions: {
      input: {
        about: path.resolve(__dirname, "about.html"),
        import: path.resolve(__dirname, "index.html"),
        ontology: path.resolve(__dirname, "ontology.html"),
        qa: path.resolve(__dirname, "qa.html"),
      },
    },
  },
});
