/**
 * SkyrimNet Proxy - Main Entry Point
 */

import "dotenv/config";
import { loadAllConfig } from "./config/loader.js";
import { Router } from "./proxy/router.js";
import { createLogger, type Logger } from "./logging/logger.js";
import { startServer } from "./proxy/server.js";
import { closeAllClients } from "./proxy/client.js";

/**
 * Main function
 */
async function main(): Promise<void> {
  // Create logger early (before config loading)
  const logger = createLogger("INFO", undefined, false);

  logger.info("SkyrimNet Proxy v1.0.0 starting", {
    version: "1.0.0",
  });

  try {
    // Load configuration
    logger.info("Loading configuration", {});
    const { routes, providers } = loadAllConfig();

    // Update logger with configured settings
    const configuredLogger = createLogger(
      providers.proxy.log_level,
      providers.proxy.log_file,
      true
    );

    configuredLogger.info("SkyrimNet Proxy starting", {
      version: "1.0.0",
      model_slots: Object.keys(routes.model_slots).length,
      providers: Object.keys(providers.providers).length,
    });

    // Create router
    const router = new Router(routes, providers);
    configuredLogger.info("Router initialized", {
      model_slots: router.getModelSlots(),
    });

    // Start API proxy server
    const { listen_address, listen_port } = providers.proxy;
    await startServer(router, configuredLogger, listen_address, listen_port);

    // Handle graceful shutdown
    setupGracefulShutdown(configuredLogger);
  } catch (error) {
    logger.error("Failed to start proxy", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(logger: Logger): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`, {});
    try {
      // Close all client connection pools
      await closeAllClients();
      logger.info("All connection pools closed", {});
    } catch (error) {
      logger.error("Error during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", {
      reason: String(reason),
    });
    process.exit(1);
  });
}

// Run main
main().catch((error) => {
  // Last resort - can't use logger here as it might not be initialized
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});
