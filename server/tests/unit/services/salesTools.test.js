import { describe, it, expect } from 'vitest';
import { salesToolDefs, salesToolExecutors } from '../../../src/services/agents/tools/salesTools.js';
import { allToolDefs, executeTool } from '../../../src/services/agents/toolExecutor.js';

describe('Sales Tools', () => {
  const expectedTools = [
    'get_revenue_summary',
    'compare_revenue',
    'get_revenue_by_channel',
    'get_margin_analysis',
    'get_low_margin_products',
    'get_top_products',
    'get_bottom_products',
    'get_product_trends',
    'get_data_quality',
  ];

  it('exports 9 tool definitions', () => {
    expect(salesToolDefs).toHaveLength(9);
  });

  it('exports matching executors for every definition', () => {
    for (const def of salesToolDefs) {
      expect(salesToolExecutors[def.name]).toBeDefined();
      expect(typeof salesToolExecutors[def.name]).toBe('function');
    }
  });

  it('all tool definitions have required fields', () => {
    for (const def of salesToolDefs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.input_schema).toBeTruthy();
      expect(def.input_schema.type).toBe('object');
    }
  });

  it('all expected tools are registered in the central toolExecutor', () => {
    const allNames = allToolDefs.map((d) => d.name);
    for (const name of expectedTools) {
      expect(allNames).toContain(name);
    }
  });

  it('executeTool returns error for unknown tool', async () => {
    const result = await executeTool('nonexistent_tool', {}, {});
    expect(result.error).toContain('Unknown tool');
  });

  it('get_data_quality tool description mentions calling it BEFORE margin analysis', () => {
    const dq = salesToolDefs.find((d) => d.name === 'get_data_quality');
    expect(dq.description).toContain('BEFORE');
  });

  it('get_margin_analysis tool description mentions calling get_data_quality first', () => {
    const ma = salesToolDefs.find((d) => d.name === 'get_margin_analysis');
    expect(ma.description).toContain('get_data_quality');
  });
});
