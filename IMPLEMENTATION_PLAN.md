# SkyrimNet Provider-Router Proxy: Implementation Plan

## Change Log

**v1.1 (2026-02-07) - Key Clarifications:**
- ✅ Proxy is the "truth layer" - all request mutation via full JSON parse → modify → reserialize
- ✅ SkyrimNetCacheFix DLL limited to detection/logging only (remove once proxy validated)
- ✅ Unknown model aliases treated as config errors (400) unless `fallback_to_default` enabled
- ✅ Added capability filter: provider-specific whitelists, drop unknown fields with debug log
- ✅ Streaming: pass-through by default, per-provider adapter flag for non-standard SSE
- ✅ Clarified proxy receives complete HTTP bodies (no WinHTTP body-write ordering issues)

**v1.0 (2026-02-07) - Initial Release:**
- Complete request/response contract specification
- 8-10 model slot routing configuration
- Provider compatibility matrix (OpenAI, OpenRouter, z.ai)
- Transformation rules and field handling
- Transport strategy and operational plan
- Acceptance tests and troubleshooting guide

## Executive Summary

A local HTTP proxy that sits between SkyrimNet (localhost:8080) and upstream OpenAI-compatible providers. The proxy normalizes requests, routes model aliases to configured providers, transforms provider-specific payloads, and maintains streaming compatibility.

---

## 1. Request/Response Contract

### 1.1 Inbound Request (from SkyrimNet)

The proxy MUST accept requests matching this contract at `/v1/chat/completions`:

**HTTP Method:** `POST`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <skyrimnet_provided_key>
```

**Request Body Schema:**
```json
{
  "model": "string",           // Model alias or direct model name
  "messages": [                // Standard OpenAI format
    {
      "role": "system|user|assistant",
      "content": "string"
    }
  ],
  "stream": boolean,           // true for SSE streaming
  "temperature": number,       // Optional, 0-2
  "max_tokens": number,        // Optional
  "top_p": number,             // Optional
  "frequency_penalty": number, // Optional
  "presence_penalty": number,  // Optional

  // SkyrimNet-specific nonstandard fields
  "cache": boolean|object,     // Provider-specific caching control
  "top_k": number,             // Alternative to top_p for some providers
  "route": string,             // OpenRouter-specific routing hint
  "reasoning": {               // Reasoning/extended thinking
    "enabled": boolean
  }
}
```

**Key Constraint:** SkyrimNet may send `cache` as boolean or object. Must detect type and handle accordingly.

### 1.2 Response Contract (Non-Streaming)

**Status Codes:**
- `200` - Success
- `400` - Invalid request (malformed JSON, validation failed)
- `401` - Upstream auth failure (proxy passes through)
- `429` - Rate limit from upstream
- `500` - Internal proxy error
- `502` - Upstream unavailable
- `503` - Timeout

**Success Response Body:**
```json
{
  "id": "chatcmpl-<uuid>",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "string",           // Echo back requested model
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "string"
      },
      "finish_reason": "stop|length|content_filter"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

### 1.3 Streaming Response Contract

**Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**SSE Format:**
```
data: {"id":"chatcmpl-<uuid>","object":"chat.completion.chunk","created":1234567890,"model":"<model>","choices":[{"index":0,"delta":{"content":"..."}}]}

data: [DONE]
```

**Streaming Invariants:**
- Each chunk must be valid JSON
- Final chunk is literal `[DONE]`
- Delta fields accumulate: `{"content": "text"}` adds to previous content
- Must preserve SSE double-newline format between chunks

---

## 2. Routing Model

### 2.1 Model Alias Configuration

**SkyrimNet Model Slots Reality:** SkyrimNet's UI exposes 8-10 model slots for different features (default conversation, creative writing, code generation, etc.). The proxy must map these slots to provider/model combinations.

**Standardized Slot Names:**

Use these aliases consistently in SkyrimNet's UI and proxy config:
- `default` - Primary conversation model
- `creative` - Creative writing mode
- `factual` - Factual/query mode
- `fast` - Low-latency responses
- `reasoning` - Extended thinking
- `code` - Code generation
- `roleplay` - Roleplay/immersion mode
- `fallback` - Emergency fallback

**Configuration File Structure:** `config/routes.yaml`

```yaml
# Model slot mappings (8-10 slots typical for SkyrimNet)
model_slots:
  # Default conversation model
  default:
    provider: "openrouter"
    model: "anthropic/claude-sonnet-4"

  # Creative writing mode
  creative:
    provider: "zai"
    model: "claude-sonnet-4-20250514"

  # Factual/query mode
  factual:
    provider: "openai"
    model: "gpt-4o"

  # Fast/low-latency
  fast:
    provider: "openrouter"
    model: "openai/gpt-4o-mini"

  # Extended reasoning
  reasoning:
    provider: "openrouter"
    model: "anthropic/claude-sonnet-4"
    enable_reasoning: true

  # Code generation
  code:
    provider: "zai"
    model: "gpt-4o-2024-11-20"

  # Roleplay mode
  roleplay:
    provider: "openrouter"
    model: "anthropic/claude-sonnet-4"

  # Emergency/fallback
  fallback:
    provider: "openai"
    model: "gpt-4o-mini"
```

**Configuration Checklist:**
- [ ] All 8-10 SkyrimNet model slots have corresponding entries in `routes.yaml`
- [ ] Slot names match exactly (SkyrimNet UI shows what it sends)
- [ ] Each slot has valid `provider` and `model`
- [ ] No orphaned or undefined slots

### 2.2 Provider Configuration

**Configuration File:** `config/providers.yaml`

```yaml
providers:
  openrouter:
    base_url: "https://openrouter.ai/api/v1"
    api_key_env: "OPENROUTER_API_KEY"
    auth_header: "Authorization: Bearer ${API_KEY}"
    supports_streaming: true
    supports_cache: true      # cache as object
    supports_top_k: true
    supports_route: true
    supports_reasoning: true  # via reasoning field
    default_timeout: 120s
    max_retries: 3

  openai:
    base_url: "https://api.openai.com/v1"
    api_key_env: "OPENAI_API_KEY"
    auth_header: "Authorization: Bearer ${API_KEY}"
    supports_streaming: true
    supports_cache: false     # Drop cache field
    supports_top_k: false     # Drop top_k field
    supports_route: false     # Drop route field
    supports_reasoning: false # Drop reasoning field
    default_timeout: 60s
    max_retries: 2

  zai:
    base_url: "https://api.z.ai/v1"
    api_key_env: "ZAI_API_KEY"
    auth_header: "Authorization: Bearer ${API_KEY}"
    supports_streaming: true
    supports_cache: true      # cache as boolean
    supports_top_k: true
    supports_route: false     # Drop route field
    supports_reasoning: false # Drop reasoning field
    default_timeout: 90s
    max_retries: 3
```

### 2.3 Routing Resolution Logic

**Algorithm:**

1. Extract `model` field from incoming request
2. Lookup `model` in `model_slots` config
3. If not found, check if `model` matches direct provider/model pattern (`provider:model`)
4. If still not found:
   - **Default behavior:** Return HTTP 400 with error `"Unknown model alias: <model>. Configure in routes.yaml or enable fallback_to_default."`
   - **Optional fallback:** If `fallback_to_default: true` is set in proxy config, route to `default` slot and log WARNING
5. Load provider config from resolved provider
6. Merge slot-level overrides with provider defaults
7. Execute transformation layer
8. Dispatch to upstream

**Direct Model Override Syntax:**

SkyrimNet can specify `openai:gpt-4o` to bypass slots and route directly.

**Config-Based Fallback (Optional):**

```yaml
proxy:
  fallback_to_default: false  # Default: false (strict mode)
```

**Rationale for Strict Default:**
- Silent fallback makes debugging miserable
- Typos in model names go undetected
- Forces explicit configuration of all SkyrimNet model slots
- Clear error messages guide users to fix configuration

---

## 3. Provider Compatibility Matrix

### 3.1 Field Support Summary

| Field | OpenAI | OpenRouter | z.ai | Transform Rule |
|-------|--------|------------|------|----------------|
| `cache` (bool) | ❌ Drop | ⚠️ Convert to object | ✅ Pass | Type-dependent |
| `cache` (obj) | ❌ Drop | ✅ Pass | ❌ Convert to bool | Type-dependent |
| `top_k` | ❌ Drop | ✅ Pass | ✅ Pass | Drop if unsupported |
| `route` | ❌ Drop | ✅ Pass | ❌ Drop | Provider-specific |
| `reasoning.enabled` | ❌ Drop | ✅ Pass via `reasoning` | ❌ Drop | Provider-specific |
| `stream` | ✅ Pass | ✅ Pass | ✅ Pass | Universal |
| Standard OpenAI fields | ✅ Pass | ✅ Pass | ✅ Pass | Universal |

### 3.2 OpenAI Compatibility

**Base URL:** `https://api.openai.com/v1`

**Auth:** `Authorization: Bearer sk-...`

**Streaming Format:** Standard SSE with `data: JSON` lines

**Field Transformations:**
```
INBOUND:
  - Remove: cache, top_k, route, reasoning
  - Pass-through: all standard fields

OUTBOUND:
  - Direct passthrough of upstream response
  - No modification needed
```

**Caveats:**
- No native support for alternative sampling (top_k)
- No caching controls
- Strictest field compatibility

### 3.3 OpenRouter Compatibility

**Base URL:** `https://openrouter.ai/api/v1`

**Auth:** `Authorization: Bearer sk-or-...`

**Streaming Format:** Standard SSE

**Field Transformations:**
```
INBOUND:
  - cache: Accept both bool and object
    * bool true → {"type": "random", "max_age": 300}
    * bool false → Drop field
    * object → Pass through as-is
  - top_k: Pass through
  - route: Pass through
  - reasoning: Pass through as-is

OUTBOUND:
  - Direct passthrough
  - May include OpenRouter metadata (X fields)
```

**Caveats:**
- Supports richest feature set
- May return `X-*` headers (pass through or strip based on config)

### 3.4 z.ai Compatibility

**Base URL:** `https://api.z.ai/v1`

**Auth:** `Authorization: Bearer <zai-key>`

**Streaming Format:** Standard SSE (verify in testing)

**Field Transformations:**
```
INBOUND:
  - cache: Convert object to bool
    * {"type": "random"} → true
    * {"type": "none"} → false
    * boolean → Pass through as-is
  - top_k: Pass through
  - route: Remove (not supported)
  - reasoning: Remove

OUTBOUND:
  - Direct passthrough
```

**Caveats:**
- Documented field support may be incomplete; verify via testing
- `cache` semantic may differ (enables server-side caching)

---

## 4. Transformation Rules

### 4.1 Core Principle: Proxy as "Truth Layer"

**Critical Design Decision:** All request mutation happens in the proxy via full JSON parse → modify → reserialize. The SkyrimNetCacheFix DLL should be limited to detection/logging only (or removed entirely once the proxy is working).

**Why the Proxy is the Truth Layer:**
- SkyrimNet sends complete HTTP request bodies at the application layer
- The proxy receives fully-assembled requests (no WinHTTP body-write ordering issues)
- Full JSON parsing ensures type safety and prevents serialization bugs
- Clean separation: proxy handles transformation, DLL only observes if needed

**DLL Scope (If Used):**
- Detection: Log outbound requests for debugging
- Logging: Write payloads to disk for analysis
- **NOT:** Byte-level surgery, JSON manipulation, or HTTP injection
- **Recommendation:** Remove DLL entirely once proxy is validated

### 4.2 Request Transformation Pipeline

**Order of Operations:**

1. **JSON Parse & Validate**
   - Parse request body with strict JSON parsing
   - Validate required fields (model, messages)
   - Return 400 if invalid

2. **Model Resolution**
   - Resolve model alias to provider + upstream model
   - Load provider capabilities

3. **Capability Filter & Transform**
   - Apply provider's allowed fields whitelist
   - Remove unsupported fields per provider
   - Transform `cache` field based on type + provider

4. **JSON Reserialization**
   - Use deterministic JSON library (no trailing commas)
   - Validate output is parseable with `JSON.parse(JSON.stringify(payload))`
   - Log transformed payload at DEBUG level (redacted)

5. **Upstream Dispatch**
   - Construct provider-specific request
   - Apply auth headers
   - Execute with timeout

### 4.2 Cache Field Transformation Logic

**Decision Table:**

| Provider | Input Type | Action |
|----------|------------|--------|
| OpenAI | Any | Drop field |
| OpenRouter | `boolean` | `true` → `{"type":"random","max_age":300}`, `false` → drop |
| OpenRouter | `object` | Pass through |
| z.ai | `boolean` | Pass through |
| z.ai | `object` | Extract `type`: `"random"` → `true`, `"none"`/other → `false` |

**Implementation Notes:**
- Check `typeof request.cache === 'boolean'` vs `typeof request.cache === 'object'`
- For OpenRouter object passthrough, validate structure has `type` field
- For z.ai, default to `false` if object parsing fails

### 4.3 Capability Filter: Allowed Fields Per Provider

**Design Principle:** Each provider has a whitelist of allowed fields. Everything else is dropped (with debug log). This prevents "random SkyrimNet fields" from breaking providers.

**Provider Capability Sets:**

```yaml
# OpenAI - Strictest compatibility
openai_allowed_fields:
  - model
  - messages
  - stream
  - temperature
  - max_tokens
  - top_p
  - frequency_penalty
  - presence_penalty
  - stop
  - n
# All other fields dropped, logged at DEBUG

# OpenRouter - Richest feature set
openrouter_allowed_fields:
  # All OpenAI fields
  - model
  - messages
  - stream
  - temperature
  - max_tokens
  - top_p
  - frequency_penalty
  - presence_penalty
  - stop
  - n
  # OpenRouter-specific
  - cache
  - top_k
  - route
  - reasoning

# z.ai - Middle ground
zai_allowed_fields:
  # All OpenAI fields
  - model
  - messages
  - stream
  - temperature
  - max_tokens
  - top_p
  - frequency_penalty
  - presence_penalty
  - stop
  - n
  # z.ai-supported
  - cache
  - top_k
# All other fields dropped, logged at DEBUG
```

**Drop Behavior:**
```
Field not in allowed_set:
  - Remove field from request object
  - Log at DEBUG: "Dropped field 'X' for provider 'Y' (not supported)"
  - Continue processing (no error)
```

**Pass-Through (Base Fields - All Providers):**
- `model`, `messages`, `stream`, `temperature`, `max_tokens`
- `top_p`, `frequency_penalty`, `presence_penalty`
- `stop`, `n` (standard OpenAI fields)

**Conditional Fields (Per-Provider):**
- `cache`: OpenRouter (object), z.ai (boolean), dropped for OpenAI
- `top_k`: OpenRouter, z.ai, dropped for OpenAI
- `route`: OpenRouter only
- `reasoning`: OpenRouter only

**Unknown Field Handling:**
```
New SkyrimNet field "unknown_field":
  - Check if in provider's allowed_fields
  - If not: Drop and log "Field 'unknown_field' not in allowed set for provider X"
  - If yes: Pass through (future-proofing)
```

### 4.4 JSON Validation Rules

**Anti-Pattern (The "Missing Comma Bug"):**
```json
{"model": "gpt-4", "messages": []}
//         ^-- Missing comma after value if manually constructing
```

**Safe Construction:**
1. Always use a JSON library (never string concatenation)
2. Before sending upstream: `JSON.parse(JSON.stringify(payload))`
3. On upstream response: `JSON.parse(responseBody)`
4. If parse fails: Return 500 with error details (logged)

**Validation Checklist:**
- [ ] All strings properly quoted
- [ ] No trailing commas in objects/arrays
- [ ] Valid UTF-8 encoding
- [ ] Number fields are actual numbers (not strings)
- [ ] Boolean fields are true/false (not strings)

### 4.5 SkyrimNetCacheFix DLL Scope (If Used)

**Recommendation:** Remove the DLL entirely once the proxy is validated. The proxy is the "truth layer" and handles all request transformations.

**If DLL Must Be Used (Limited Scope):**

**DLL Should:**
```
✓ Detection: Log outbound HTTP requests for debugging
✓ Logging: Write payloads to disk for analysis
✓ Observation: Record what SkyrimNet sends
✓ Validation: Verify proxy is receiving correct data
```

**DLL Should NOT:**
```
✗ Byte-level surgery on HTTP bodies
✗ JSON manipulation or mutation
✗ HTTP header injection
✗ Request/response modification
✗ Any transformation logic
```

**Why DLL Should Be Removed:**
- Proxy handles all transformations at application layer
- DLL byte manipulation is brittle and error-prone
- WinHTTP body-write ordering doesn't matter at application layer
- Clean separation of concerns: SkyrimNet → Proxy → Upstream

**Transition Path:**
1. Phase 1: Use DLL for detection/logging, validate proxy receives requests correctly
2. Phase 2: Confirm proxy transforms work for all providers
3. Phase 3: Remove DLL, deploy proxy-only solution

---

## 5. Transport Strategy

### 5.1 HTTP Client Selection

**Recommendation:** Use native Windows HTTP APIs to avoid libcurl compatibility issues.

**Critical Note: The Proxy Receives Complete Request Bodies**

The proxy operates at the application layer and receives fully-assembled HTTP requests from SkyrimNet. This means:

```
SkyrimNet (WinHTTP) → Proxy (Application Layer)
  ├─ Headers: Received as complete HTTP header block
  └─ Body: Received as complete JSON string
```

**Why This Matters:**

The observed WinHTTP log pattern:
```
WinHttpSendRequest: "No body with SendRequest"
then
WinHttpWriteData: body appears later
```

This is WinHTTP's two-phase write pattern (headers first, body in separate call). **The proxy does not see this.** The proxy receives the complete, assembled HTTP request after SkyrimNet's HTTP client has done its work. Therefore:

- No byte-level surgery is needed
- No body-write ordering assumptions
- The proxy sees valid JSON as a complete string
- Safe to parse, modify, and reserialize

**Options Analysis:**

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| libcurl | Feature-rich, widely used | Binary compat issues on Windows, may fail in some Skyrim environments | ⚠️ Avoid |
| WinHTTP (native) | Windows built-in, stable, no external deps | Windows-only | ✅ Preferred |
| WinINet | IE caching/integration, deprecated | Deprecated, unpredictable caching | ❌ Avoid |
| .NET HttpClient | High-level, easy async | Requires .NET runtime | ✅ Alternative |
| node-fetch | Node ecosystem | Requires Node.js runtime | ⚠️ If using Node |

**Recommended Implementation:**

**Option A (Go):** Use `net/http` with default transport (uses WinHTTP on Windows via syscalls)

**Option B (Node.js):** Use native `fetch` API (Node 18+) or `axios` with `http.agent` config

**Option C (Python):** Use `httpx` with default transport (avoids `requests`/urllib3 issues)

**Option D (C#):** Use `HttpClient` with `WinHttpHandler`

### 5.2 Connection Pooling

**Configuration:**
```
MaxIdleConns: 100
MaxIdleConnsPerHost: 10
IdleConnTimeout: 90s
TLSHandshakeTimeout: 10s
ExpectContinueTimeout: 1s
```

**Rationale:** SkyrimNet may send multiple rapid requests (different model slots). Pooling reduces latency.

### 5.3 Timeout Strategy

**Layered Timeouts:**
```
Total request timeout: 120s (configurable per provider)
  ├─ Dial timeout: 10s
  ├─ TLS handshake: 10s
  ├─ First byte: 30s
  └─ Chunk timeout: 10s between SSE chunks (streaming)
```

**Behavior on Timeout:**
- Log timeout with provider, model, elapsed time
- Return 504 Gateway Timeout to SkyrimNet
- Do not retry automatically (let SkyrimNet retry)

---

## 6. Operational Plan

### 6.1 HTTP vs HTTPS Decision

**Recommendation:** HTTP for local proxy listener, HTTPS for upstream.

**Local Listener:**
```
Protocol: HTTP (not HTTPS)
Port: 35791 (configurable, unused high port)
Bind: 127.0.0.1 only (loopback only, no external exposure)
```

**Rationale:**
- SkyrimNet → Proxy traffic is local-only (127.0.0.1)
- No certificate management overhead
- Lower latency (no TLS handshake on localhost)

**Alternative (if SkyrimNet requires HTTPS):**
```
Protocol: HTTPS
Port: 35792
Certificate: Self-signed
Cert Strategy: Generate on startup, auto-import to Windows Trusted Root store
```

**Self-Signed Cert Import Logic:**
1. Generate cert on first startup using OpenSSL or Windows native cert generation
2. Save to `config/proxy.crt` and `config/proxy.key`
3. Execute PowerShell command to import to Trusted Root Certification Authorities
4. Start HTTPS listener
5. On subsequent startups: Load existing cert

**PowerShell Import Command:**
```powershell
certutil -addstore "Root" C:\SkyrimnetProxy\config\proxy.crt
```

### 6.2 Logging Strategy

**Log Levels:**
```
ERROR: Failed requests, proxy crashes, upstream 5xx
WARN: Retries, timeouts, config parsing errors
INFO: Startup, shutdown, request summaries (model, provider, latency)
DEBUG: Full request/response payloads (redacted)
TRACE: Connection lifecycle, internal state changes
```

**Redaction Rules:**
```
ALWAYS REDACT:
  - API keys (Authorization header, api_key fields)
  - Message content containing secrets (heuristic: patterns like "sk-...", password, token)
  - PII (email addresses, phone numbers, SSN) - optional regex redaction

PRESERVE:
  - Model names
  - Field structure
  - Token counts
  - Latency metrics
```

**Log Format:** JSON lines (for machine parsing)
```json
{"timestamp":"2026-02-07T12:34:56Z","level":"INFO","provider":"openrouter","model":"claude-sonnet-4","latency_ms":1234,"tokens":{"prompt":10,"completion":20}}
```

**Log Rotation:**
```
Max file size: 100MB
Max files: 10
Compress old files: gzip
```

### 6.3 Metrics Collection

**Expose:** HTTP metrics endpoint at `http://127.0.0.1:35791/metrics` (Prometheus format)

**Metrics:**
```
# Request counters
skyrimnet_proxy_requests_total{provider, model, status} 1234
skyrimnet_proxy_streaming_requests_total{provider} 567

# Latency histograms
skyrimnet_proxy_request_duration_seconds{provider} 0.5 1.0 2.5

# Error rates
skyrimnet_proxy_errors_total{provider, error_type} 12

# Upstream health
skyrimnet_proxy_upstream_health{provider} 1.0  # 0-1 score
```

**Health Check:** `GET /healthz` returns 200 if proxy is responsive

### 6.4 Retry Strategy

**Retry Rules:**
```
Retryable status codes: 408, 429, 500, 502, 503, 504
Retryable network errors: DNS failure, connection refused, timeout
Max retries: per-provider config (default 3)
Backoff: Exponential with jitter
  Initial: 1s
  Multiplier: 2
  Max: 10s
  Jitter: ±20%
```

**Non-Retryable:**
- 400 Bad Request (client error)
- 401 Unauthorized (API key invalid)
- 403 Forbidden
- Any error with valid upstream response body

**Retry Payload:** Use original request (re-read from disk or cache in memory if streaming)

### 6.5 Failure Handling

**SkyrimNet Error Response Format:**
```json
{
  "error": {
    "message": "Human-readable error message",
    "type": "invalid_request_error|api_error|rate_limit_error",
    "param": null,
    "code": "error_code_optional"
  }
}
```

**Error Type Mapping:**
```
Proxy failure → "api_error"
Upstream 5xx → "api_error" (with upstream message)
Upstream 429 → "rate_limit_error"
Upstream 400/401/403 → Pass through upstream error
Timeout → "api_error" with "timeout" message
JSON parse error → "invalid_request_error"
```

**Graceful Degradation:**
- If provider unreachable: Try fallback provider if configured
- If config invalid: Log error, return 500, do not start proxy
- If missing provider config: Use default provider, log warning

---

## 7. Acceptance Tests

### 7.1 Smoke Test: Non-Streaming Chat Completion

**Setup:**
```yaml
# config/routes.yaml
model_slots:
  test_default:
    provider: "openai"
    model: "gpt-4o-mini"

# config/providers.yaml
providers:
  openai:
    api_key_env: "OPENAI_API_KEY"
    base_url: "https://api.openai.com/v1"
```

**Test Request:**
```bash
curl -X POST http://127.0.0.1:35791/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dummy_key" \
  -d '{
    "model": "test_default",
    "messages": [{"role": "user", "content": "Say hello"}]
  }'
```

**Expected Result:**
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "test_default",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "Hello!"},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
}
```

**Success Criteria:**
- [ ] HTTP 200 status
- [ ] Response includes `id`, `choices`, `usage`
- [ ] `content` field is non-empty string
- [ ] Logs show request routed to OpenAI

### 7.2 Streaming Test

**Test Request:**
```bash
curl -X POST http://127.0.0.1:35791/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dummy_key" \
  -N \
  -d '{
    "model": "test_default",
    "messages": [{"role": "user", "content": "Count to 5"}],
    "stream": true
  }'
```

**Expected Result (SSE stream):**
```
data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"1"}}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" 2"}}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" 3"}}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" 4"}}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" 5"}}]}

data: [DONE]
```

**Success Criteria:**
- [ ] Content-Type is `text/event-stream`
- [ ] Multiple SSE chunks arrive (not one big chunk)
- [ ] Final chunk is literal `[DONE]`
- [ ] Accumulated content forms coherent response
- [ ] No chunk delay > 2 seconds

**Automation Test:** Measure time between first chunk and last chunk. Should be >0 seconds.

### 7.3 Model Switching Test

**Setup:**
```yaml
model_slots:
  test_openai:
    provider: "openai"
    model: "gpt-4o-mini"

  test_openrouter:
    provider: "openrouter"
    model: "openai/gpt-4o-mini"

  test_zai:
    provider: "zai"
    model: "gpt-4o-mini"
```

**Test Procedure:**
1. Send request with `model: "test_openai"`
2. Verify response (check logs for "provider: openai")
3. Send request with `model: "test_openrouter"`
4. Verify response (check logs for "provider: openrouter")
5. Send request with `model: "test_zai"`
6. Verify response (check logs for "provider: zai")

**Success Criteria:**
- [ ] All three requests succeed
- [ ] Logs show correct provider for each
- [ ] Response models match expected upstream models
- [ ] Latencies differ by provider (shows actual routing occurred)

### 7.4 Compatibility Test: Cache/TopK/Route/Reasoning

**Test Request 1: OpenRouter (supports all)**
```bash
curl -X POST http://127.0.0.1:35791/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test_openrouter",
    "messages": [{"role": "user", "content": "Test"}],
    "cache": {"type": "random", "max_age": 300},
    "top_k": 40,
    "route": "fallback",
    "reasoning": {"enabled": false}
  }'
```

**Expected:** Request succeeds, fields present in upstream payload

**Test Request 2: OpenAI (drops all)**
```bash
curl -X POST http://127.0.0.1:35791/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test_openai",
    "messages": [{"role": "user", "content": "Test"}],
    "cache": true,
    "top_k": 40,
    "route": "fallback",
    "reasoning": {"enabled": true}
  }'
```

**Expected:** Request succeeds, fields removed from upstream payload (verify in debug logs)

**Test Request 3: Cache Type Conversion (z.ai)**
```bash
# Object cache → boolean conversion
curl -X POST http://127.0.0.1:35791/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test_zai",
    "messages": [{"role": "user", "content": "Test"}],
    "cache": {"type": "random"}
  }'

# Boolean cache passthrough
curl -X POST http://127.0.0.1:35791/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test_zai",
    "messages": [{"role": "user", "content": "Test"}],
    "cache": false
  }'
```

**Expected:** Both succeed, upstream receives boolean `cache` field

**Success Criteria:**
- [ ] All requests complete without error
- [ ] Debug logs show field transformations occurred
- [ ] Upstream receives correct field types per provider
- [ ] No JSON serialization errors in logs

### 7.5 Failure Mode Tests

**Test A: Invalid JSON**
```bash
curl -X POST http://127.0.0.1:35791/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "incomplete'
```

**Expected:** HTTP 400, error message "Invalid JSON"

**Test B: Unknown Model**
```bash
curl -X POST http://127.0.0.1:35791/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "unknown_model_x", "messages": []}'
```

**Expected:** HTTP 400 or routes to default provider (configurable)

**Test C: Upstream Timeout**
- Configure provider with 1s timeout
- Send request that takes >1s
- Verify proxy returns 504 or 500 (not hang indefinitely)

**Test D: Invalid API Key**
- Use invalid key in provider config
- Send request
- Verify 401 passed through from upstream

---

## 8. Implementation Technology Stack Recommendation

### 8.1 Recommended Stack: Go

**Rationale:**
- Single binary deployment (no runtime dependency)
- Excellent HTTP server (`net/http`)
- Native TLS support
- Strong JSON library (`encoding/json`)
- Cross-platform compilation (Windows target from any dev machine)
- Easy service/exe packaging

**Dependencies:**
```
- yaml: gopkg.in/yaml.v3 (config parsing)
- httputil: net/http/httputil (reverse proxy primitives)
- testify: github.com/stretchr/testify (testing)
```

**Project Structure:**
```
C:\SkyrimnetProxy\
├── main.go                 # Entry point
├── config\
│   ├── config.go          # Config loading
│   ├── routes.yaml        # Model slot mappings
│   └── providers.yaml     # Provider configs
├── proxy\
│   ├── server.go          # HTTP server
│   ├── handler.go         # Request handler
│   ├── router.go          # Model routing logic
│   ├── transformer.go     # Request/response transforms
│   └── client.go          # Upstream HTTP client
├── providers\
│   ├── openai.go          # OpenAI-specific logic
│   ├── openrouter.go      # OpenRouter-specific logic
│   └── zai.go             # z.ai-specific logic
├── logging\
│   └── logger.go          # Structured logging
└── metrics\
    └── metrics.go         # Prometheus metrics
```

### 8.2 Alternative Stack: Node.js

**Use if:** Prefer JavaScript/TypeScript ecosystem, lower barrier to modifications

**Trade-offs:**
- ✅ Easier JSON handling
- ✅ Rich streaming libraries
- ✅ Faster development iterations
- ❌ Requires Node.js runtime on gaming PC
- ❌ Higher memory footprint

### 8.3 Alternative Stack: Python

**Use if:** Team prefers Python, need rapid prototyping

**Trade-offs:**
- ✅ Fast development
- ✅ Rich async ecosystem (httpx, aiohttp)
- ❌ Requires Python runtime
- ❌ Windows executable packaging (PyInstaller) can be fragile

### 8.4 Build & Deployment

**Go Build Command:**
```bash
# Build for Windows
GOOS=windows GOARCH=amd64 go build -o SkyrimNetProxy.exe

# Optional: Embed config files
go embed config/
```

**Deployment Steps:**
1. Create directory: `C:\SkyrimnetProxy\`
2. Place executable: `SkyrimNetProxy.exe`
3. Create config files from templates
4. Set environment variables for API keys
5. Run: `.\SkyrimNetProxy.exe`
6. Configure SkyrimNet: Base URL `http://127.0.0.1:35791`, API Key `dummy`

**Windows Service Installation (Optional):**
```powershell
# Use NSSM (Non-Sucking Service Manager)
nssm install SkyrimNetProxy "C:\SkyrimnetProxy\SkyrimNetProxy.exe"
nssm start SkyrimNetProxy
```

---

## 9. Configuration File Templates

### 9.1 Minimal Working Config

**config/routes.yaml**
```yaml
model_slots:
  default:
    provider: "openai"
    model: "gpt-4o-mini"
```

**config/providers.yaml**
```yaml
providers:
  openai:
    base_url: "https://api.openai.com/v1"
    api_key_env: "OPENAI_API_KEY"
    auth_header: "Authorization: Bearer ${API_KEY}"
    supports_streaming: true
    supports_cache: false
    supports_top_k: false
    supports_route: false
    supports_reasoning: false
    default_timeout: 60s
    max_retries: 2
```

**Environment Variables:**
```bash
# Windows Command Prompt
set OPENAI_API_KEY=sk-proj-...

# Windows PowerShell
$env:OPENAI_API_KEY="sk-proj-..."
```

### 9.2 Full Multi-Provider Config

**config/routes.yaml**
```yaml
model_slots:
  default:
    provider: "openrouter"
    model: "anthropic/claude-sonnet-4"

  creative:
    provider: "zai"
    model: "claude-sonnet-4-20250514"

  factual:
    provider: "openai"
    model: "gpt-4o"

  fast:
    provider: "openrouter"
    model: "openai/gpt-4o-mini"
```

**config/providers.yaml**
```yaml
providers:
  openrouter:
    base_url: "https://openrouter.ai/api/v1"
    api_key_env: "OPENROUTER_API_KEY"
    auth_header: "Authorization: Bearer ${API_KEY}"
    supports_streaming: true
    supports_cache: true
    supports_top_k: true
    supports_route: true
    supports_reasoning: true
    default_timeout: 120s
    max_retries: 3

  openai:
    base_url: "https://api.openai.com/v1"
    api_key_env: "OPENAI_API_KEY"
    auth_header: "Authorization: Bearer ${API_KEY}"
    supports_streaming: true
    supports_cache: false
    supports_top_k: false
    supports_route: false
    supports_reasoning: false
    default_timeout: 60s
    max_retries: 2

  zai:
    base_url: "https://api.z.ai/v1"
    api_key_env: "ZAI_API_KEY"
    auth_header: "Authorization: Bearer ${API_KEY}"
    supports_streaming: true
    supports_cache: true
    supports_top_k: true
    supports_route: false
    supports_reasoning: false
    default_timeout: 90s
    max_retries: 3

proxy:
  listen_address: "127.0.0.1:35791"
  log_level: "INFO"
  log_file: "logs/proxy.log"
  metrics_enabled: true
  metrics_port: 35792
```

---

## 10. Tradeoffs and Decisions

### 10.1 HTTP vs HTTPS for Local Listener

**Decision:** HTTP (not HTTPS)

**Tradeoff Analysis:**
```
HTTP Pros:
  + Zero certificate management
  + Lower latency (no TLS handshake)
  + Simpler configuration
  + Works on localhost without cert trust issues

HTTP Cons:
  - Plaintight on localhost (minor risk: only SkyrimNet connects)
  - SkyrimNet may require HTTPS (unconfirmed, needs testing)

HTTPS Pros:
  + Encrypted even if malware on localhost
  + Matches SkyrimNet's expectation if it requires HTTPS

HTTPS Cons:
  - Certificate generation and import complexity
  - May require Windows admin privileges for cert store
  - TLS overhead (minimal on localhost)
```

**Reversible Decision:** Can add HTTPS later if SkyrimNet requires it. Add config flag `tls_enabled: true`.

### 10.2 Hardcoded vs Configurable Model Slots

**Decision:** Configurable model slots in YAML

**Tradeoff Analysis:**
```
Configurable Pros:
  + Change routing without code changes
  + Support user customization
  + Easy testing of different providers
  + No recompilation needed

Configurable Cons:
  - Config parsing complexity
  - Potential for user error
  - Need validation logic

Hardcoded Pros:
  + Simpler code
  + No config validation needed
  + Compile-time safety

Hardcoded Cons:
  - Requires recompilation to change routing
  - Less flexible for users
```

**Decision Rationale:** SkyrimNet users may want to experiment with different models per feature. Configurable slots enable this without recompilation.

### 10.3 Strict vs Lenient JSON Parsing

**Decision:** Lenient for upstream, strict for outbound

**Tradeoff Analysis:**
```
Strict Upstream Parsing:
  + Catches provider malformation early
  + Fail-fast on unexpected responses
  - May break when providers add new fields
  - Higher maintenance burden

Lenient Upstream Parsing:
  + Resilient to provider changes
  + Pass through new fields automatically
  - May mask incompatible changes
  - Harder to debug if provider breaks
```

**Decision:** Parse upstream responses leniently (ignore unknown fields), validate response has required fields (`choices`, `id`). Log warnings for unknown fields.

### 10.4 Streaming Strategy: Pass-Through Unless You Must Rewrite

**Decision:** Immediate chunk-by-chunk SSE relay (pass-through by default)

**Implementation Approach:**
```
For standard SSE providers (OpenAI, OpenRouter, z.ai):
  ├─ Read SSE chunk from upstream
  ├─ Write chunk to SkyrimNet immediately
  ├─ No buffering, no transformation
  └─ Lowest possible latency

For non-standard providers (future):
  ├─ Enable per-provider streaming adapter
  ├─ Config flag: buffer_streaming: true
  ├─ Parse/transform/rewrite SSE chunks
  └─ Higher latency, but enables compatibility
```

**Tradeoff Analysis:**
```
Immediate Pass-Through:
  + Lowest latency (critical for real-time dialog)
  + Memory-efficient
  + Simple implementation
  - Can't transform streaming responses
  - Pass-through only

Buffered/Transformed:
  + Can modify streaming responses
  + Can normalize provider differences
  - Higher latency (defeats real-time dialog)
  - Higher memory usage
  - Complex SSE parsing/rewriting
```

**Decision Rationale:** SkyrimNet expects real-time streaming for natural dialog flow. Buffering would introduce perceptible delay. Start with pass-through and add per-provider adapters only if testing reveals incompatibilities.

**Provider Config Flag:**
```yaml
providers:
  openai:
    streaming_adapter: "none"  # Default: pass-through
  some_future_provider:
    streaming_adapter: "rewrite"  # Enable buffering/transformation
```

**When to Add a Streaming Adapter:**
- Provider returns non-standard SSE format (different from OpenAI)
- Provider requires transformation of streaming chunks
- Testing reveals SkyrimNet rejects the stream

**When Pass-Through Is Sufficient:**
- Provider follows OpenAI SSE format (most do)
- SkyrimNet accepts the stream as-is
- No transformation of streaming content needed

### 10.5 Retry on Specific Error Codes

**Decision:** Retry on 429, 500, 502, 503, 504 only

**Tradeoff Analysis:**
```
Aggressive Retry (include 4xx):
  + Recover from transient client errors
  - May amplify load if client is actually buggy
  - May delay real error feedback

Conservative Retry (5xx only):
  + Clear error on client bugs
  + Lower retry storm risk
  - May fail on recoverable 4xx (e.g., 429 rate limit)
```

**Decision:** Include 429 (rate limit) in retryable codes. Rate limits are transient and worth retrying with backoff.

### 10.6 Default Timeout Values

**Decision:** Provider-specific defaults (OpenAI: 60s, OpenRouter: 120s, z.ai: 90s)

**Rationale:**
- OpenAI: Generally fast, 60s covers most requests
- OpenRouter: May route to slower providers (Claude), 120s buffer
- z.ai: Unknown characteristics, 90s middle ground

**User Override:** Users can override in `providers.yaml` per provider.

---

## 11. Future Enhancements (Out of Scope for MVP)

### 11.1 Request Coalescing

If SkyrimNet sends identical requests concurrently (multiple model slots for same prompt), coalesce into single upstream request.

### 11.2 Response Caching

Cache responses locally (Redis or in-memory) for repeated prompts within time window.

### 11.3 Load Balancing

If provider has multiple base URLs (e.g., regional endpoints), load balance requests.

### 11.4 A/B Testing

Route percentage of traffic to different models for comparison.

### 11.5 Cost Tracking

Track token usage per provider, estimate costs, expose in metrics UI.

### 11.6 Config Hot Reload

Reload config files without restarting proxy (detect file changes).

### 11.7 Admin UI

Web UI at `http://127.0.0.1:35791` for config editing, metrics dashboard, log viewer.

---

## 12. Success Criteria

The proxy is successful when:

1. **SkyrimNet Integration:** SkyrimNet can be configured with Base URL `http://127.0.0.1:35791` and communicates without errors

2. **Model Slot Routing:** 8+ model slots route to different provider/model combinations

3. **Streaming Works:** Dialog responses stream in real-time without perceptible delay

4. **Field Compatibility:** Payloads with `cache`, `top_k`, `route`, `reasoning` fields work across all providers (via transformation)

5. **Config-Only Provider Changes:** Switching from OpenAI to OpenRouter requires only YAML config changes, no code changes

6. **Failure Recovery:** Upstream failures return OpenAI-shaped errors, allowing SkyrimNet to handle gracefully

7. **Observability:** Logs and metrics provide visibility into routing, latency, and errors

---

## Appendix A: OpenAI API Compatibility Reference

**Official Documentation:**
- OpenAI: https://platform.openai.com/docs/api-reference/chat/create
- OpenRouter: https://openrouter.ai/docs
- z.ai: Verify via API testing (docs may be incomplete)

**Key Differences:**
- OpenAI supports: `stream`, `temperature`, `top_p`, `max_tokens`
- OpenRouter adds: `cache`, `top_k`, `route`, `reasoning`, `models` (array)
- z.ai: Unknown, test empirically

---

## Appendix B: SkyrimNet Configuration Steps

1. Open SkyrimNet web UI at `http://localhost:8080`
2. Navigate to Settings / Model Configuration
3. Set "Base URL" to `http://127.0.0.1:35791`
4. Set "API Key" to `dummy` (proxy ignores this)
5. Configure model slots:
   - Default: `default`
   - Creative: `creative`
   - Factual: `factual`
   - (etc., matching `routes.yaml`)
6. Save and restart SkyrimNet

---

## Appendix C: Troubleshooting Checklist

**Problem:** SkyrimNet can't connect to proxy

**Checks:**
- [ ] Proxy is running (check process list)
- [ ] Proxy listening on 127.0.0.1:35791 (netstat -an)
- [ ] SkyrimNet Base URL is exactly `http://127.0.0.1:35791`
- [ ] Windows Firewall allows port 35791
- [ ] Proxy logs show incoming request

**Problem:** Request fails with 400

**Checks:**
- [ ] Model slot exists in `routes.yaml`
- [ ] Provider is configured in `providers.yaml`
- [ ] API key environment variable is set
- [ ] Request body is valid JSON (test with curl)

**Problem:** Streaming hangs or returns incomplete response

**Checks:**
- [ ] Upstream provider supports streaming (check provider config)
- [ ] Proxy logs show streaming chunks received
- [ ] Network connection is stable (check for packet loss)
- [ ] Timeout is long enough (increase `default_timeout`)

**Problem:** Upstream returns 401 Unauthorized

**Checks:**
- [ ] API key is correct (test with curl directly to provider)
- [ ] Environment variable is set before proxy starts
- [ ] No extra spaces in API key (common copy-paste error)

---

**Document Version:** 1.1
**Last Updated:** 2026-02-07
**Status:** Ready for Implementation
**Key Changes from v1.0:** Proxy-centric architecture, strict model validation, capability filtering, pass-through streaming
