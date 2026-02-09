/**
 * Request transformation pipeline for SkyrimNet Proxy
 * Handles JSON parse → modify → reserialize
 */

import type { ChatCompletionRequest, ProviderConfig, CacheObject } from "../types/config.js";
import type { Logger } from "../logging/logger.js";
import { extractProviderName } from "./streaming.js";

/**
 * Transform request based on provider capabilities
 */
export function transformRequest(
  request: ChatCompletionRequest,
  providerConfig: ProviderConfig,
  logger: Logger
): ChatCompletionRequest {
  // Create a copy to avoid mutating original
  const transformed: Record<string, unknown> = { ...request };

  // Apply capability filter (whitelist-based)
  applyCapabilityFilter(transformed, providerConfig.allowed_fields, logger);

  // Transform cache field based on type and provider
  transformCacheField(transformed, providerConfig, logger);

  // Validate and return
  return transformed as unknown as ChatCompletionRequest;
}

/**
 * Apply provider capability filter - drop fields not in whitelist
 */
function applyCapabilityFilter(
  request: Record<string, unknown>,
  allowedFields: string[],
  logger: Logger
): void {
  const allowedSet = new Set(allowedFields);
  const fieldsToDrop: string[] = [];

  // Find fields not in allowed set
  for (const field of Object.keys(request)) {
    if (!allowedSet.has(field)) {
      fieldsToDrop.push(field);
    }
  }

  // Drop unsupported fields with debug logging
  for (const field of fieldsToDrop) {
    logger.debug(`Dropped field '${field}' for provider (not supported)`, {});
    delete request[field];
  }
}

/**
 * Transform cache field based on type and provider
 * Decision table:
 * - OpenAI: Drop cache field entirely
 * - OpenRouter: bool true → {type:"random",max_age:300}, bool false → drop, object → pass
 * - z.ai: object → bool (random → true, none → false), bool → pass
 */
function transformCacheField(
  request: Record<string, unknown>,
  providerConfig: ProviderConfig,
  logger: Logger
): void {
  const cacheValue = request.cache;

  // Check if provider supports cache field
  const supportsCache = providerConfig.allowed_fields.includes("cache");
  if (!supportsCache && cacheValue !== undefined) {
    logger.debug(`Dropped field 'cache' for provider (not supported)`, {});
    delete request.cache;
    return;
  }

  if (cacheValue === undefined) {
    return;
  }

  const providerName = extractProviderName(providerConfig.base_url);

  // Handle cache transformation based on provider
  if (providerName === "openai") {
    // OpenAI doesn't support cache - drop it
    delete request.cache;
  } else if (providerName === "openrouter") {
    // OpenRouter: accept both bool and object
    if (typeof cacheValue === "boolean") {
      if (cacheValue) {
        // true → {type: "random", max_age: 300}
        request.cache = { type: "random", max_age: 300 };
      } else {
        // false → drop field
        delete request.cache;
      }
    }
    // object → pass through as-is
  } else if (providerName === "zai") {
    // z.ai: convert object to bool
    if (typeof cacheValue === "object" && cacheValue !== null) {
      const cacheObj = cacheValue as CacheObject;
      if (cacheObj.type === "random") {
        request.cache = true;
      } else {
        // "none" or unknown → false
        request.cache = false;
      }
    }
    // boolean → pass through as-is
  }
}

/**
 * Serialize request to JSON for upstream
 * Validates output is parseable
 */
export function serializeRequest(request: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(request);

    // Validate by parsing back
    JSON.parse(json);

    return json;
  } catch (error) {
    throw new Error(
      `Failed to serialize request: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Parse incoming request JSON
 */
export function parseRequestBody(body: string): ChatCompletionRequest {
  try {
    const parsed = JSON.parse(body);

    // Validate required fields
    if (!parsed.model || typeof parsed.model !== "string") {
      throw new Error("Request must contain 'model' field (string)");
    }

    if (!parsed.messages || !Array.isArray(parsed.messages)) {
      throw new Error("Request must contain 'messages' field (array)");
    }

    return parsed as ChatCompletionRequest;
  } catch (error) {
    throw new Error(
      `Invalid JSON in request body: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
