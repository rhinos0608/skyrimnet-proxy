/**
 * Streaming support for SkyrimNet Proxy
 * SSE pass-through for all providers using undici connection pooling
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderConfig } from "../types/config.js";
import type { Logger } from "../logging/logger.js";
import type { Readable } from "node:stream";
import { request as undiciRequest } from "undici";
import { UpstreamClient } from "./client.js";
import { getConcurrencyLimiter } from "./concurrency.js";

/**
 * Handle streaming request using undici for connection pooling
 */
export async function handleStreaming(
  req: IncomingMessage,
  res: ServerResponse,
  providerConfig: ProviderConfig,
  requestBody: string,
  apiKey: string,
  logger: Logger
): Promise<void> {
  const timeout = parseTimeout(providerConfig.default_timeout);
  const providerName = extractProviderName(providerConfig.base_url);
  let headersSent = false;
  let doneSent = false;

  // Handle client disconnect
  const cleanup = () => {
    // Connection closed by client
    logger.debug("Client disconnected during streaming", { provider: providerName });
  };

  req.on("close", cleanup);

  // Acquire concurrency permit (prevents overwhelming providers)
  const concurrencyLimiter = getConcurrencyLimiter();
  const releasePermit = await concurrencyLimiter.acquire(providerName);

  try {
    // Create upstream request first (before writing response headers)
    const baseUrl = providerConfig.base_url;
    // Build URL - check if base_url already includes /chat/completions
    const url = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;

    // Get connection pool for this provider
    const client = new UpstreamClient(logger);
    const pool = client.getPoolForStreaming(providerConfig, url);

    const upstreamController = new AbortController();
    const timeoutId = setTimeout(() => upstreamController.abort(), timeout);

    // Prepare auth header
    const authHeader = providerConfig.auth_header.replace("${API_KEY}", apiKey);

    // Use undici for connection pooling in streaming
    const undiciUrl = new URL(url);
    const response = await undiciRequest(undiciUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [authHeader.split(":")[0]]: authHeader.split(": ").slice(1).join(": "),
      },
      body: requestBody,
      dispatcher: pool,
      signal: upstreamController.signal as AbortSignal,
    });

    clearTimeout(timeoutId);

    // Validate response before writing headers
    if (response.statusCode >= 400) {
      const errorText = await response.body.text();
      throw new Error(`Upstream streaming failed: ${response.statusCode} ${errorText}`);
    }

    // Set SSE headers for response
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    headersSent = true;

    // undici response.body is already a Node.js Readable stream (BodyReadable extends Readable)
    // No conversion needed - can use it directly
    const nodeStream = response.body as unknown as Readable;

    // Pipe SSE chunks to client
    let buffer = "";
    let currentMessage = "";

    nodeStream.on("data", (chunk: Buffer) => {
      // Decode chunk and add to buffer
      buffer += chunk.toString("utf-8");

      // Process complete SSE messages
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);

          // Check for [DONE] marker
          if (data === "[DONE]") {
            res.write("data: [DONE]\n\n");
            doneSent = true;
            continue;
          }

          // Accumulate the current message line
          currentMessage += line + "\n";
        } else if (line === "") {
          // Empty line marks end of message - flush accumulated message
          if (currentMessage) {
            res.write(currentMessage);
            res.write("\n"); // Empty line separator
            currentMessage = "";
          }
        } else {
          // Other lines (comments, etc.) - pass through
          currentMessage += line + "\n";
        }
      }
    });

    nodeStream.on("end", () => {
      // Flush any remaining message
      if (currentMessage) {
        res.write(currentMessage);
        res.write("\n");
      }

      // Ensure final [DONE] if not already sent
      if (!doneSent) {
        res.write("data: [DONE]\n\n");
      }

      res.end();
    });

    nodeStream.on("error", (err: Error) => {
      if (!headersSent) {
        logger.error("Streaming failed before response", {
          error: err.message,
          provider: providerName,
        });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: err.message,
              type: "api_error",
            },
          })
        );
      } else {
        logger.error("Streaming failed after response started", {
          error: err.message,
          provider: providerName,
        });
      }
    });
  } catch (error) {
    req.off("close", cleanup);

    // Only write error response if headers haven't been sent
    if (!headersSent) {
      logger.error("Streaming failed before response", {
        error: (error as Error).message,
        provider: providerName,
      });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: (error as Error).message,
            type: "api_error",
          },
        })
      );
    } else {
      // Headers already sent - can't send proper error
      logger.error("Streaming failed after response started", {
        error: (error as Error).message,
        provider: providerName,
      });
      // Don't throw after res.end() - connection is already closed
    }
  } finally {
    // Always release the concurrency permit
    releasePermit();
  }
}

/**
 * Parse timeout duration string to milliseconds
 */
function parseTimeout(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h)?$/);
  if (!match) {
    return 60000; // Default 60s
  }

  const value = parseInt(match[1], 10);
  const unit = match[2] || "s";

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

/**
 * Extract provider name from base URL
 */
export function extractProviderName(baseUrl: string): string {
  if (baseUrl.includes("openai.com")) {
    return "openai";
  } else if (baseUrl.includes("openrouter.ai")) {
    return "openrouter";
  } else if (baseUrl.includes("z.ai")) {
    return "zai";
  } else if (baseUrl.includes("mistral.ai")) {
    return "mistral";
  } else if (baseUrl.includes("groq.com")) {
    return "groq";
  } else if (baseUrl.includes("cerebras.ai")) {
    return "cerebras";
  } else if (
    baseUrl.includes("googleapis.com") ||
    baseUrl.includes("generativelanguage.googleapis.com")
  ) {
    return "google";
  } else if (baseUrl.includes("anthropic.com")) {
    return "anthropic";
  }
  return "unknown";
}
