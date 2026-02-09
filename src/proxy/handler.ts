/**
 * HTTP request handler for SkyrimNet Proxy
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Router } from "./router.js";
import type { Logger } from "../logging/logger.js";
import { UpstreamClient } from "./client.js";
import { parseRequestBody, transformRequest, serializeRequest } from "./transformer.js";
import { getAuthForProvider } from "../config/loader.js";
import { handleStreaming } from "./streaming.js";

// Maximum request body size (10MB) to prevent DoS
const MAX_REQUEST_SIZE = 10 * 1024 * 1024;

/**
 * Handle incoming HTTP request
 */
export function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  router: Router,
  logger: Logger
): void {
  const startTime = Date.now();

  // Only handle POST requests to /v1/chat/completions
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    if (req.url === "/healthz") {
      handleHealthz(res);
      return;
    }
    sendError(res, 404, "Not Found", "invalid_request_error", logger);
    return;
  }

  // Read request body
  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
    // Check for request size limit
    if (body.length > MAX_REQUEST_SIZE) {
      logger.error("Request body too large", {
        size: body.length,
        max_size: MAX_REQUEST_SIZE,
      });
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: `Request body too large (max ${MAX_REQUEST_SIZE} bytes)`,
            type: "invalid_request_error",
            param: null,
          },
        })
      );
      req.destroy();
      return;
    }
  });

  req.on("end", () => {
    void (async () => {
      try {
        // Parse request
        const request = parseRequestBody(body);
        logger.info("Incoming request", {
          model: request.model,
          stream: request.stream || false,
        });

        // Resolve route
        const route = router.resolveRoute(request);
        logger.info("Route resolved", {
          provider: route.provider,
          model: route.model,
          enable_reasoning: route.enableReasoning,
        });

        // Transform request
        const transformed = transformRequest(request, route.providerConfig, logger);

        // Update model name for upstream
        transformed.model = route.model;

        // Serialize for upstream
        const serialized = serializeRequest(transformed as unknown as Record<string, unknown>);

        // Get auth for provider (API key)
        const auth = getAuthForProvider(route.provider, route.providerConfig);

        // Create client and send request
        const client = new UpstreamClient(logger);

        // Check if streaming
        if (request.stream) {
          await handleStreaming(req, res, route.providerConfig, serialized, auth, logger);
          const latency = Date.now() - startTime;
          logger.info("Streaming request completed", {
            provider: route.provider,
            model: route.model,
            latency_ms: latency,
          });
        } else {
          // Non-streaming
          const result = await client.sendRequest(
            route.providerConfig,
            serialized,
            auth,
            startTime
          );

          // Parse upstream response
          const responseBody = JSON.parse(result.body);

          // Echo back requested model name
          responseBody.model = request.model;

          // Send response
          res.writeHead(result.statusCode, {
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify(responseBody));

          const latency = Date.now() - startTime;
          logger.info("Non-streaming request completed", {
            provider: route.provider,
            model: route.model,
            latency_ms: latency,
          });
        }
      } catch (error) {
        handleError(error, res, logger);
      }
    })();
  });
}

/**
 * Handle health check endpoint
 */
function handleHealthz(res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }));
}

/**
 * Send error response
 */
function sendError(
  res: ServerResponse,
  statusCode: number,
  message: string,
  type: "invalid_request_error" | "api_error" | "rate_limit_error",
  logger: Logger
): void {
  logger.error("Request error", {
    status_code: statusCode,
    message,
    type,
  });

  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: {
        message,
        type,
        param: null,
      },
    })
  );
}

/**
 * Handle errors from request processing
 */
function handleError(error: unknown, res: ServerResponse, logger: Logger): void {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const statusCode =
    error instanceof Error && "statusCode" in error ? (error.statusCode as number) || 500 : 500;

  // Determine error type
  let errorType: "invalid_request_error" | "api_error" | "rate_limit_error" = "api_error";

  if (
    error instanceof Error &&
    "type" in error &&
    (error.type as string) === "invalid_request_error"
  ) {
    errorType = "invalid_request_error";
  } else if (statusCode === 429) {
    errorType = "rate_limit_error";
  }

  logger.error("Request processing failed", {
    error: errorMessage,
    status_code: statusCode,
    error_type: errorType,
  });

  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: {
        message: errorMessage,
        type: errorType,
        param: null,
      },
    })
  );
}
