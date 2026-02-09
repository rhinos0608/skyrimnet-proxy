/**
 * Configuration types for SkyrimNet Proxy
 */

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  n?: number;
  // SkyrimNet-specific nonstandard fields
  cache?: boolean | CacheObject;
  top_k?: number;
  route?: string;
  reasoning?: ReasoningConfig;
}

export interface CacheObject {
  type: "random" | "none";
  max_age?: number;
}

export interface ReasoningConfig {
  enabled: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion" | "chat.completion.chunk";
  created: number;
  model: string;
  choices: Choice[];
  usage?: Usage;
}

export interface Choice {
  index: number;
  message?: Message;
  delta?: Delta;
  finish_reason: "stop" | "length" | "content_filter" | null;
}

export interface Delta {
  role?: string;
  content?: string;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ErrorResponse {
  error: {
    message: string;
    type: "invalid_request_error" | "api_error" | "rate_limit_error";
    param: string | null;
    code?: string;
  };
}

// Configuration types

export interface ModelSlotConfig {
  provider: string;
  model: string;
  enable_reasoning?: boolean;
}

export interface RoutesConfig {
  model_slots: Record<string, ModelSlotConfig>;
  proxy: {
    fallback_to_default: boolean;
  };
}

export interface ProviderConfig {
  base_url: string;
  api_key_env: string;
  auth_header: string;
  allowed_fields: string[];
  streaming_adapter: "none" | "rewrite";
  default_timeout: string;
  max_retries: number;
}

export interface ProvidersConfig {
  providers: Record<string, ProviderConfig>;
  proxy: {
    listen_address: string;
    listen_port: number;
    log_level: string;
    log_file: string;
  };
}

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE";

export interface ParsedDuration {
  milliseconds: number;
}

export interface ResolvedRoute {
  provider: string;
  model: string;
  providerConfig: ProviderConfig;
  enableReasoning?: boolean;
}

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
  provider?: string;
  model?: string;
  latency_ms?: number;
  error?: string;
} & Record<string, unknown>;
