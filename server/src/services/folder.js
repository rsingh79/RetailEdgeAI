import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashFileBuffer } from './gmail.js';
import { extractInvoiceData } from './ocr.js';
import { applyOcrToInvoice } from './invoiceProcessor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

/**
 * Map file extension → MIME type for supported invoice file types.
 */
const EXT_TO_MIME = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
};

// ── Path validation ─────────────────────────────────────────

/**
 * Validate a folder path is safe and accessible.
 * - Must be an absolute path (Unix, drive letter, or UNC)
 * - Must not contain ".." traversal
 * - Must be readable by the server process
 *
 * @param {string} folderPath
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
export async function validateFolderPath(folderPath) {
  if (!folderPath || typeof folderPath !== 'string') {
    return { valid: false, error: 'Folder path is required.' };
  }

  const trimmed = folderPath.trim();

  // Must be absolute: Unix (/...), drive letter (C:\...), or UNC (\\server\share)
  const isAbsolute =
    trimmed.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith('\\\\');
  if (!isAbsolute) {
    return { valid: false, error: 'Path must be absolute (e.g. /invoices, C:\\Invoices, or \\\\server\\share).' };
  }

  // No traversal — check raw input before normalizing
  if (trimmed.includes('..')) {
    return { valid: false, error: 'Path must not contain ".." traversal.' };
  }

  const normalized = path.normalize(trimmed);

  // Check accessible
  try {
    await fsp.access(normalized, fs.constants.R_OK);
  } catch {
    return { valid: false, error: `Folder not accessible: ${normalized}` };
  }

  // Verify it's a directory
  try {
    const stat = await fsp.stat(normalized);
    if (!stat.isDirectory()) {
      return { valid: false, error: 'Path is not a directory.' };
    }
  } catch {
    return { valid: false, error: `Cannot stat path: ${normalized}` };
  }

  return { valid: true };
}

// ── File scanning ───────────────────────────────────────────

/**
 * Check if a filename matches any of the glob-like patterns.
 * Supports simple patterns: "*.pdf", "*.jpg", etc.
 *
 * @param {string} fileName
 * @param {string[]} patterns - e.g. ["*.pdf", "*.jpg"]
 * @returns {boolean}
 */
function matchesPatterns(fileName, patterns) {
  if (!patterns || patterns.length === 0) return true;

  const lower = fileName.toLowerCase();
  return patterns.some((pattern) => {
    // Simple glob: "*.ext" → check extension
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1).toLowerCase(); // e.g. ".pdf"
      return lower.endsWith(ext);
    }
    // Exact match fallback
    return lower === pattern.toLowerCase();
  });
}

/**
 * Scan a folder for files matching the configured patterns.
 * Top-level only (no recursive scanning).
 *
 * @param {string} folderPath - Absolute path to scan
 * @param {string[]} filePatterns - Glob patterns e.g. ["*.pdf", "*.jpg"]
 * @returns {Promise<Array<{ fullPath: string, fileName: string, size: number, mimeType: string }>>}
 */
export async function scanFolder(folderPath, filePatterns) {
  const entries = await fsp.readdir(folderPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    // Skip directories and the Processed subfolder
    if (!entry.isFile()) continue;
    if (entry.name.toLowerCase() === 'processed') continue;

    // Check pattern match
    if (!matchesPatterns(entry.name, filePatterns)) continue;

    // Check MIME type
    const ext = path.extname(entry.name).toLowerCase();
    const mimeType = EXT_TO_MIME[ext];
    if (!mimeType) continue;

    // Check file size
    const fullPath = path.join(folderPath, entry.name);
    try {
      const stat = await fsp.stat(fullPath);
      if (stat.size > MAX_FILE_SIZE) {
        console.warn(`[folder-poll] Skipping oversized file: ${entry.name} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
        continue;
      }
      results.push({ fullPath, fileName: entry.name, size: stat.size, mimeType });
    } catch {
      // File may have been deleted between readdir and stat
      continue;
    }
  }

  return results;
}

// ── Dedup helpers (folder-specific) ─────────────────────────

/**
 * Check duplicate by file path (dedup layer 1).
 */
async function isDuplicateByFilePath(prisma, filePath) {
  const existing = await prisma.folderImportLog.findFirst({
    where: { filePath },
  });
  return !!existing;
}

/**
 * Check duplicate by file hash (dedup layer 2).
 */
async function isDuplicateByFileHash(prisma, fileHash) {
  const existing = await prisma.folderImportLog.findFirst({
    where: { fileHash },
  });
  return !!existing;
}

/**
 * Check duplicate by supplier + invoice number + date (dedup layer 3).
 */
async function isDuplicateByContent(prisma, supplierName, invoiceNumber, invoiceDate) {
  if (!supplierName || !invoiceNumber) return false;

  const existing = await prisma.folderImportLog.findFirst({
    where: {
      supplierName,
      invoiceNumber,
      ...(invoiceDate && { invoiceDate }),
      status: 'imported',
    },
  });
  return !!existing;
}

// ── File import ─────────────────────────────────────────────

/**
 * Process a single file from the watch folder — create Invoice, run OCR, apply results.
 * Implements 3-layer duplicate detection.
 *
 * @param {PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {string} filePath - Full path to the source file
 * @param {string} fileName - Just the filename
 * @param {Buffer} buffer - File contents
 * @param {string} mimeType - MIME type
 * @param {number} fileSize - Size in bytes
 * @param {string} tenantId
 * @param {string} userId
 * @returns {{ status: string, invoiceId?: string, duplicateReason?: string }}
 */
export async function processFileImport(prisma, filePath, fileName, buffer, mimeType, fileSize, tenantId, userId) {
  // ── Dedup Layer 1: File Path ──
  const pathDup = await isDuplicateByFilePath(prisma, filePath);
  if (pathDup) {
    return { status: 'duplicate', duplicateReason: 'file_path' };
  }

  // ── Dedup Layer 2: File Hash ──
  const fileHash = hashFileBuffer(buffer);
  const hashDup = await isDuplicateByFileHash(prisma, fileHash);
  if (hashDup) {
    await prisma.folderImportLog.create({
      data: {
        tenantId,
        filePath,
        fileHash,
        fileName,
        fileSize,
        status: 'duplicate',
        duplicateReason: 'file_hash',
      },
    });
    return { status: 'duplicate', duplicateReason: 'file_hash' };
  }

  // Save file to uploads directory
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const savedFilename = `${timestamp}-folder-${safeName}`;
  const savedPath = path.join(uploadsDir, savedFilename);
  fs.writeFileSync(savedPath, buffer);

  const fileUrl = `/api/uploads/${savedFilename}`;

  // Create invoice record
  let invoice;
  try {
    invoice = await prisma.invoice.create({
      data: {
        status: 'PROCESSING',
        originalFileUrl: fileUrl,
        source: 'folder',
      },
    });
  } catch (err) {
    await prisma.folderImportLog.create({
      data: {
        tenantId,
        filePath,
        fileHash,
        fileName,
        fileSize,
        status: 'failed',
        duplicateReason: err.message,
      },
    });
    return { status: 'failed', duplicateReason: err.message };
  }

  // Run OCR + apply results
  try {
    const ocrResult = await extractInvoiceData(buffer, mimeType, tenantId, userId);
    const applyResult = await applyOcrToInvoice(prisma, invoice.id, ocrResult);

    // ── Document type check: discard non-invoices ──
    if (applyResult?.discarded) {
      await prisma.folderImportLog.create({
        data: {
          tenantId,
          filePath,
          fileHash,
          supplierName: applyResult.supplierName || null,
          fileName,
          fileSize: buffer.length,
          status: 'discarded',
          duplicateReason: `not_invoice:${applyResult.documentType}`,
          invoiceId: invoice.id,
        },
      });
      // Move to Discarded/ subfolder if configured
      if (integration.moveToProcessed) {
        const discardedDir = path.join(path.dirname(filePath), 'Discarded');
        await fs.promises.mkdir(discardedDir, { recursive: true }).catch(() => {});
        const destPath = path.join(discardedDir, path.basename(filePath));
        await fs.promises.rename(filePath, destPath).catch(() => {});
      }
      return { status: 'discarded', documentType: applyResult.documentType, invoiceId: invoice.id };
    }

    // ── Dedup Layer 3: Supplier + Invoice Number + Date ──
    const supplierName = ocrResult.supplier?.name || null;
    const invoiceNumber = ocrResult.invoiceNumber || null;
    const invoiceDate = ocrResult.invoiceDate ? new Date(ocrResult.invoiceDate) : null;

    if (supplierName && invoiceNumber) {
      const contentDup = await isDuplicateByContent(prisma, supplierName, invoiceNumber, invoiceDate);
      if (contentDup) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'DUPLICATE' },
        });

        await prisma.folderImportLog.create({
          data: {
            tenantId,
            filePath,
            fileHash,
            supplierName,
            invoiceNumber,
            invoiceDate,
            fileName,
            fileSize,
            status: 'duplicate',
            duplicateReason: 'content_match',
            invoiceId: invoice.id,
          },
        });

        return { status: 'duplicate', duplicateReason: 'content_match', invoiceId: invoice.id };
      }
    }

    // Success — log the import
    await prisma.folderImportLog.create({
      data: {
        tenantId,
        filePath,
        fileHash,
        supplierName,
        invoiceNumber,
        invoiceDate,
        fileName,
        fileSize,
        status: 'imported',
        invoiceId: invoice.id,
      },
    });

    return { status: 'imported', invoiceId: invoice.id };
  } catch (ocrErr) {
    console.error('[folder-poll] OCR extraction failed:', ocrErr);

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'FAILED' },
    });

    await prisma.folderImportLog.create({
      data: {
        tenantId,
        filePath,
        fileHash,
        fileName,
        fileSize,
        status: 'failed',
        duplicateReason: `OCR failed: ${ocrErr.message}`,
        invoiceId: invoice.id,
      },
    });

    return { status: 'failed', invoiceId: invoice.id };
  }
}

// ── Move to Processed ───────────────────────────────────────

/**
 * Move a processed file to the Processed/ subfolder.
 * Creates the subfolder if it doesn't exist.
 * Appends timestamp if a file with the same name already exists.
 *
 * @param {string} folderPath - Parent folder path
 * @param {string} fileName - File to move
 */
export async function moveToProcessed(folderPath, fileName) {
  const processedDir = path.join(folderPath, 'Processed');
  await fsp.mkdir(processedDir, { recursive: true });

  const sourcePath = path.join(folderPath, fileName);
  let destPath = path.join(processedDir, fileName);

  // Handle name collision — append timestamp
  try {
    await fsp.access(destPath);
    // File exists in Processed — add timestamp
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    destPath = path.join(processedDir, `${base}-${Date.now()}${ext}`);
  } catch {
    // No collision — use original name
  }

  await fsp.rename(sourcePath, destPath);
}

// ── Main polling function ───────────────────────────────────

/**
 * Poll a folder for new invoices, import them, and move processed files.
 *
 * @param {PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {Object} integration - FolderIntegration record
 * @param {string} tenantId
 * @param {string} userId
 * @returns {{ processed: number, imported: number, duplicates: number, failed: number, skipped: number }}
 */
export async function pollFolderForInvoices(prisma, integration, tenantId, userId) {
  const { folderPath, filePatterns, moveToProcessed: shouldMove } = integration;

  if (!folderPath) {
    throw new Error('No folder path configured.');
  }

  // Verify folder is still accessible
  const validation = await validateFolderPath(folderPath);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Scan for matching files
  const files = await scanFolder(folderPath, filePatterns);

  const stats = { processed: 0, imported: 0, duplicates: 0, failed: 0, skipped: 0 };

  for (const file of files) {
    stats.processed++;

    try {
      // Read file contents
      const buffer = await fsp.readFile(file.fullPath);

      // Process the file (dedup + invoice creation + OCR)
      const result = await processFileImport(
        prisma,
        file.fullPath,
        file.fileName,
        buffer,
        file.mimeType,
        file.size,
        tenantId,
        userId,
      );

      if (result.status === 'imported') {
        stats.imported++;

        // Move to Processed/ subfolder
        if (shouldMove) {
          try {
            await moveToProcessed(folderPath, file.fileName);
          } catch (moveErr) {
            console.error(`[folder-poll] Failed to move ${file.fileName} to Processed/:`, moveErr);
          }
        }
      } else if (result.status === 'duplicate') {
        stats.duplicates++;

        // Also move duplicates to Processed/ to keep the folder clean
        if (shouldMove) {
          try {
            await moveToProcessed(folderPath, file.fileName);
          } catch (moveErr) {
            console.error(`[folder-poll] Failed to move duplicate ${file.fileName}:`, moveErr);
          }
        }
      } else if (result.status === 'failed') {
        stats.failed++;
      } else {
        stats.skipped++;
      }
    } catch (err) {
      console.error(`[folder-poll] Error processing ${file.fileName}:`, err);
      stats.failed++;
    }
  }

  // Update lastPollAt
  await prisma.folderIntegration.update({
    where: { tenantId },
    data: { lastPollAt: new Date() },
  });

  return stats;
}
