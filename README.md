# SkyrimNet Proxy

A local HTTP proxy that sits between SkyrimNet and upstream OpenAI-compatible providers. The proxy normalizes requests, routes model aliases to configured providers, transforms provider-specific payloads, and maintains streaming compatibility.

## Features

- **Model Slot Routing**: Map SkyrimNet's 8-10 model slots to different providers and models
- **Provider Compatibility**: Supports OpenAI, OpenRouter, and z.ai with automatic field transformation
- **Streaming Support**: SSE pass-through for real-time dialog
- **Capability Filtering**: Provider-specific field whitelists prevent unsupported fields from causing errors
- **Strict Validation**: Unknown model aliases return HTTP 400 (configurable fallback)
- **Structured Logging**: JSON lines format with API key redaction

## Installation

```bash
npm install
npm run build
```

## Configuration

### 1. Set up API Keys

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Edit `.env`:
```
OPENAI_API_KEY=sk-proj-your-openai-key-here
OPENROUTER_API_KEY=sk-or-your-openrouter-key-here
ZAI_API_KEY=your-zai-key-here
```

### 2. Configure Model Slots

Edit `config/routes.yaml` to define model slots:

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
```

### 3. Configure Providers

Edit `config/providers.yaml` to set provider settings:

```yaml
providers:
  openai:
    base_url: "https://api.openai.com/v1"
    api_key_env: "OPENAI_API_KEY"
    default_timeout: 60s
```

## Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

The proxy will listen on `http://127.0.0.1:35791`.

## SkyrimNet Configuration

1. Open SkyrimNet web UI at `http://localhost:8080`
2. Navigate to Settings / Model Configuration
3. Set "Base URL" to `http://127.0.0.1:35791`
4. Set "API Key" to `dummy` (proxy ignores this)
5. Configure model slots using the aliases defined in `routes.yaml`:
   - Default: `default`
   - Creative: `creative`
   - Factual: `factual`
   - Fast: `fast`
   - Reasoning: `reasoning`
   - Code: `code`
   - Roleplay: `roleplay`
   - Fallback: `fallback`

## API Endpoints

### POST /v1/chat/completions

Standard OpenAI-compatible chat completions endpoint.

**Request:**
```json
{
  "model": "default",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false
}
```

**Response:**
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "default",
  "choices": [...],
  "usage": {...}
}
```

### GET /healthz

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1234567890
}
```

## Provider Compatibility

### Field Support Matrix

| Field | OpenAI | OpenRouter | z.ai |
|-------|--------|------------|------|
| `cache` (bool) | ❌ | ✅ | ✅ |
| `cache` (object) | ❌ | ✅ | ✅* |
| `top_k` | ❌ | ✅ | ✅ |
| `route` | ❌ | ✅ | ❌ |
| `reasoning` | ❌ | ✅ | ❌ |
| `stream` | ✅ | ✅ | ✅ |

*z.ai converts object cache to boolean

### Direct Model Override

SkyrimNet can bypass slots using `provider:model` syntax:
- `openai:gpt-4o` - Route directly to OpenAI
- `openrouter:anthropic/claude-sonnet-4` - Route directly to OpenRouter

## Logging

Logs are written to `logs/proxy.log` in JSON lines format:

```json
{"timestamp":"2026-02-07T12:34:56Z","level":"INFO","message":"Incoming request","model":"default","stream":false}
```

API keys are automatically redacted from logs.

## Troubleshooting

### Proxy won't start

- Check that port 35791 is not in use
- Verify configuration files are valid YAML
- Ensure API keys are set in environment variables

### Unknown model alias error

- Add the model slot to `config/routes.yaml`
- Or enable `fallback_to_default: true` in proxy settings

### Upstream timeout

- Increase `default_timeout` in `config/providers.yaml`
- Check network connectivity to upstream providers

## License

ISC
