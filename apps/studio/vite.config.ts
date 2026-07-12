import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { simScreenshotPlugin } from "./vite-sim-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), simScreenshotPlugin()],
  build: {
    target: "esnext",
    // tldraw's two package-level chunks are intentionally kept intact because
    // splitting its cyclic internals creates unsafe circular Rollup chunks.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const tldrawPackage = id.match(
            /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@tldraw\/[^/]+|tldraw)\//,
          )?.[1];
          if (tldrawPackage) {
            return `vendor-${tldrawPackage.replace("@tldraw/", "tldraw-")}`;
          }
          if (id.includes("/node_modules/react-native-web/")) return "vendor-react-native-web";
          if (
            id.includes("/node_modules/@base-ui/") ||
            id.includes("/node_modules/lucide-react/") ||
            id.includes("/node_modules/html-to-image/")
          ) {
            return "vendor-ui";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "react-native": "react-native-web",
    },
    // Base UI (and any other React lib) must share the app's single React copy;
    // pnpm can otherwise resolve a second instance and break the Rules of Hooks.
    dedupe: ["react", "react-dom"],
    extensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".web.jsx", ".web.js", ".jsx", ".js"],
  },
  optimizeDeps: {
    include: ["tldraw", "react-native-web", "@base-ui/react"],
    exclude: ["yoga-layout"],
  },
  server: {
    port: 5173,
  },
});
