import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Anything hitting /api in dev is forwarded to the Express proxy.
      "/api": "http://localhost:8787",
    },
  },
});
