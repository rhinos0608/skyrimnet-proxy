/**
 * Configuration loader for SkyrimNet Proxy
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type {
  ProvidersConfig,
  RoutesConfig,
  ParsedDuration,
  ProviderConfig,
} from "../types/config.js";

const CONFIG_DIR = path.join(process.cwd(), "config");

/**
 * Parse duration string (e.g., "60s", "120s") to milliseconds
 */
export function parseDuration(duration: string): ParsedDuration {
  const match = duration.match(/^(\d+)(s|m|h)?$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2] || "s";

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
  };

  return {
    milliseconds: value * multipliers[unit],
  };
}

/**
 * Load and parse routes.yaml
 */
export function loadRoutesConfig(): RoutesConfig {
  const routesPath = path.join(CONFIG_DIR, "routes.yaml");

  if (!fs.existsSync(routesPath)) {
    throw new Error(`Routes config not found: ${routesPath}`);
  }

  const content = fs.readFileSync(routesPath, "utf-8");
  const config = yaml.load(content) as RoutesConfig;

  // Validate required fields
  if (!config.model_slots || Object.keys(config.model_slots).length === 0) {
    throw new Error("routes.yaml must contain at least one model_slot");
  }

  // Validate each model slot
  for (const [name, slot] of Object.entries(config.model_slots)) {
    if (!slot.provider || !slot.model) {
      throw new Error(`Model slot '${name}' must have 'provider' and 'model' fields`);
    }
  }

  return config;
}

/**
 * Load and parse providers.yaml
 */
export function loadProvidersConfig(): ProvidersConfig {
  const providersPath = path.join(CONFIG_DIR, "providers.yaml");

  if (!fs.existsSync(providersPath)) {
    throw new Error(`Providers config not found: ${providersPath}`);
  }

  const content = fs.readFileSync(providersPath, "utf-8");
  const config = yaml.load(content) as ProvidersConfig;

  // Validate required fields
  if (!config.providers || Object.keys(config.providers).length === 0) {
    throw new Error("providers.yaml must contain at least one provider");
  }

  // Validate each provider
  for (const [name, provider] of Object.entries(config.providers)) {
    if (
      !provider.base_url ||
      !provider.api_key_env ||
      !provider.allowed_fields ||
      !Array.isArray(provider.allowed_fields)
    ) {
      throw new Error(
        `Provider '${name}' is missing required fields (base_url, api_key_env, allowed_fields)`
      );
    }

    // Validate timeout format
    try {
      parseDuration(provider.default_timeout);
    } catch {
      throw new Error(
        `Provider '${name}' has invalid default_timeout: ${provider.default_timeout}`
      );
    }
  }

  return config;
}

/**
 * Get API key from environment variable
 */
export function getApiKey(envVarName: string): string {
  const key = process.env[envVarName];

  if (!key) {
    throw new Error(`API key not found: Environment variable '${envVarName}' is not set`);
  }

  return key;
}

/**
 * Get authentication token for a provider via API key
 */
export function getAuthForProvider(_providerName: string, providerConfig: ProviderConfig): string {
  return getApiKey(providerConfig.api_key_env);
}

/**
 * Load all configuration
 */
export function loadAllConfig(): {
  routes: RoutesConfig;
  providers: ProvidersConfig;
} {
  return {
    routes: loadRoutesConfig(),
    providers: loadProvidersConfig(),
  };
}
