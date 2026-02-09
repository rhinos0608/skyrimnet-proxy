/**
 * Token Manager for API authentication
 * Simplified to only handle API keys from environment variables
 * OAuth token storage has been removed as OAuth flows don't work properly
 */

import type { Logger } from "../logging/logger.js";

/**
 * API key configuration for a provider
 */
export interface ApiKeyConfig {
  provider: string;
  env_var: string;
  header_format: "bearer" | "basic" | "raw";
}

/**
 * Load API key configuration for a provider
 */
export function loadApiKeyConfig(
  provider: string,
  apiKeyEnv: string,
  _logger: Logger
): ApiKeyConfig {
  return {
    provider,
    env_var: apiKeyEnv,
    header_format: "bearer",
  };
}

/**
 * Get API key from environment variables
 * Returns null if not set or empty
 */
export function getApiKey(envVar: string, logger: Logger): string | null {
  const apiKey = process.env[envVar];

  if (!apiKey || apiKey.trim().length === 0) {
    logger.debug(`API key environment variable not set`, { env_var: envVar });
    return null;
  }

  return apiKey.trim();
}

/**
 * Format API key for authorization header
 */
export function formatApiKey(
  apiKey: string,
  format: "bearer" | "basic" | "raw" = "bearer"
): string {
  // If already formatted, return as-is
  if (apiKey.startsWith("Bearer ") || apiKey.startsWith("Basic ")) {
    return apiKey;
  }

  switch (format) {
    case "bearer":
      return `Bearer ${apiKey}`;
    case "basic":
      return `Basic ${apiKey}`;
    case "raw":
      return apiKey;
    default:
      return `Bearer ${apiKey}`;
  }
}

/**
 * Get formatted authorization header for a provider
 * Returns null if API key is not configured
 */
export function getAuthorizationHeader(
  provider: string,
  apiKeyEnv: string,
  logger: Logger
): string | null {
  const apiKey = getApiKey(apiKeyEnv, logger);

  if (!apiKey) {
    logger.warn(`No API key available for provider`, {
      provider,
      env_var: apiKeyEnv,
    });
    return null;
  }

  const header = formatApiKey(apiKey, "bearer");
  logger.debug(`Authorization header prepared`, { provider });
  return header;
}

/**
 * Validate that an API key is properly formatted
 * Returns validation result with optional error message
 */
export function validateApiKey(
  apiKey: string,
  provider: string,
  _logger: Logger
): { valid: boolean; error?: string } {
  if (!apiKey || apiKey.trim().length === 0) {
    return { valid: false, error: "API key is empty" };
  }

  // Basic prefix checks for common providers
  const expectedPrefixes: Record<string, string[]> = {
    openai: ["sk-proj-", "sk-", "sk-proj_"],
    openrouter: ["sk-or-"],
    groq: ["gsk-"],
    anthropic: ["sk-ant-"],
  };

  const prefixes = expectedPrefixes[provider.toLowerCase()];
  if (prefixes && !prefixes.some((prefix) => apiKey.startsWith(prefix))) {
    return {
      valid: false,
      error: `API key for ${provider} does not have expected prefix (${prefixes.join(" or ")})`,
    };
  }

  return { valid: true };
}
