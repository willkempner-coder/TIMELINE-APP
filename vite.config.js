import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages project site path (repo: TIMELINE-APP)
  base: "/TIMELINE-APP/",
  server: {
    port: 4173
  }
});
