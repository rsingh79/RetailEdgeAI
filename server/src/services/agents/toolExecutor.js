/**
 * Central tool executor — combines all tool definitions and dispatches
 * tool calls to the correct executor function.
 */

import { invoiceToolDefs, invoiceToolExecutors } from './tools/invoiceTools.js';
import { productToolDefs, productToolExecutors } from './tools/productTools.js';
import { pricingToolDefs, pricingToolExecutors } from './tools/pricingTools.js';
import {
  competitorToolDefs,
  competitorToolExecutors,
} from './tools/competitorTools.js';

// ── All tool definitions (sent to Claude) ──
export const allToolDefs = [
  ...invoiceToolDefs,
  ...productToolDefs,
  ...pricingToolDefs,
  ...competitorToolDefs,
];

// ── Executor map: toolName → async function(input, prisma) ──
const executorMap = {
  ...invoiceToolExecutors,
  ...productToolExecutors,
  ...pricingToolExecutors,
  ...competitorToolExecutors,
};

/**
 * Execute a tool by name with the given input.
 * All tools receive the tenant-scoped prisma client for automatic isolation.
 *
 * @param {string} name — Tool name from Claude's tool_use response
 * @param {Object} input — Tool input from Claude
 * @param {Object} prisma — Tenant-scoped Prisma client (req.prisma)
 * @returns {Promise<Object>} Tool result (serialised to JSON for Claude)
 */
export async function executeTool(name, input, prisma) {
  const executor = executorMap[name];
  if (!executor) {
    return { error: `Unknown tool: ${name}` };
  }

  try {
    const result = await executor(input, prisma);
    return result;
  } catch (err) {
    console.error(`Tool execution error [${name}]:`, err.message);
    return {
      error: `Tool "${name}" failed: ${err.message}`,
    };
  }
}
