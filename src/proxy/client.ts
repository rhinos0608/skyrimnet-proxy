/**
 * Upstream HTTP client for SkyrimNet Proxy
 * Uses undici Pool for connection pooling and reuse
 */

import { Pool, request as undiciRequest } from "undici";
import type { ProviderConfig } from "../types/config.js";
import type { Logger } from "../logging/logger.js";
import { parseDuration } from "../config/loader.js";
import { extractProviderName } from "./streaming.js";
import { getConcurrencyLimiter } from "./concurrency.js";

/**
 * Connection pool configuration per provider
 */
interface PoolConfig {
  pool: Pool;
  maxConnections: number;
  maxPendingRequests: number;
}

/**
 * Singleton client manager with connection pooling
 * Maintains one pool per provider for connection reuse
 */
class ClientManager {
  private static instance: ClientManager | null = null;
  private pools: Map<string, PoolConfig> = new Map();
  private logger: Logger;
  private readonly DEFAULT_MAX_CONNECTIONS = 50; // Per provider
  private readonly DEFAULT_MAX_PENDING = 100; // Queue size

  private constructor(logger: Logger) {
    this.logger = logger;
  }

  static getInstance(logger: Logger): ClientManager {
    if (!ClientManager.instance) {
      ClientManager.instance = new ClientManager(logger);
    }
    return ClientManager.instance;
  }

  /**
   * Get or create connection pool for a provider
   */
  getPool(providerConfig: ProviderConfig, baseUrl: string): Pool {
    const poolKey = `${providerConfig.base_url}|${baseUrl}`;

    if (!this.pools.has(poolKey)) {
      // Pool requires only origin (protocol + host + port), not full path
      const poolOrigin = new URL(baseUrl).origin;
      const pool = new Pool(poolOrigin, {
        connections: this.DEFAULT_MAX_CONNECTIONS,
        pipelining: 1,
        keepAliveTimeout: 60_000, // 60 seconds
        keepAliveMaxTimeout: 300_000, // 5 minutes
        keepAliveTimeoutThreshold: 10_000, // 10 seconds
        maxCachedSessions: 100, // TLS sessions
        connect: {
          timeout: 10_000, // 10 seconds connection timeout
        },
      });

      this.pools.set(poolKey, {
        pool,
        maxConnections: this.DEFAULT_MAX_CONNECTIONS,
        maxPendingRequests: this.DEFAULT_MAX_PENDING,
      });

      this.logger.info("Created connection pool for provider", {
        provider: extractProviderName(baseUrl),
        max_connections: this.DEFAULT_MAX_CONNECTIONS,
        max_pending: this.DEFAULT_MAX_PENDING,
      });
    }

    return this.pools.get(poolKey)!.pool;
  }

  /**
   * Close all connection pools gracefully
   */
  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [key, poolConfig] of this.pools.entries()) {
      closePromises.push(
        new Promise<void>((resolve) => {
          poolConfig.pool.close(() => {
            this.logger.info("Closed connection pool", { pool: key });
            resolve();
          });
        })
      );
    }

    await Promise.all(closePromises);
    this.pools.clear();
  }
}

/**
 * Upstream HTTP client with connection pooling and retries
 */
export class UpstreamClient {
  private logger: Logger;
  private clientManager: ClientManager;

  constructor(logger: Logger) {
    this.logger = logger;
    this.clientManager = ClientManager.getInstance(logger);
  }

  /**
   * Send request to upstream provider
   */
  async sendRequest(
    providerConfig: ProviderConfig,
    requestBody: string,
    apiKey: string,
    startTime: number
  ): Promise<{
    response: Response;
    body: string;
    statusCode: number;
    headers: Record<string, string>;
  }> {
    const timeout = parseDuration(providerConfig.default_timeout).milliseconds;
    const baseUrl = providerConfig.base_url;
    const providerKey = extractProviderName(baseUrl);

    // Acquire concurrency permit (prevents overwhelming providers)
    const concurrencyLimiter = getConcurrencyLimiter();
    const releasePermit = await concurrencyLimiter.acquire(providerKey);

    try {
      // Prepare auth header
      const authHeader = providerConfig.auth_header.replace("${API_KEY}", apiKey);

      // Build URL - check if base_url already includes /chat/completions
      const url = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;

      // Get connection pool for this provider
      const pool = this.clientManager.getPool(providerConfig, url);

      // Try with retries
      let lastError: Error | null = null;
      const maxRetries = providerConfig.max_retries;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
            this.logger.info(`Retrying request (attempt ${attempt}/${maxRetries})`, {
              delay_ms: delay,
            });
            await sleep(delay + Math.random() * 200); // Add jitter
          }

          const result = await this.requestWithTimeout(
            pool,
            url,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                [authHeader.split(":")[0]]: authHeader.split(": ").slice(1).join(": "),
              },
              body: requestBody,
            },
            timeout
          );

          const latency = Date.now() - startTime;
          this.logger.info("Upstream request completed", {
            provider: extractProviderName(baseUrl),
            latency_ms: latency,
            status_code: result.statusCode,
          });

          return result;
        } catch (error) {
          lastError = error as Error;
          const statusCode = (error as Error & { statusCode?: number })?.statusCode;

          // Check if error is retryable
          const isRetryable =
            !statusCode || // Network error
            statusCode === 408 ||
            statusCode === 429 ||
            statusCode >= 500;

          if (!isRetryable || attempt >= maxRetries) {
            break;
          }

          this.logger.warn("Upstream request failed, retrying", {
            attempt: attempt + 1,
            max_retries: maxRetries,
            error: (error as Error).message,
            status_code: statusCode,
          });
        }
      }

      // All retries exhausted
      this.logger.error("Upstream request failed after retries", {
        error: lastError?.message,
      });

      throw lastError || new Error("Upstream request failed");
    } finally {
      // Always release the concurrency permit
      releasePermit();
    }
  }

  /**
   * Request with timeout using undici pool
   */
  private async requestWithTimeout(
    pool: Pool,
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body: string;
    },
    timeout: number
  ): Promise<{
    response: Response;
    body: string;
    statusCode: number;
    headers: Record<string, string>;
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Use undici for connection pooling
      const undiciUrl = new URL(url);
      const response = await undiciRequest(undiciUrl, {
        ...options,
        dispatcher: pool,
        signal: controller.signal,
        headersTimeout: timeout,
        bodyTimeout: timeout,
      });

      clearTimeout(timeoutId);

      const body = await response.body.text();
      const headers: Record<string, string> = {};

      // Convert Headers object to plain record
      for (const [key, value] of Object.entries(response.headers)) {
        headers[key] = Array.isArray(value) ? value.join(", ") : (value ?? "");
      }

      if (response.statusCode >= 400) {
        const error = new Error(`Upstream returned ${response.statusCode}`) as Error & {
          statusCode: number;
          body: string;
        };
        error.statusCode = response.statusCode;
        error.body = body;
        throw error;
      }

      return {
        response: response as unknown as Response,
        body,
        statusCode: response.statusCode,
        headers,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === "AbortError") {
        const timeoutError = new Error("Upstream request timed out") as Error & {
          statusCode: number;
        };
        timeoutError.statusCode = 504;
        throw timeoutError;
      }

      throw error;
    }
  }

  /**
   * Get the connection pool for streaming requests
   */
  getPoolForStreaming(providerConfig: ProviderConfig, url: string): Pool {
    return this.clientManager.getPool(providerConfig, url);
  }
}

/**
 * Close all client connection pools
 * Call during graceful shutdown
 */
export async function closeAllClients(): Promise<void> {
  const manager = ClientManager.getInstance(
    // Dummy logger for shutdown
    {} as Logger
  );
  await manager.closeAll();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
