/**
 * Named validator registry for prompt condition removal safety checks.
 *
 * Each validator receives a tenant-scoped Prisma client and returns
 * { passed: boolean, message: string }.
 *
 * If passed=false, the condition removal is blocked.
 */

const VALIDATORS = {
  /**
   * Checks if the tenant has invoices flagged as GST-inclusive.
   * Removing the GST detection rule could cause incorrect GST calculations.
   */
  has_gst_invoices: async (prisma) => {
    const count = await prisma.invoice.count({
      where: { gstInclusive: true },
    });
    if (count > 0) {
      return {
        passed: false,
        message: `Cannot remove GST detection rule: ${count} invoice(s) have GST-inclusive pricing. Removing this rule may cause incorrect GST calculations for future invoices.`,
      };
    }
    return { passed: true, message: 'No GST-inclusive invoices found.' };
  },

  /**
   * Checks if the tenant has invoice lines with pack size data.
   * Removing the pack size extraction rule could break cost-per-unit calculations.
   */
  has_pack_size_lines: async (prisma) => {
    // InvoiceLine is a child of Invoice — query via Invoice relation
    const invoicesWithPackSizes = await prisma.invoice.findMany({
      where: {
        lines: { some: { packSize: { not: null } } },
      },
      select: { id: true },
      take: 1,
    });
    if (invoicesWithPackSizes.length > 0) {
      return {
        passed: false,
        message: 'Cannot remove pack size rule: existing invoice lines contain pack size data. Removing this rule would stop extracting pack sizes from future invoices.',
      };
    }
    return { passed: true, message: 'No invoice lines with pack size data found.' };
  },

  /**
   * Checks if the tenant has products with base unit data.
   * Removing the base unit rule could break unit cost normalization.
   */
  has_base_unit_products: async (prisma) => {
    const count = await prisma.product.count({
      where: { baseUnit: { not: null } },
    });
    if (count > 0) {
      return {
        passed: false,
        message: `Cannot remove base unit rule: ${count} product(s) have base unit data. Removing this rule would stop extracting base units from future invoices.`,
      };
    }
    return { passed: true, message: 'No products with base unit data found.' };
  },

  /**
   * Checks if the tenant has invoices currently being processed.
   * Removing critical extraction rules while invoices are in-flight could cause failures.
   */
  has_active_invoices: async (prisma) => {
    const count = await prisma.invoice.count({
      where: { status: { in: ['PROCESSING', 'READY'] } },
    });
    if (count > 0) {
      return {
        passed: false,
        message: `Cannot modify this rule: ${count} invoice(s) are currently being processed. Wait for processing to complete before changing extraction rules.`,
      };
    }
    return { passed: true, message: 'No invoices currently being processed.' };
  },
};

/**
 * Run a named validator for a prompt condition.
 *
 * @param {string} validationKey - The validator name (e.g. "has_gst_invoices")
 * @param {object} prisma - Tenant-scoped Prisma client
 * @returns {Promise<{passed: boolean, message: string}>}
 */
export async function runValidator(validationKey, prisma) {
  if (!validationKey) {
    return { passed: true, message: 'No validation required.' };
  }

  const validator = VALIDATORS[validationKey];
  if (!validator) {
    console.warn(`Unknown validator key: ${validationKey}`);
    return { passed: true, message: `Validator "${validationKey}" not found, allowing by default.` };
  }

  return validator(prisma);
}

/**
 * List all available validator keys (for admin reference).
 */
export function listValidators() {
  return Object.keys(VALIDATORS);
}
