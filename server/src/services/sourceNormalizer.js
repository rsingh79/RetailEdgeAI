/**
 * Normalizes source system names to canonical forms.
 * Ensures consistent source strings across manual entry, CSV import, and API sync.
 */

const SOURCE_ALIASES = {
  // Shopify
  'shopify': 'Shopify',
  'shopify_sync': 'Shopify',

  // Common POS systems
  'pos': 'POS',
  'abacus': 'Abacus POS',
  'abacus pos': 'Abacus POS',
  'abacus_pos': 'Abacus POS',
  'lightspeed': 'Lightspeed',
  'square': 'Square',
  'vend': 'Vend',

  // E-commerce
  'woocommerce': 'WooCommerce',
  'woo': 'WooCommerce',
  'bigcommerce': 'BigCommerce',
  'magento': 'Magento',

  // Accounting
  'myob': 'MYOB',
  'xero': 'Xero',
  'cin7': 'Cin7',
  'dear': 'Dear',
  'netsuite': 'NetSuite',

  // Generic
  'csv': 'CSV Import',
  'csv_upload': 'CSV Import',
  'manual': 'Manual',
  'api': 'API',
};

/**
 * Normalize a source system name to its canonical form.
 *
 * @param {string} source - Raw source string from any input
 * @returns {string} Canonical source name, or the original if no alias found
 */
export function normalizeSource(source) {
  if (!source) return 'Manual';

  const key = source.toLowerCase().trim();
  return SOURCE_ALIASES[key] || source;
}
