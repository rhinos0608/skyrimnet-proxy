# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkyrimNet Proxy is a local HTTP proxy that sits between SkyrimNet (a mod for Skyrim) and upstream OpenAI-compatible providers. The proxy normalizes requests, routes model aliases to configured providers, transforms provider-specific payloads, and maintains streaming compatibility.

**Key Design Principle:** The proxy is the "truth layer" - all request mutation happens via full JSON parse → modify → reserialize. SkyrimNet sends complete HTTP request bodies at the application layer, so no byte-level surgery is needed.

## Commands

### Development
```bash
npm run dev          # Start development server with hot-reload (nodemon + ts-node)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled production build (node dist/index.js)
```

### Code Quality
```bash
npm run lint         # Run ESLint
npm run lint:fix     # Fix auto-fixable ESLint issues
npm run format       # Format code with Prettier
npm run format:check # Check formatting without modifying
```

### Testing
No tests are currently configured. Test script returns error.

## Architecture

### Request Flow
```
SkyrimNet → Proxy (127.0.0.1:35791) → Upstream Provider
```

1. **HTTP Server** (`src/proxy/server.ts`): Node.js native HTTP server listening on 127.0.0.1:35791
2. **Request Handler** (`src/proxy/handler.ts`): Accepts POST to `/v1/chat/completions`, validates JSON, resolves route
3. **Router** (`src/proxy/router.ts`): Maps model aliases (slots) to provider + upstream model
4. **Transformer** (`src/proxy/transformer.ts`): Applies provider capability filters and field transformations
5. **Upstream Client** (`src/proxy/client.ts`): Sends requests using undici with connection pooling
6. **Streaming** (`src/proxy/streaming.ts`): SSE pass-through for real-time responses

### Core Abstractions

**Router Resolution Logic:**
- Model slots defined in `config/routes.yaml` (e.g., "default", "creative", "factual")
- Direct provider:model syntax bypasses slots (e.g., "openai:gpt-4o")
- Unknown aliases throw `RoutingError` with HTTP 400 unless `fallback_to_default: true`
- `router.resolveRoute(request)` returns `ResolvedRoute` with provider, model, config

**Provider Capability Filtering:**
- Each provider has `allowed_fields` whitelist in `config/providers.yaml`
- `transformer.ts` drops any request field not in the whitelist (logged at DEBUG)
- This prevents unsupported fields from breaking providers

**Cache Field Transformation:**
- **OpenAI:** Drops cache field entirely
- **OpenRouter:** bool true → `{type:"random",max_age:300}`, bool false → drop, object → pass
- **z.ai:** object → bool (random→true, none→false), bool → pass

**Streaming Strategy:**
- Pass-through by default (no buffering, lowest latency)
- SSE chunks relayed immediately from upstream to SkyrimNet
- Provider config has `streaming_adapter: "none"` for standard OpenAI-compatible SSE

**Connection Pooling:**
- `ClientManager` singleton maintains one undici `Pool` per provider
- Default: 50 max connections, 60s keepAlive, 100 max cached TLS sessions
- Pools closed gracefully on shutdown via `closeAllClients()`

**Concurrency Control:**
- `ConcurrencyLimiter` limits concurrent requests per provider (default 25)
- Semaphore-based queuing prevents overwhelming providers
- Both streaming and non-streaming requests acquire permits

### Configuration Files

**`config/routes.yaml`**: Model slot mappings
```yaml
model_slots:
  default:
    provider: "openrouter"
    model: "anthropic/claude-sonnet-4"
proxy:
  fallback_to_default: false  # Strict mode
```

**`config/providers.yaml`**: Provider settings and capabilities
```yaml
providers:
  openai:
    base_url: "https://api.openai.com/v1"
    api_key_env: "OPENAI_API_KEY"
    allowed_fields: [model, messages, stream, temperature, ...]
    streaming_adapter: "none"
    default_timeout: 60s
    max_retries: 2
```

**`.env`**: API keys (not committed)
```
OPENAI_API_KEY=sk-proj-...
OPENROUTER_API_KEY=sk-or-...
ZAI_API_KEY=...
```

### Type Definitions

Key types in `src/types/config.ts`:
- `ChatCompletionRequest`: Incoming request schema with SkyrimNet-specific fields (`cache`, `top_k`, `route`, `reasoning`)
- `ProviderConfig`: Provider configuration including `allowed_fields` whitelist
- `RoutesConfig`: Model slots and proxy settings
- `ResolvedRoute`: Output from router containing provider, model, config

### Error Handling

- `RoutingError`: Thrown for unknown model aliases (statusCode 400)
- Upstream errors passed through with original status codes
- All errors returned as OpenAI-shaped JSON: `{error: {message, type, param}}`
- Error types: `invalid_request_error`, `api_error`, `rate_limit_error`

### Logging

Pino-based structured logging in `src/logging/logger.ts`:
- JSON lines format to `logs/proxy.log`
- API keys automatically redacted
- Levels: ERROR, WARN, INFO, DEBUG, TRACE
- Set level via `config/providers.yaml` → `proxy.log_level`

## Implementation Notes

### Adding a New Provider

1. Add provider to `config/providers.yaml` with `allowed_fields` whitelist
2. Add model slots in `config/routes.yaml` referencing the provider
3. Set API key in environment variable matching `api_key_env`
4. If provider needs custom field transformations, update `transformCacheField()` in `transformer.ts`

### Modifying Request Transformation

**Capability Filter:** Edit `applyCapabilityFilter()` in `transformer.ts` to change how fields are dropped.

**Cache Transform:** Edit `transformCacheField()` for provider-specific cache handling.

**New Field Support:** Add field to provider's `allowed_fields` in `config/providers.yaml`, then handle transformation logic if needed.

### Streaming Adapter

If a provider returns non-standard SSE format:
1. Set `streaming_adapter: "rewrite"` in provider config
2. Modify `handleStreaming()` in `src/proxy/streaming.ts` to parse and transform chunks

### Concurrency Limits

To adjust per-provider limits:
- Default is 25 concurrent requests per provider
- Modify `DEFAULT_MAX_CONCURRENT` in `src/proxy/concurrency.ts`

## TypeScript Configuration

- Target: ES2022
- Module: NodeNext (ESM with Node.js resolution)
- Strict mode enabled with additional safety flags
- Output: `dist/` directory
- Source maps enabled

## Code Style

- ESLint with TypeScript rules, Prettier integration
- Prettier: 100 char line width, 2 spaces, double quotes, semicolons
- No console allowed except `console.warn`/`console.error`
- Underscore prefix for intentionally unused variables

## Environment

- Node.js ESM modules (`"type": "module"` in package.json)
- Uses undici for HTTP (native Node.js fetch implementation)
- Configuration loaded from `config/` directory at startup
- Logs written to `logs/` directory (created on start if missing)
