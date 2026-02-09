/**
 * SkyrimNet Proxy Dashboard JavaScript
 * Handles fetching and displaying provider configuration
 */

/* global document, fetch, console */

// API base URL
const API_BASE = '';

/**
 * Initialize the dashboard
 */
function init() {
  loadStatus();
  loadProviders();
  loadEnvironmentVars();
}

/**
 * Load and display proxy status
 */
async function loadStatus() {
  const statusCard = document.getElementById('status-card');

  try {
    const response = await fetch(`${API_BASE}/api/health`);
    const data = await response.json();

    const statusIndicator = statusCard.querySelector('.status-indicator');
    const statusText = statusCard.querySelector('.status-text');
    const statusDetails = statusCard.querySelector('.status-details');

    if (data.status === 'healthy') {
      statusIndicator.classList.remove('loading');
      statusIndicator.classList.add('online');
      statusText.textContent = 'Proxy Online';
      statusDetails.innerHTML = `
        <div>Timestamp: ${new Date(data.timestamp).toLocaleString()}</div>
        <div>Providers Configured: ${data.providers_configured}</div>
      `;
    } else {
      statusIndicator.classList.remove('loading');
      statusIndicator.classList.add('offline');
      statusText.textContent = 'Proxy Offline';
    }
  } catch (error) {
    console.error('Failed to load status:', error);
    const statusIndicator = statusCard.querySelector('.status-indicator');
    const statusText = statusCard.querySelector('.status-text');
    statusIndicator.classList.remove('loading');
    statusIndicator.classList.add('offline');
    statusText.textContent = 'Connection Error';
  }
}

/**
 * Load and display providers
 */
async function loadProviders() {
  const providersList = document.getElementById('providers-list');

  try {
    const response = await fetch(`${API_BASE}/api/providers`);
    const data = await response.json();

    if (!data.providers || data.providers.length === 0) {
      providersList.innerHTML = '<div class="empty-state">No providers configured</div>';
      return;
    }

    providersList.innerHTML = data.providers.map(provider => `
      <div class="provider-card">
        <div class="provider-header">
          <span class="provider-name">${escapeHtml(provider.name)}</span>
          <span class="provider-status ${provider.api_key.configured ? 'configured' : 'missing'}">
            ${provider.api_key.configured ? 'Configured' : 'API Key Missing'}
          </span>
        </div>
        <div class="provider-details">
          <div class="provider-url">${escapeHtml(provider.base_url)}</div>
          <div>Environment Variable: <code>${escapeHtml(provider.api_key.source)}</code></div>
          <div>Timeout: ${provider.default_timeout || '60s'}</div>
          <div>Max Retries: ${provider.max_retries ?? 2}</div>
          <div>Allowed Fields: ${(provider.allowed_fields || []).length} fields</div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load providers:', error);
    providersList.innerHTML = `<div class="error-state">Failed to load providers: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Load and display environment variables status
 */
async function loadEnvironmentVars() {
  const envList = document.getElementById('env-list');

  try {
    const response = await fetch(`${API_BASE}/api/env`);
    const data = await response.json();

    if (!data.env_vars || data.env_vars.length === 0) {
      envList.innerHTML = '<div class="empty-state">No environment variables configured</div>';
      return;
    }

    envList.innerHTML = data.env_vars.map(env => `
      <div class="env-item">
        <div>
          <span class="env-name">${escapeHtml(env.env_var)}</span>
          ${env.provider ? `<span class="env-provider">(${escapeHtml(env.provider)})</span>` : ''}
        </div>
        <span class="env-status ${env.configured ? 'set' : 'unset'}">
          ${env.configured ? '✓ Set' : '✗ Not Set'}
        </span>
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load environment vars:', error);
    envList.innerHTML = `<div class="error-state">Failed to load environment configuration</div>`;
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (text === undefined || text === null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
