import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { simScreenshotPlugin } from "./vite-sim-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), simScreenshotPlugin()],
  build: {
    target: "esnext",
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
    exclude: ["yoga-layout"],
  },
  server: {
    port: 5173,
  },
});
