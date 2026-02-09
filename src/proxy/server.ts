/**
 * HTTP server for SkyrimNet Proxy
 */

import { createServer } from "node:http";
import type { Router } from "./router.js";
import type { Logger } from "../logging/logger.js";
import { handleRequest } from "./handler.js";

/**
 * Create and configure HTTP server
 */
export function createProxyServer(
  router: Router,
  logger: Logger,
  _host: string,
  port: number
): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    handleRequest(req, res, router, logger);
  });

  // Handle server errors
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.error(`Port ${port} already in use`, {
        error: error.message,
        code: error.code,
      });
    } else {
      logger.error("Server error", {
        error: error.message,
        code: error.code,
      });
    }
  });

  return server;
}

/**
 * Start the server
 */
export async function startServer(
  router: Router,
  logger: Logger,
  host: string,
  port: number
): Promise<void> {
  const server = createProxyServer(router, logger, host, port);

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      logger.info("SkyrimNet Proxy started", {
        host,
        port,
        url: `http://${host}:${port}`,
      });
      resolve();
    });

    server.on("error", reject);
  });
}

/**
 * Gracefully shutdown the server
 */
export function shutdownServer(
  server: ReturnType<typeof createServer>,
  logger: Logger
): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      logger.info("Server shutdown complete");
      resolve();
    });

    // Force close after 10 seconds
    setTimeout(() => {
      logger.warn("Server shutdown timed out, forcing close");
      process.exit(0);
    }, 10000);
  });
}
