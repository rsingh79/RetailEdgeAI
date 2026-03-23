import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { encrypt, decrypt } from '../lib/encryption.js';
import { extractInvoiceData } from './ocr.js';
import { applyOcrToInvoice } from './invoiceProcessor.js';
import basePrisma from '../lib/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

const SUPPORTED_MIMETYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// ── Per-tenant OAuth helpers ─────────────────────────────────
// Each tenant provides their own Google Cloud OAuth credentials
// (same pattern as Gmail integration)

function getRedirectUri() {
  return process.env.GOOGLE_DRIVE_REDIRECT_URI || 'http://localhost:3001/api/drive/oauth/callback';
}

/**
 * Build Google OAuth 2.0 consent URL for Drive access.
 * Uses tenant's own Google Cloud credentials.
 *
 * @param {string} tenantId - Passed as `state` so callback can tie to tenant
 * @param {string} googleClientId - Tenant's Google OAuth Client ID
 * @returns {string} Full OAuth URL
 */
export function getDriveAuthUrl(tenantId, googleClientId) {
  if (!googleClientId) {
    throw new Error('Google Client ID not configured. Save your Google Cloud credentials first.');
  }

  const redirectUri = getRedirectUri();
  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: tenantId,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an OAuth authorization code for access + refresh tokens.
 * Uses tenant's own Google Cloud credentials.
 *
 * @param {string} code - Authorization code from Google callback
 * @param {string} googleClientId - Tenant's Google OAuth Client ID
 * @param {string} googleClientSecret - Tenant's Google OAuth Client Secret (plaintext)
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: Date, email: string }}
 */
export async function exchangeDriveCode(code, googleClientId, googleClientSecret) {
  if (!googleClientId || !googleClientSecret) {
    throw new Error('Google Cloud credentials not configured. Save your Client ID and Secret first.');
  }

  const redirectUri = getRedirectUri();
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: googleClientId,
      client_secret: googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${err.error_description || tokenRes.statusText}`);
  }

  const tokens = await tokenRes.json();

  // Get user's email address
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error('Failed to get Google user info');
  }

  const userInfo = await userRes.json();

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    email: userInfo.email,
  };
}

/**
 * Handle OAuth callback — look up tenant's credentials from DB,
 * exchange code for tokens, and update the pending record.
 *
 * @param {string} tenantId
 * @param {string} code
 * @returns {{ email: string }}
 */
export async function handleDriveOAuthCallback(tenantId, code) {
  // Look up tenant's stored Google credentials from the pending integration
  const integration = await basePrisma.driveIntegration.findFirst({
    where: { tenantId, driveFolderId: '__pending__' },
  });

  if (!integration?.googleClientId || !integration?.googleClientSecretEnc) {
    throw new Error('Google Cloud credentials not found. Please save your credentials first.');
  }

  const googleClientSecret = decrypt(integration.googleClientSecretEnc);
  const tokens = await exchangeDriveCode(code, integration.googleClientId, googleClientSecret);

  // Update the pending record with OAuth tokens
  await basePrisma.driveIntegration.update({
    where: { id: integration.id },
    data: {
      email: tokens.email,
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: encrypt(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
    },
  });

  return { email: tokens.email };
}

// ── Token management ─────────────────────────────────────────

/**
 * Get a valid access token, refreshing if expired.
 * Uses tenant's own Google Cloud credentials for refresh.
 *
 * @param {PrismaClient} prisma
 * @param {Object} integration - DriveIntegration record
 * @returns {string} Valid access token
 */
export async function getDriveValidAccessToken(prisma, integration) {
  // Check if current token is still valid (with 5-minute buffer)
  if (
    integration.tokenExpiresAt &&
    integration.tokenExpiresAt > new Date(Date.now() + 5 * 60 * 1000)
  ) {
    return decrypt(integration.accessTokenEnc);
  }

  // Token expired — refresh using tenant's own credentials
  if (!integration.googleClientId || !integration.googleClientSecretEnc) {
    throw new Error('Google Cloud credentials missing. Please reconfigure your Google Drive integration.');
  }

  const refreshToken = decrypt(integration.refreshTokenEnc);
  const googleClientSecret = decrypt(integration.googleClientSecretEnc);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: integration.googleClientId,
      client_secret: googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.error === 'invalid_grant') {
      await prisma.driveIntegration.update({
        where: { id: integration.id },
        data: { isActive: false },
      });
      throw new Error('Google Drive access revoked. Please reconnect.');
    }
    throw new Error(`Token refresh failed: ${err.error_description || 'unknown'}`);
  }

  const tokens = await res.json();
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.driveIntegration.update({
    where: { id: integration.id },
    data: {
      accessTokenEnc: encrypt(tokens.access_token),
      tokenExpiresAt: newExpiry,
    },
  });

  return tokens.access_token;
}

// ── Drive API helpers ────────────────────────────────────────

/**
 * Fetch JSON from Drive API.
 */
async function driveFetch(accessToken, endpoint) {
  const url = endpoint.startsWith('http') ? endpoint : `${DRIVE_API}${endpoint}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Drive API error: ${res.status} ${err.error?.message || res.statusText}`);
  }
  return res.json();
}

/**
 * Download file content from Drive (returns raw Response).
 */
async function driveDownload(accessToken, fileId) {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Drive download error: ${res.status} ${res.statusText}`);
  }
  return res;
}

/**
 * List folders inside a parent (or root).
 *
 * @param {string} accessToken
 * @param {string} parentId - Parent folder ID, or 'root' for My Drive root
 * @returns {Array<{ id, name, modifiedTime }>}
 */
export async function listDriveFolders(accessToken, parentId = 'root') {
  const q = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,modifiedTime),nextPageToken',
    orderBy: 'name',
    pageSize: '100',
  });
  const result = await driveFetch(accessToken, `/files?${params}`);
  return result.files || [];
}

/**
 * List invoice files in a folder (PDF, images only).
 *
 * @param {string} accessToken
 * @param {string} folderId
 * @returns {Array<{ id, name, mimeType, size, modifiedTime }>}
 */
async function listDriveFiles(accessToken, folderId) {
  const mimeTypes = [...SUPPORTED_MIMETYPES]
    .filter((t) => t !== 'image/jpg') // jpg is alias for jpeg
    .map((t) => `mimeType = '${t}'`)
    .join(' or ');

  const q = `'${folderId}' in parents and (${mimeTypes}) and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,size,modifiedTime),nextPageToken',
    orderBy: 'modifiedTime desc',
    pageSize: '100',
  });

  const allFiles = [];
  let pageToken = null;

  do {
    if (pageToken) params.set('pageToken', pageToken);
    const result = await driveFetch(accessToken, `/files?${params}`);
    allFiles.push(...(result.files || []));
    pageToken = result.nextPageToken;
  } while (pageToken && allFiles.length < 200);

  return allFiles;
}

// ── Dedup helpers ────────────────────────────────────────────

function hashFileBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function isDuplicateByDriveFileId(prisma, driveFileId) {
  const existing = await prisma.driveImportLog.findFirst({
    where: { driveFileId, status: { not: 'failed' } },
  });
  return !!existing;
}

async function isDuplicateByHash(prisma, fileHash) {
  const existing = await prisma.driveImportLog.findFirst({
    where: { fileHash, status: 'imported' },
  });
  return !!existing;
}

async function isDuplicateByContent(prisma, supplierName, invoiceNumber, invoiceDate) {
  if (!supplierName || !invoiceNumber) return false;
  const existing = await prisma.driveImportLog.findFirst({
    where: { supplierName, invoiceNumber, ...(invoiceDate && { invoiceDate }), status: 'imported' },
  });
  return !!existing;
}

// ── File processing ──────────────────────────────────────────

/**
 * Process a single Drive file through the invoice pipeline.
 *
 * @param {PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {{ buffer, filename, mimetype, driveFileId, fileSize }} attachment
 * @param {string} tenantId
 * @param {string} userId
 * @returns {{ status: string, invoiceId?: string, duplicateReason?: string }}
 */
export async function processDriveFile(prisma, attachment, tenantId, userId) {
  const { buffer, filename, mimetype, driveFileId, fileSize } = attachment;

  // Dedup Layer 1: Drive file ID
  if (await isDuplicateByDriveFileId(prisma, driveFileId)) {
    await prisma.driveImportLog.upsert({
      where: { tenantId_driveFileId: { tenantId, driveFileId } },
      create: { tenantId, driveFileId, fileName: filename, fileSize, mimeType: mimetype, status: 'duplicate', duplicateReason: 'drive_file_id' },
      update: {},
    });
    return { status: 'duplicate', duplicateReason: 'drive_file_id' };
  }

  // Dedup Layer 2: File hash
  const fileHash = hashFileBuffer(buffer);
  if (await isDuplicateByHash(prisma, fileHash)) {
    await prisma.driveImportLog.create({
      data: { tenantId, driveFileId, fileHash, fileName: filename, fileSize, mimeType: mimetype, status: 'duplicate', duplicateReason: 'file_hash' },
    });
    return { status: 'duplicate', duplicateReason: 'file_hash' };
  }

  // Save file to uploads/
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const diskName = `${Date.now()}-drive-${safeName}`;
  const diskPath = path.join(uploadsDir, diskName);

  try {
    await fs.promises.mkdir(uploadsDir, { recursive: true });
    await fs.promises.writeFile(diskPath, buffer);
  } catch (err) {
    console.error(`[Drive] Failed to save file ${filename}:`, err.message);
    await prisma.driveImportLog.create({
      data: { tenantId, driveFileId, fileHash, fileName: filename, fileSize, mimeType: mimetype, status: 'failed', duplicateReason: `save_error: ${err.message}` },
    });
    return { status: 'failed' };
  }

  // Create invoice record
  let invoice;
  try {
    invoice = await prisma.invoice.create({
      data: {
        tenantId,
        status: 'PROCESSING',
        source: 'drive',
        originalFileUrl: `/api/uploads/${diskName}`,
        driveFileId,
      },
    });
  } catch (err) {
    console.error(`[Drive] Failed to create invoice for ${filename}:`, err.message);
    await prisma.driveImportLog.create({
      data: { tenantId, driveFileId, fileHash, fileName: filename, fileSize, mimeType: mimetype, status: 'failed', duplicateReason: `create_error: ${err.message}` },
    });
    return { status: 'failed' };
  }

  // Run OCR
  try {
    const ocrResult = await extractInvoiceData(buffer, mimetype, tenantId, userId);
    const applyResult = await applyOcrToInvoice(prisma, invoice.id, ocrResult);

    // ── Document type check: discard non-invoices ──
    if (applyResult?.discarded) {
      await prisma.driveImportLog.create({
        data: {
          tenantId, driveFileId, fileHash, fileName: filename, fileSize, mimeType: mimetype,
          supplierName: applyResult.supplierName || null,
          status: 'discarded', duplicateReason: `not_invoice:${applyResult.documentType}`, invoiceId: invoice.id,
        },
      });
      return { status: 'discarded', documentType: applyResult.documentType, invoiceId: invoice.id };
    }

    // Dedup Layer 3: Content match
    const updatedInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    if (updatedInvoice?.supplierName && updatedInvoice?.invoiceNumber) {
      if (await isDuplicateByContent(prisma, updatedInvoice.supplierName, updatedInvoice.invoiceNumber, updatedInvoice.invoiceDate)) {
        await prisma.driveImportLog.create({
          data: {
            tenantId, driveFileId, fileHash, fileName: filename, fileSize, mimeType: mimetype,
            supplierName: updatedInvoice.supplierName, invoiceNumber: updatedInvoice.invoiceNumber, invoiceDate: updatedInvoice.invoiceDate,
            status: 'duplicate', duplicateReason: 'content_match', invoiceId: invoice.id,
          },
        });
        return { status: 'duplicate', duplicateReason: 'content_match', invoiceId: invoice.id };
      }
    }

    // Success — log import
    await prisma.driveImportLog.create({
      data: {
        tenantId, driveFileId, fileHash, fileName: filename, fileSize, mimeType: mimetype,
        supplierName: updatedInvoice?.supplierName, invoiceNumber: updatedInvoice?.invoiceNumber, invoiceDate: updatedInvoice?.invoiceDate,
        status: 'imported', invoiceId: invoice.id,
      },
    });

    return { status: 'imported', invoiceId: invoice.id };
  } catch (err) {
    console.error(`[Drive] OCR failed for ${filename}:`, err.message);
    // Mark invoice as failed
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'FAILED' } }).catch(() => {});
    await prisma.driveImportLog.create({
      data: { tenantId, driveFileId, fileHash, fileName: filename, fileSize, mimeType: mimetype, status: 'failed', duplicateReason: `ocr_error: ${err.message}`, invoiceId: invoice.id },
    });
    return { status: 'failed', invoiceId: invoice.id };
  }
}

// ── Polling ──────────────────────────────────────────────────

/**
 * Poll a Google Drive folder for new invoice files.
 *
 * @param {PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {Object} integration - DriveIntegration record
 * @param {string} tenantId
 * @param {string} userId
 * @returns {{ processed, imported, duplicates, failed, skipped }}
 */
export async function pollDriveForInvoices(prisma, integration, tenantId, userId) {
  const stats = { processed: 0, imported: 0, duplicates: 0, failed: 0, skipped: 0 };

  if (!integration.driveFolderId || integration.driveFolderId === '__pending__') {
    throw new Error('No Drive folder selected.');
  }

  // Get valid access token
  const accessToken = await getDriveValidAccessToken(prisma, integration);

  // List files in the selected folder
  const files = await listDriveFiles(accessToken, integration.driveFolderId);

  for (const file of files) {
    stats.processed++;

    // Skip oversized files
    const fileSize = parseInt(file.size || '0', 10);
    if (fileSize > MAX_FILE_SIZE) {
      stats.skipped++;
      continue;
    }

    // Quick dedup: check if already processed by Drive file ID
    if (await isDuplicateByDriveFileId(prisma, file.id)) {
      stats.duplicates++;
      continue;
    }

    // Download file
    try {
      const downloadRes = await driveDownload(accessToken, file.id);
      const arrayBuffer = await downloadRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const result = await processDriveFile(prisma, {
        buffer,
        filename: file.name,
        mimetype: file.mimeType,
        driveFileId: file.id,
        fileSize: buffer.length,
      }, tenantId, userId);

      if (result.status === 'imported') stats.imported++;
      else if (result.status === 'duplicate') stats.duplicates++;
      else stats.failed++;
    } catch (err) {
      console.error(`[Drive] Error processing ${file.name}:`, err.message);
      stats.failed++;
    }
  }

  // Update lastPollAt
  await prisma.driveIntegration.update({
    where: { id: integration.id },
    data: { lastPollAt: new Date() },
  });

  return stats;
}
