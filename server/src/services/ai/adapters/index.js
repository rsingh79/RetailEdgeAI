/**
 * Provider Adapter Registry
 *
 * Lazy-loads provider adapters on demand. Each adapter exports the three
 * standard ASAL functions: generate(), embed(), rerank().
 */

const adapters = {
  anthropic: () => import('./anthropic.js'),
  cohere: () => import('./cohere.js'),
  // voyageai: () => import('./voyageai.js'),   // future
};

/**
 * Load a provider adapter by name.
 *
 * @param {string} provider - Provider key (e.g. 'anthropic', 'cohere')
 * @returns {Promise<{generate: Function, embed: Function, rerank: Function}>}
 */
export async function loadAdapter(provider) {
  const loader = adapters[provider];
  if (!loader) {
    throw {
      code: 'PROVIDER_NOT_FOUND',
      provider,
      message: `No adapter found for provider '${provider}'. Available: ${Object.keys(adapters).join(', ')}`,
      retryable: false,
    };
  }
  return await loader();
}
