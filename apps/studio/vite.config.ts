import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { simScreenshotPlugin } from "./vite-sim-plugin";

export default defineConfig({
  plugins: [react(), simScreenshotPlugin()],
  build: {
    target: "esnext",
  },
  resolve: {
    alias: {
      "react-native": "react-native-web",
    },
    extensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".web.jsx", ".web.js", ".jsx", ".js"],
  },
  optimizeDeps: {
    exclude: ["yoga-layout"],
  },
  server: {
    port: 5173,
  },
});
