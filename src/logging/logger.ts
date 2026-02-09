/**
 * Structured logging for SkyrimNet Proxy
 * JSON lines format with redaction
 * Uses Pino for async, high-performance logging
 */

import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import type { LogLevel } from "../types/config.js";

const LOG_LEVELS: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4,
};

/**
 * Redact sensitive values from log data
 */
function redact(data: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...data };

  // Redact API keys (patterns: sk-, Bearer, etc.)
  for (const [key, value] of Object.entries(redacted)) {
    if (typeof value === "string") {
      // Check for common API key patterns (case-insensitive)
      const lowerValue = value.toLowerCase();
      const lowerKey = key.toLowerCase();

      if (
        lowerValue.startsWith("sk-") ||
        lowerValue.startsWith("bearer ") ||
        lowerKey.includes("key") ||
        lowerKey.includes("token") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("authorization")
      ) {
        redacted[key] = "***REDACTED***";
        continue;
      }

      // Check for API key patterns (sk-proj, sk-or, etc.)
      if (/^sk-[a-z0-9_-]{20,}$/i.test(value)) {
        redacted[key] = "***REDACTED***";
      }
    } else if (typeof value === "object" && value !== null) {
      // Recursively redact nested objects
      redacted[key] = redact(value as Record<string, unknown>);
    }
  }

  return redacted;
}

/**
 * Logger class for structured logging
 * Wraps Pino for async, high-performance logging
 */
export class Logger {
  private pino: pino.Logger;
  private currentLevel: LogLevel;
  private logFilePath?: string;
  private logToFile: boolean;

  constructor(level: LogLevel = "INFO", logFilePath?: string, logToFile: boolean = true) {
    this.currentLevel = level;
    this.logFilePath = logFilePath;
    this.logToFile = logToFile;

    // Ensure log directory exists
    if (this.logFilePath && this.logToFile) {
      const dir = path.dirname(this.logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Create Pino logger with async file destination
    const streams: pino.TransportMultiOptions | pino.StreamEntry[] = [];

    // Console output
    streams.push({
      level: level.toLowerCase() as pino.Level,
      stream: process.stderr,
    });

    // File destination if logging to file
    if (this.logFilePath && this.logToFile) {
      streams.push({
        level: level.toLowerCase() as pino.Level,
        stream: pino.destination({
          dest: this.logFilePath,
          sync: false, // Async mode for better performance
          append: true,
        }),
      });
    }

    this.pino = pino(
      {
        level: level.toLowerCase() as pino.Level,
        formatters: {
          level: (label) => {
            return { level: label.toUpperCase() };
          },
        },
        serializers: {
          err: pino.stdSerializers.err,
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.multistream(streams)
    );
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.currentLevel];
  }

  /**
   * Write log entry using Pino (async)
   */
  private writeLog(level: LogLevel, message: string, data: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    // Redact sensitive data before logging
    const redactedData = redact(data);

    // Use Pino for async logging
    const pinoLevel = level.toLowerCase() as pino.Level;
    this.pino[pinoLevel]({ ...redactedData }, message);
  }

  error(message: string, data: Record<string, unknown> = {}): void {
    this.writeLog("ERROR", message, data);
  }

  warn(message: string, data: Record<string, unknown> = {}): void {
    this.writeLog("WARN", message, data);
  }

  info(message: string, data: Record<string, unknown> = {}): void {
    this.writeLog("INFO", message, data);
  }

  debug(message: string, data: Record<string, unknown> = {}): void {
    this.writeLog("DEBUG", message, data);
  }

  trace(message: string, data: Record<string, unknown> = {}): void {
    this.writeLog("TRACE", message, data);
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
    this.pino.level = level.toLowerCase() as pino.Level;
  }

  /**
   * Flush any pending log entries
   */
  async flush(): Promise<void> {
    // Pino automatically flushes, but we can ensure it's done
    await new Promise<void>((resolve) => {
      this.pino.flush(() => resolve());
    });
  }
}

/**
 * Create logger from config
 */
export function createLogger(
  levelString: string,
  logFilePath?: string,
  logToFile: boolean = true
): Logger {
  // Normalize level string
  const level = (levelString.toUpperCase() || "INFO") as LogLevel;

  if (!LOG_LEVELS[level]) {
    console.warn(`Invalid log level '${levelString}', using INFO`);
    return new Logger("INFO", logFilePath, logToFile);
  }

  return new Logger(level, logFilePath, logToFile);
}
