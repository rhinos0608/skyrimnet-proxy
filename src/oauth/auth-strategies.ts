/**
 * Provider authentication strategies
 * Simplified to only use API key authentication from environment variables
 * OAuth flows have been removed as they don't work properly in this setup
 */

import type { Logger } from "../logging/logger.js";

/**
 * Authentication configuration for a provider
 */
export interface AuthConfig {
  type: "api_key";
  name: string;
  header_prefix: string;
  api_key_env: string;
}

/**
 * Get authentication configuration for a provider
 * All providers use API key authentication loaded from environment variables
 */
export function getAuthConfig(provider: string, apiKeyEnv: string, _logger: Logger): AuthConfig {
  return {
    type: "api_key",
    name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} API Key`,
    header_prefix: "Bearer",
    api_key_env: apiKeyEnv,
  };
}

/**
 * Check if a provider is configured (has API key set in environment)
 */
export function isProviderConfigured(provider: string, apiKeyEnv: string, logger: Logger): boolean {
  const apiKey = process.env[apiKeyEnv];
  const configured = !!apiKey && apiKey.length > 0;

  if (!configured) {
    logger.warn(`Provider ${provider} is not configured - ${apiKeyEnv} not set`, {
      provider,
      env_var: apiKeyEnv,
    });
  }

  return configured;
}

/**
 * Get API key for a provider from environment variables
 * Returns null if not configured
 */
export function getProviderApiKey(
  provider: string,
  apiKeyEnv: string,
  logger: Logger
): string | null {
  const apiKey = process.env[apiKeyEnv];

  if (!apiKey || apiKey.length === 0) {
    logger.error(`API key not found for provider ${provider}`, {
      provider,
      env_var: apiKeyEnv,
    });
    return null;
  }

  return apiKey;
}

/**
 * Build authorization header for a provider
 */
export function buildAuthHeader(
  provider: string,
  apiKeyEnv: string,
  logger: Logger
): string | null {
  const apiKey = getProviderApiKey(provider, apiKeyEnv, logger);

  if (!apiKey) {
    return null;
  }

  // Handle different header formats
  if (apiKey.startsWith("Bearer ")) {
    return apiKey;
  }

  if (apiKey.startsWith("Basic ")) {
    return apiKey;
  }

  // Default to Bearer token format
  return `Bearer ${apiKey}`;
}
