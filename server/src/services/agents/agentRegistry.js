/**
 * Agent Registry
 *
 * Module-level singleton that tracks all registered AI agents in RetailEdgeAI.
 * Registration happens at import time in each agent service file.
 * Not backed by a database — this is an in-process registry only.
 *
 * Required by CLAUDE.md Step 4 for every agent in the codebase.
 */

/** @type {Map<string, Object>} */
const registry = new Map();

/**
 * Register an agent with the registry.
 *
 * @param {Object} config
 * @param {string} config.key           - Unique agent identifier (e.g. 'product_import')
 * @param {string} config.name          - Human-readable display name
 * @param {string} config.agentRoleKey  - Matches AgentRole.key in the database
 * @param {string} config.description   - What this agent does
 * @param {string} config.version       - Semantic version (e.g. '1.0.0')
 * @param {string[]} config.stages      - Pipeline stages this agent covers
 */
export function registerAgent(config) {
  const { key } = config;

  if (registry.has(key)) {
    console.warn(`[AgentRegistry] Duplicate registration attempted for key: ${key}`);
    return;
  }

  registry.set(key, {
    ...config,
    registeredAt: new Date(),
  });

  console.log(`[AgentRegistry] Agent registered: ${key}`);
}

/**
 * Return the registered config for the given key, or null if not found.
 *
 * @param {string} key
 * @returns {Object|null}
 */
export function getAgent(key) {
  return registry.get(key) ?? null;
}

/**
 * Return all registered agent configs as an array.
 *
 * @returns {Object[]}
 */
export function getAllAgents() {
  return Array.from(registry.values());
}

/**
 * Return true if an agent with the given key is registered.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isRegistered(key) {
  return registry.has(key);
}

/**
 * Return all registered agent keys.
 *
 * @returns {string[]}
 */
export function getRegisteredKeys() {
  return Array.from(registry.keys());
}
