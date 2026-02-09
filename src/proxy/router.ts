/**
 * Model routing logic for SkyrimNet Proxy
 */

import type { RoutesConfig, ProvidersConfig, ResolvedRoute } from "../types/config.js";
import type { ChatCompletionRequest } from "../types/config.js";

export class Router {
  constructor(
    private _routes: RoutesConfig,
    private _providers: ProvidersConfig
  ) {}

  /**
   * Resolve model alias to provider and upstream model
   */
  resolveRoute(request: ChatCompletionRequest): ResolvedRoute {
    const model = request.model;

    // Check if it's a direct provider:model syntax
    const directMatch = model.match(/^([^:]+):(.+)$/);
    if (directMatch) {
      const [, provider, modelName] = directMatch;
      return this.resolveDirectProvider(provider, modelName);
    }

    // Look up in model_slots
    const slot = this._routes.model_slots[model];
    if (slot) {
      return this.resolveSlot(model, slot);
    }

    // Not found - check fallback setting
    if (this._routes.proxy.fallback_to_default) {
      const defaultSlot = this._routes.model_slots.default;
      if (defaultSlot) {
        // Log warning about fallback
        console.warn(`Unknown model alias '${model}', falling back to 'default' slot`);
        return this.resolveSlot("default", defaultSlot);
      }
    }

    // Strict mode - return 400-style error
    throw new RoutingError(
      `Unknown model alias: ${model}. Configure in routes.yaml or enable fallback_to_default.`,
      "invalid_request_error"
    );
  }

  /**
   * Resolve direct provider:model syntax
   */
  private resolveDirectProvider(provider: string, model: string): ResolvedRoute {
    const providerConfig = this._providers.providers[provider];
    if (!providerConfig) {
      throw new RoutingError(
        `Unknown provider '${provider}' in direct model reference`,
        "invalid_request_error"
      );
    }

    return {
      provider,
      model,
      providerConfig,
    };
  }

  /**
   * Resolve model slot to provider configuration
   */
  private resolveSlot(
    slotName: string,
    slot: { provider: string; model: string; enable_reasoning?: boolean }
  ): ResolvedRoute {
    const providerConfig = this._providers.providers[slot.provider];
    if (!providerConfig) {
      throw new RoutingError(
        `Provider '${slot.provider}' configured for slot '${slotName}' not found in providers.yaml`,
        "api_error"
      );
    }

    return {
      provider: slot.provider,
      model: slot.model,
      providerConfig,
      enableReasoning: slot.enable_reasoning,
    };
  }

  /**
   * Get all configured model slot names
   */
  getModelSlots(): string[] {
    return Object.keys(this._routes.model_slots);
  }

  /**
   * Check if a model slot exists
   */
  hasModelSlot(slot: string): boolean {
    return slot in this._routes.model_slots;
  }
}

export class RoutingError extends Error {
  constructor(
    public message: string,
    public _type: "invalid_request_error" | "api_error"
  ) {
    super(message);
    this.name = "RoutingError";
  }
}
