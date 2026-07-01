import path from "node:path";
import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite plugin to serve TTL ontology files from 3GPP_Ontology/ontology/.
 *
 * In dev: middleware intercepts /ontology/* requests and reads from
 *         ../ontology/ (relative to this vite config).
 * In build: copies ../ontology/*.ttl into dist/ontology/.
 * In preview: same middleware as dev.
 */
function ontologyStaticPlugin(): Plugin {
  const ontologyDir = path.resolve(__dirname, "../ontology");

  return {
    name: "serve-ontology-ttl",
    configureServer(server) {
      server.middlewares.use("/ontology", (req, res, next) => {
        const filePath = path.join(ontologyDir, req.url!.replace("/ontology", ""));
        if (fs.existsSync(filePath) && filePath.endsWith(".ttl")) {
          res.setHeader("Content-Type", "text/turtle");
          res.end(fs.readFileSync(filePath, "utf-8"));
          return;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/ontology", (req, res, next) => {
        // In preview, TTL files are copied into dist/ontology/
        const distDir = path.resolve(__dirname, "dist/ontology");
        const filePath = path.join(distDir, req.url!.replace("/ontology", ""));
        if (fs.existsSync(filePath) && filePath.endsWith(".ttl")) {
          res.setHeader("Content-Type", "text/turtle");
          res.end(fs.readFileSync(filePath, "utf-8"));
          return;
        }
        next();
      });
    },
    closeBundle() {
      // Copy TTL files into dist/ontology/ for production build
      const distDir = path.resolve(__dirname, "dist/ontology");
      fs.mkdirSync(distDir, { recursive: true });
      for (const file of fs.readdirSync(ontologyDir)) {
        if (file.endsWith(".ttl")) {
          fs.copyFileSync(
            path.join(ontologyDir, file),
            path.join(distDir, file),
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), ontologyStaticPlugin()],
  base: "./",
  server: {
    fs: {
      allow: ["../.."],
    },
  },
});
