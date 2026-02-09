/**
 * OAuth Handler - Simplified for API Key authentication only
 * Original OAuth flow management has been removed as it doesn't work properly
 * This module now handles provider authentication validation via environment variables
 */

import type { Logger } from "../logging/logger.js";
import { getProviderApiKey } from "./auth-strategies.js";

/**
 * Authentication result
 */
export interface AuthResult {
  success: boolean;
  error?: string;
  api_key?: string;
}

/**
 * Validate provider authentication
 * Checks if the provider has a valid API key configured in environment
 */
export function validateProviderAuth(
  provider: string,
  apiKeyEnv: string,
  logger: Logger
): AuthResult {
  logger.debug(`Validating provider authentication`, { provider });

  const apiKey = getProviderApiKey(provider, apiKeyEnv, logger);

  if (!apiKey) {
    return {
      success: false,
      error: `No API key configured for ${provider}. Set ${apiKeyEnv} in your .env file.`,
    };
  }

  return {
    success: true,
    api_key: apiKey,
  };
}

/**
 * Check if authentication is valid for a provider
 * Returns true if the provider has a configured API key
 */
export function isAuthValid(provider: string, apiKeyEnv: string, logger: Logger): boolean {
  const result = validateProviderAuth(provider, apiKeyEnv, logger);
  return result.success;
}

/**
 * Get authentication error message for a provider
 * Returns null if authentication is valid
 */
export function getAuthError(provider: string, apiKeyEnv: string, logger: Logger): string | null {
  const result = validateProviderAuth(provider, apiKeyEnv, logger);
  return result.error || null;
}

/**
 * Handle authentication for a request
 * Returns authorization header or null if authentication failed
 */
export function getAuthHeader(provider: string, apiKeyEnv: string, logger: Logger): string | null {
  const result = validateProviderAuth(provider, apiKeyEnv, logger);

  if (!result.success || !result.api_key) {
    return null;
  }

  // Format as Bearer token
  if (result.api_key.startsWith("Bearer ") || result.api_key.startsWith("Basic ")) {
    return result.api_key;
  }

  return `Bearer ${result.api_key}`;
}
