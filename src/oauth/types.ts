/**
 * Types for OAuth/API Key authentication module
 * Simplified to only support API key authentication
 */

/**
 * Authentication mode types
 */
export type AuthModeType = "api_key";

/**
 * Authentication mode configuration
 */
export interface AuthMode {
  type: AuthModeType;
  name: string;
  header_prefix: string;
}

/**
 * Provider authentication configuration
 */
export interface ProviderAuthConfig {
  auth_mode: AuthMode;
  fallback_to_api_key?: boolean;
}

/**
 * Authentication result
 */
export interface AuthenticationResult {
  success: boolean;
  error?: string;
  api_key?: string;
}

/**
 * API key information
 */
export interface ApiKeyInfo {
  env_var: string;
  configured: boolean;
  source: "environment";
}
