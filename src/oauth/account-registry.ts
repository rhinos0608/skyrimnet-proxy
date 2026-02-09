/**
 * Account Registry for managing provider API key configurations
 * Simplified to track which providers have API keys configured in environment
 * OAuth account management has been removed as it doesn't work properly
 */

import type { Logger } from "../logging/logger.js";

/**
 * Provider account information
 */
export interface ProviderAccount {
  provider: string;
  api_key_env: string;
  configured: boolean;
  base_url: string;
}

// In-memory store of provider accounts
const accounts: Map<string, ProviderAccount> = new Map();

/**
 * Register a provider account
 * Called during configuration loading to track available providers
 */
export function registerProviderAccount(
  provider: string,
  apiKeyEnv: string,
  baseUrl: string,
  logger: Logger
): ProviderAccount {
  const configured = !!process.env[apiKeyEnv] && process.env[apiKeyEnv]!.length > 0;

  const account: ProviderAccount = {
    provider,
    api_key_env: apiKeyEnv,
    configured,
    base_url: baseUrl,
  };

  accounts.set(provider, account);

  logger.debug(`Provider account registered`, {
    provider,
    configured,
    api_key_env: apiKeyEnv,
  });

  return account;
}

/**
 * Get all registered provider accounts
 */
export function getAllAccounts(): ProviderAccount[] {
  return Array.from(accounts.values());
}

/**
 * Get account for a specific provider
 */
export function getAccount(provider: string): ProviderAccount | null {
  return accounts.get(provider) || null;
}

/**
 * Check if a provider has a configured API key
 */
export function isProviderConfigured(_provider: string, apiKeyEnv: string): boolean {
  const apiKey = process.env[apiKeyEnv];
  return !!apiKey && apiKey.length > 0;
}

/**
 * Get configured providers
 * Returns list of providers that have API keys set
 */
export function getConfiguredProviders(logger: Logger): string[] {
  const configured: string[] = [];

  for (const [provider, account] of accounts) {
    if (account.configured) {
      configured.push(provider);
    }
  }

  logger.debug(`Retrieved configured providers`, {
    count: configured.length,
    providers: configured,
  });

  return configured;
}

/**
 * Get unconfigured providers
 * Returns list of providers that don't have API keys set
 */
export function getUnconfiguredProviders(logger: Logger): string[] {
  const unconfigured: string[] = [];

  for (const [provider, account] of accounts) {
    if (!account.configured) {
      unconfigured.push(provider);
    }
  }

  logger.debug(`Retrieved unconfigured providers`, {
    count: unconfigured.length,
    providers: unconfigured,
  });

  return unconfigured;
}

/**
 * Clear all registered accounts
 * Used for testing or configuration reload
 */
export function clearAccounts(): void {
  accounts.clear();
}

/**
 * Get the count of configured providers
 */
export function getConfiguredProviderCount(): number {
  return Array.from(accounts.values()).filter((a) => a.configured).length;
}
