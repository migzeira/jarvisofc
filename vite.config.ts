import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    // Vite/Rollup faz code-splitting automático e seguro por rota (via dynamic imports).
    // manualChunks custom foi removido pois estava separando libs que dependem de React
    // em chunks diferentes, causando "Cannot read properties of undefined (reading 'createContext')"
    // quando o chunk carregava antes do vendor-react.
    chunkSizeWarningLimit: 1000,
  },
}));
