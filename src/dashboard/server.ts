/**
 * Dashboard server for SkyrimNet Proxy provider management
 * Serves web UI on localhost only for viewing and managing provider configuration
 */

import { createServer } from "node:http";
import { handleDashboardRoute } from "./routes.js";
import type { Logger } from "../logging/logger.js";

/**
 * Create dashboard server
 */
export function createDashboardServer(logger: Logger, port: number) {
  const server = createServer((req, res) => {
    handleDashboardRoute(req, res, logger);
  });

  // Handle server errors
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.error(`Dashboard port ${port} already in use`, {
        error: error.message,
        code: error.code,
      });
    } else {
      logger.error("Dashboard server error", {
        error: error.message,
        code: error.code,
      });
    }
  });

  return server;
}

/**
 * Start dashboard server
 */
export async function startDashboardServer(logger: Logger, port: number): Promise<void> {
  const server = createDashboardServer(logger, port);

  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      logger.info("Dashboard started", {
        host: "127.0.0.1",
        port,
        url: `http://127.0.0.1:${port}`,
      });
      resolve();
    });

    server.on("error", reject);
  });
}
