/**
 * Dashboard routes for provider management
 * Handles API endpoints and serves static files
 * Simplified to use only .env configuration and base URL API endpoints
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "../logging/logger.js";
import type { ProvidersConfig, ProviderConfig } from "../types/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");

// Store providers config for route handlers
let providersConfig: ProvidersConfig | null = null;

/**
 * Set providers config for route handlers
 */
export function setProvidersConfig(config: ProvidersConfig): void {
  providersConfig = config;
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, data: unknown, statusCode = 200): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 */
function sendError(res: ServerResponse, message: string, statusCode = 400): void {
  sendJson(res, { error: message }, statusCode);
}

import type { ServerResponse } from "node:http";

/**
 * Serve static file
 */
function serveStaticFile(res: ServerResponse, filename: string): void {
  try {
    const filePath = join(PUBLIC_DIR, filename);
    const content = readFileSync(filePath, "utf-8");
    // Set content type based on file extension
    const ext = filename.split(".").pop();
    const contentTypes: Record<string, string> = {
      html: "text/html",
      js: "application/javascript",
      css: "text/css",
    };
    res.writeHead(200, { "Content-Type": contentTypes[ext || "html"] || "text/plain" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

/**
 * Get API key status for a provider
 */
function getApiKeyStatus(envVar: string): { configured: boolean; source: string } {
  const value = process.env[envVar];
  return {
    configured: !!value && value.length > 0,
    source: envVar,
  };
}

/**
 * Handle dashboard routes
 */
export function handleDashboardRoute(
  req: import("node:http").IncomingMessage,
  res: ServerResponse,
  _logger: Logger
): void {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);

  // Serve static files
  if (url.pathname === "/" || url.pathname === "/index.html") {
    serveStaticFile(res, "index.html");
    return;
  }
  if (url.pathname === "/app.js") {
    serveStaticFile(res, "app.js");
    return;
  }
  if (url.pathname === "/styles.css") {
    serveStaticFile(res, "styles.css");
    return;
  }

  // API routes
  if (url.pathname === "/api/providers" && req.method === "GET") {
    // Get all configured providers with their API key status
    if (!providersConfig) {
      sendError(res, "Providers configuration not loaded", 500);
      return;
    }

    const providers = Object.entries(providersConfig.providers).map(([id, config]) => {
      const providerConfig = config as ProviderConfig;
      const apiKeyStatus = getApiKeyStatus(providerConfig.api_key_env);

      return {
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        base_url: providerConfig.base_url,
        api_key: apiKeyStatus,
        allowed_fields: providerConfig.allowed_fields,
        default_timeout: providerConfig.default_timeout,
        max_retries: providerConfig.max_retries,
      };
    });

    sendJson(res, { providers });
    return;
  }

  if (url.pathname.startsWith("/api/providers/") && req.method === "GET") {
    // Get specific provider details
    const providerId = url.pathname.split("/")[3];
    if (!providersConfig || !providersConfig.providers[providerId]) {
      sendError(res, "Provider not found", 404);
      return;
    }

    const config = providersConfig.providers[providerId] as ProviderConfig;
    const apiKeyStatus = getApiKeyStatus(config.api_key_env);

    sendJson(res, {
      id: providerId,
      name: providerId.charAt(0).toUpperCase() + providerId.slice(1),
      base_url: config.base_url,
      api_key: apiKeyStatus,
      allowed_fields: config.allowed_fields,
      default_timeout: config.default_timeout,
      max_retries: config.max_retries,
    });
    return;
  }

  if (url.pathname === "/api/env" && req.method === "GET") {
    // Get environment variables status (without exposing values)
    const currentConfig = providersConfig;
    if (!currentConfig) {
      sendError(res, "Providers configuration not loaded", 500);
      return;
    }

    const envVars = Object.values(currentConfig.providers).map((config) => {
      const providerConfig = config as ProviderConfig;
      const envVar = providerConfig.api_key_env;
      const value = process.env[envVar];

      return {
        env_var: envVar,
        provider: Object.keys(currentConfig.providers).find(
          (key) => (currentConfig.providers[key] as ProviderConfig).api_key_env === envVar
        ),
        configured: !!value && value.length > 0,
        has_prefix: value ? value.startsWith("sk-") || value.startsWith("Bearer ") : false,
      };
    });

    sendJson(res, { env_vars: envVars });
    return;
  }

  if (url.pathname === "/api/config" && req.method === "GET") {
    // Get proxy configuration
    if (!providersConfig) {
      sendError(res, "Configuration not loaded", 500);
      return;
    }

    sendJson(res, {
      proxy: {
        listen_address: providersConfig.proxy.listen_address,
        listen_port: providersConfig.proxy.listen_port,
        log_level: providersConfig.proxy.log_level,
        log_file: providersConfig.proxy.log_file,
      },
    });
    return;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    // Health check endpoint
    sendJson(res, {
      status: "healthy",
      timestamp: new Date().toISOString(),
      providers_configured: providersConfig ? Object.keys(providersConfig.providers).length : 0,
    });
    return;
  }

  // 404 for unknown routes
  sendError(res, "Not found", 404);
}
