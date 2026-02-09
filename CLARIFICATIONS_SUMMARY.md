# Implementation Plan Clarifications Summary

## Key Changes from User Feedback (v1.0 → v1.1)

### 1. Proxy as "Truth Layer" ✅
**What Changed:** Explicitly documented that the proxy handles ALL request mutations.

**Implementation:**
- Full JSON parse → modify → reserialize pipeline
- No byte-level manipulation
- Proxy receives complete HTTP request bodies at application layer
- SkyrimNetCacheFix DLL reduced to detection/logging only (or removed)

**Code Impact:**
```go
// Proxy transformation flow
func handleRequest(r *http.Request) {
    // 1. Parse complete JSON from request body
    var payload map[string]interface{}
    json.NewDecoder(r.Body).Decode(&payload)

    // 2. Modify based on provider capabilities
    payload = applyProviderFilter(payload, provider)

    // 3. Reserialize and send upstream
    cleanJSON, _ := json.Marshal(payload)
    sendUpstream(cleanJSON)
}
```

### 2. No WinHTTP Body-Write Ordering Assumptions ✅
**What Changed:** Clarified that proxy operates at application layer.

**Why It Matters:**
```
WinHTTP Pattern (SkyrimNet side):
  WinHttpSendRequest: Headers only
  WinHttpWriteData: Body sent separately

Proxy View (Application layer):
  HTTP Request: Complete headers + complete JSON body
```

**Result:** No need for byte-level surgery. The proxy sees fully-assembled requests.

### 3. Strict Model Slot Validation ✅
**What Changed:** Unknown model aliases return HTTP 400 (not silent fallback).

**Before:**
```
4. If still not found, use `default` slot  // Silent fallback
```

**After:**
```
4. If still not found:
   - Default: Return HTTP 400 with error
   - Optional: Set `fallback_to_default: true` to enable fallback
```

**Config:**
```yaml
proxy:
  fallback_to_default: false  # Strict mode (default)
```

**Error Response:**
```json
{
  "error": {
    "message": "Unknown model alias: creative_writing. Configure in routes.yaml or enable fallback_to_default.",
    "type": "invalid_request_error"
  }
}
```

**Benefit:** Typos and misconfigurations fail fast with clear error messages.

### 4. Capability Filter Per Provider ✅
**What Changed:** Added whitelist-based field filtering for each provider.

**Implementation:**
```yaml
providers:
  openai:
    allowed_fields:
      - model, messages, stream
      - temperature, max_tokens, top_p
      - frequency_penalty, presence_penalty
      - stop, n
    # All other fields dropped + logged

  openrouter:
    allowed_fields:
      # All OpenAI fields
      # Plus: cache, top_k, route, reasoning
```

**Drop Behavior:**
```
Field "cache" → OpenAI:
  - Not in allowed_fields
  - Drop from request
  - Log: "Dropped field 'cache' for provider 'openai' (not supported)"
  - Continue processing (no error)
```

**Benefit:** Prevents random SkyrimNet fields from breaking providers.

### 5. Streaming: Pass-Through Unless You Must Rewrite ✅
**What Changed:** Explicitly documented pass-through as default, with opt-in adapters.

**Default Behavior:**
```yaml
providers:
  openai:
    streaming_adapter: "none"  # Pass-through (default)
```

**Non-Standard Provider (Future):**
```yaml
providers:
  some_weird_provider:
    streaming_adapter: "rewrite"  # Enable buffering/transformation
```

**Implementation:**
```go
// Pass-through (default)
func handleStreaming(resp *http.Response, w http.ResponseWriter) {
    reader := sse.NewReader(resp.Body)
    for chunk := range reader.Chunks() {
        w.Write(chunk)  // Immediate relay, no transformation
    }
}

// With adapter (future)
func handleStreamingWithAdapter(resp *http.Response, w http.ResponseWriter) {
    // Parse, transform, rewrite SSE chunks
    // Higher latency, but enables compatibility
}
```

**Benefit:** Lowest latency for standard providers, flexibility for edge cases.

## Configuration Example: Updated for v1.1

### config/routes.yaml
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

  # ... other slots

proxy:
  fallback_to_default: false  # Strict validation (NEW)
```

### config/providers.yaml
```yaml
providers:
  openai:
    base_url: "https://api.openai.com/v1"
    api_key_env: "OPENAI_API_KEY"
    auth_header: "Authorization: Bearer ${API_KEY}"
    allowed_fields:              # NEW: Capability filter
      - model, messages, stream
      - temperature, max_tokens, top_p
      - frequency_penalty, presence_penalty
      - stop, n
    streaming_adapter: "none"    # NEW: Pass-through default
    default_timeout: 60s
    max_retries: 2

  openrouter:
    base_url: "https://openrouter.ai/api/v1"
    api_key_env: "OPENROUTER_API_KEY"
    auth_header: "Authorization: Bearer ${API_KEY}"
    allowed_fields:              # NEW: Capability filter
      - model, messages, stream
      - temperature, max_tokens, top_p
      - frequency_penalty, presence_penalty
      - stop, n
      - cache, top_k, route, reasoning
    streaming_adapter: "none"    # NEW: Pass-through default
    default_timeout: 120s
    max_retries: 3
```

## Implementation Priority

### Phase 1: Core Proxy (MVP)
1. ✅ HTTP server listening on 127.0.0.1:35791
2. ✅ JSON parse → modify → reserialize pipeline
3. ✅ Model slot routing with strict validation
4. ✅ Provider capability filtering
5. ✅ Non-streaming requests

### Phase 2: Streaming Support
1. ✅ SSE pass-through for all providers
2. ✅ Chunk-by-chunk relay
3. ✅ `[DONE]` terminator handling

### Phase 3: Validation & Testing
1. ✅ SkyrimNetCacheFix DLL for detection/logging only
2. ✅ Confirm proxy receives correct payloads
3. ✅ Test all 8-10 model slots
4. ✅ Remove DLL once proxy validated

### Phase 4: Future Enhancements
- ⏳ Per-provider streaming adapters (if needed)
- ⏳ Metrics endpoint
- ⏳ Hot config reload

## Decision Checklist

All requested clarifications addressed:

- [x] **Proxy as truth layer:** All mutation in proxy via JSON parse/modify/reserialize
- [x] **DLL limited scope:** Detection/logging only, remove once proxy works
- [x] **No WinHTTP assumptions:** Proxy receives complete bodies at application layer
- [x] **8-10 model slots:** Explicit slot names, strict validation (400 on unknown)
- [x] **Capability filter:** Provider whitelists, drop unknown fields with debug log
- [x] **Streaming pass-through:** Default behavior, per-provider adapter flag available

---

**Last Updated:** 2026-02-07
**Status:** Implementation Ready
