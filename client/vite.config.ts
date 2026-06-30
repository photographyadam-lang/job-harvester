/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { ServerResponse } from "http";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(
              `[vite proxy] backend unreachable (${msg}). ` +
                `Is the server running on port 3001?`,
            );

            // Return a proper 503 so the client can surface a clear
            // error instead of a raw ECONNRESET.
            if (res && !res.headersSent) {
              const httpRes = res as unknown as ServerResponse;
              if (typeof httpRes.writeHead === "function") {
                httpRes.writeHead(503, {
                  "Content-Type": "application/json",
                });
                httpRes.end(
                  JSON.stringify({
                    error:
                      "Backend server is temporarily unavailable. " +
                      "Please wait a moment and retry.",
                  }),
                );
              }
            }
          });
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
