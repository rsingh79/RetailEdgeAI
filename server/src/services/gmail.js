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

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const SUPPORTED_MIMETYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

// ── OAuth helpers ─────────────────────────────────────────────

/**
 * Build the Google OAuth 2.0 consent URL.
 * Uses the tenant's own Google Client ID (stored in DB).
 *
 * @param {string} tenantId - Passed as `state` so the callback can tie to the tenant
 * @param {string} googleClientId - Tenant's Google OAuth Client ID
 * @returns {string} Full OAuth URL
 */
export function getAuthUrl(tenantId, googleClientId) {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/gmail/oauth/callback';

  if (!googleClientId) {
    throw new Error('Google Client ID not configured. Save your Google Cloud credentials first.');
  }

  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
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
 * Uses the tenant's own Google credentials (stored in DB).
 *
 * @param {string} code - Authorization code from Google callback
 * @param {string} googleClientId - Tenant's Google Client ID
 * @param {string} googleClientSecret - Tenant's Google Client Secret (plaintext)
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: Date, email: string }}
 */
export async function exchangeCode(code, googleClientId, googleClientSecret) {
  const clientId = googleClientId;
  const clientSecret = googleClientSecret;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/gmail/oauth/callback';

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured. Save your credentials first.');
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
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
    throw new Error('Failed to get Gmail user info');
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
 * Save Gmail connection to the database (called after OAuth callback).
 *
 * @param {PrismaClient} prisma - Prisma client (root or tenant-scoped)
 * @param {string} tenantId
 * @param {{ accessToken, refreshToken, expiresAt, email }} tokens
 * @returns {GmailIntegration}
 */
export async function saveGmailConnection(prisma, tenantId, tokens) {
  return prisma.gmailIntegration.upsert({
    where: { tenantId },
    create: {
      tenantId,
      email: tokens.email,
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: encrypt(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
    },
    update: {
      email: tokens.email,
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: encrypt(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
      isActive: true,
    },
  });
}

/**
 * Handle OAuth callback from Google — exchange code and save connection.
 * Uses the root (non-tenant-scoped) Prisma client since there's no JWT context.
 * Looks up the tenant's stored Google credentials from the DB.
 *
 * @param {string} tenantId - From the OAuth state parameter
 * @param {string} code - Authorization code from Google
 */
export async function handleOAuthCallback(tenantId, code) {
  // Look up tenant's stored Google credentials
  const integration = await basePrisma.gmailIntegration.findUnique({
    where: { tenantId },
  });

  if (!integration?.googleClientId || !integration?.googleClientSecretEnc) {
    throw new Error('Google Cloud credentials not found. Please save your credentials first.');
  }

  const googleClientSecret = decrypt(integration.googleClientSecretEnc);
  const tokens = await exchangeCode(code, integration.googleClientId, googleClientSecret);
  await saveGmailConnection(basePrisma, tenantId, tokens);
}

// ── Token management ──────────────────────────────────────────

/**
 * Get a valid access token, refreshing if expired.
 * Uses the tenant's own Google credentials (stored in integration record).
 *
 * @param {PrismaClient} prisma - Prisma client
 * @param {Object} integration - GmailIntegration record (must include googleClientId, googleClientSecretEnc)
 * @returns {string} Valid access token
 */
export async function getValidAccessToken(prisma, integration) {
  // Check if current token is still valid (with 5-minute buffer)
  if (
    integration.tokenExpiresAt &&
    integration.tokenExpiresAt > new Date(Date.now() + 5 * 60 * 1000)
  ) {
    return decrypt(integration.accessTokenEnc);
  }

  // Token expired — refresh it using tenant's own Google credentials
  if (!integration.googleClientId || !integration.googleClientSecretEnc) {
    throw new Error('Google Cloud credentials missing. Please reconfigure your Gmail integration.');
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
    // If refresh token is revoked/expired, mark integration as inactive
    if (err.error === 'invalid_grant') {
      await prisma.gmailIntegration.update({
        where: { id: integration.id },
        data: { isActive: false },
      });
      throw new Error('Gmail access revoked. Please reconnect.');
    }
    throw new Error(`Token refresh failed: ${err.error_description || 'unknown'}`);
  }

  const tokens = await res.json();
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);

  // Update stored tokens
  await prisma.gmailIntegration.update({
    where: { id: integration.id },
    data: {
      accessTokenEnc: encrypt(tokens.access_token),
      tokenExpiresAt: newExpiry,
    },
  });

  return tokens.access_token;
}

// ── Dedup helpers ─────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a file buffer (dedup layer 2).
 */
export function hashFileBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Check duplicate by Gmail message ID (dedup layer 1).
 */
export async function isDuplicateByMessageId(prisma, gmailMessageId) {
  const existing = await prisma.gmailImportLog.findFirst({
    where: { gmailMessageId },
  });
  return !!existing;
}

/**
 * Check duplicate by file hash (dedup layer 2).
 */
export async function isDuplicateByHash(prisma, fileHash) {
  const existing = await prisma.gmailImportLog.findFirst({
    where: { fileHash },
  });
  return !!existing;
}

/**
 * Check duplicate by supplier + invoice number + date (dedup layer 3).
 */
export async function isDuplicateByContent(prisma, supplierName, invoiceNumber, invoiceDate) {
  if (!supplierName || !invoiceNumber) return false;

  const existing = await prisma.gmailImportLog.findFirst({
    where: {
      supplierName,
      invoiceNumber,
      ...(invoiceDate && { invoiceDate }),
      status: 'imported',
    },
  });
  return !!existing;
}

/**
 * Filter a list of messages by sender whitelist.
 */
export function filterBySenderWhitelist(messages, whitelist) {
  if (!whitelist || whitelist.length === 0) return messages;
  const normalised = whitelist.map((e) => e.toLowerCase().trim());
  return messages.filter((m) => normalised.includes(m.senderEmail?.toLowerCase().trim()));
}

// ── Attachment processing ─────────────────────────────────────

/**
 * Process a single email attachment — create Invoice, run OCR, apply results.
 * Implements 3-layer duplicate detection.
 *
 * @param {PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {Object} attachment - { buffer, filename, mimetype, senderEmail, subject, gmailMessageId }
 * @param {string} tenantId
 * @param {string} userId
 * @returns {{ status: string, invoiceId?: string, duplicateReason?: string }}
 */
export async function processGmailAttachment(prisma, attachment, tenantId, userId) {
  const { buffer, filename, mimetype, senderEmail, subject, gmailMessageId } = attachment;

  // ── Dedup Layer 1: Gmail Message ID ──
  if (gmailMessageId) {
    const dup = await isDuplicateByMessageId(prisma, gmailMessageId);
    if (dup) {
      return { status: 'duplicate', duplicateReason: 'gmail_message_id' };
    }
  }

  // ── Dedup Layer 2: File Hash ──
  const fileHash = hashFileBuffer(buffer);
  const hashDup = await isDuplicateByHash(prisma, fileHash);
  if (hashDup) {
    await prisma.gmailImportLog.create({
      data: {
        tenantId,
        gmailMessageId: gmailMessageId || `hash-dup-${Date.now()}`,
        fileHash,
        senderEmail,
        subject,
        attachmentName: filename,
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
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const savedFilename = `${timestamp}-gmail-${safeName}`;
  const filePath = path.join(uploadsDir, savedFilename);
  fs.writeFileSync(filePath, buffer);

  const fileUrl = `/api/uploads/${savedFilename}`;

  // Create invoice record
  let invoice;
  try {
    invoice = await prisma.invoice.create({
      data: {
        status: 'PROCESSING',
        originalFileUrl: fileUrl,
        source: 'email',
        gmailMessageId,
      },
    });
  } catch (err) {
    await prisma.gmailImportLog.create({
      data: {
        tenantId,
        gmailMessageId: gmailMessageId || `err-${Date.now()}`,
        fileHash,
        senderEmail,
        subject,
        attachmentName: filename,
        status: 'failed',
        duplicateReason: err.message,
      },
    });
    return { status: 'failed', duplicateReason: err.message };
  }

  // Run OCR + apply results
  try {
    const ocrResult = await extractInvoiceData(buffer, mimetype, tenantId, userId);
    const result = await applyOcrToInvoice(prisma, invoice.id, ocrResult);

    // ── Dedup Layer 3: Supplier + Invoice Number + Date ──
    const supplierName = ocrResult.supplier?.name || null;
    const invoiceNumber = ocrResult.invoiceNumber || null;
    const invoiceDate = ocrResult.invoiceDate ? new Date(ocrResult.invoiceDate) : null;

    if (supplierName && invoiceNumber) {
      const contentDup = await isDuplicateByContent(prisma, supplierName, invoiceNumber, invoiceDate);
      if (contentDup) {
        // Mark invoice as duplicate but keep it
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'DUPLICATE' },
        });

        await prisma.gmailImportLog.create({
          data: {
            tenantId,
            gmailMessageId: gmailMessageId || `content-dup-${Date.now()}`,
            fileHash,
            supplierName,
            invoiceNumber,
            invoiceDate,
            senderEmail,
            subject,
            attachmentName: filename,
            status: 'duplicate',
            duplicateReason: 'content_match',
            invoiceId: invoice.id,
          },
        });

        return { status: 'duplicate', duplicateReason: 'content_match', invoiceId: invoice.id };
      }
    }

    // Success — log the import
    await prisma.gmailImportLog.create({
      data: {
        tenantId,
        gmailMessageId: gmailMessageId || `imported-${Date.now()}`,
        fileHash,
        supplierName,
        invoiceNumber,
        invoiceDate,
        senderEmail,
        subject,
        attachmentName: filename,
        status: 'imported',
        invoiceId: invoice.id,
      },
    });

    return { status: 'imported', invoiceId: invoice.id };
  } catch (ocrErr) {
    console.error('Gmail OCR extraction failed:', ocrErr);

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'FAILED' },
    });

    await prisma.gmailImportLog.create({
      data: {
        tenantId,
        gmailMessageId: gmailMessageId || `ocr-fail-${Date.now()}`,
        fileHash,
        senderEmail,
        subject,
        attachmentName: filename,
        status: 'failed',
        duplicateReason: `OCR failed: ${ocrErr.message}`,
        invoiceId: invoice.id,
      },
    });

    return { status: 'failed', invoiceId: invoice.id };
  }
}

// ── Gmail API helpers ─────────────────────────────────────────

/**
 * Make an authenticated request to the Gmail API.
 */
async function gmailFetch(accessToken, endpoint) {
  const res = await fetch(`${GMAIL_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gmail API error: ${res.status} ${err.error?.message || res.statusText}`);
  }
  return res.json();
}

/**
 * Recursively find supported attachments in MIME parts.
 */
function findAttachments(part, attachments = []) {
  if (!part) return attachments;

  if (
    part.body?.attachmentId &&
    part.filename &&
    SUPPORTED_MIMETYPES.has(part.mimeType?.toLowerCase())
  ) {
    attachments.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body.size || 0,
    });
  }

  // Recurse into multipart parts
  if (part.parts) {
    for (const child of part.parts) {
      findAttachments(child, attachments);
    }
  }

  return attachments;
}

// ── Gmail polling ─────────────────────────────────────────────

/**
 * Poll Gmail inbox for new invoice attachments.
 * Uses Gmail REST API to list messages, download attachments, and process them.
 *
 * @param {PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {Object} integration - GmailIntegration record
 * @param {string} tenantId
 * @param {string} userId
 * @returns {{ processed: number, imported: number, duplicates: number, failed: number, skipped: number }}
 */
export async function pollGmailForInvoices(prisma, integration, tenantId, userId) {
  // Verify tenant has stored their Google credentials
  if (!integration.googleClientId || !integration.googleClientSecretEnc) {
    return {
      processed: 0, imported: 0, duplicates: 0, failed: 0, skipped: 0,
      message: 'Gmail polling requires Google Cloud credentials. Save your Client ID and Secret in Settings → Integrations.',
    };
  }

  const accessToken = await getValidAccessToken(prisma, integration);

  // Build Gmail search query
  const queryParts = ['has:attachment'];
  if (integration.labelFilter) {
    queryParts.push(`label:${integration.labelFilter}`);
  }
  // Date filter: only messages after last poll (or configurable lookback for first poll)
  const lookbackDays = integration.initialLookbackDays || 7;
  const since = integration.lastPollAt || new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  queryParts.push(`after:${Math.floor(since.getTime() / 1000)}`);

  const query = queryParts.join(' ');
  console.log(`[Gmail] Searching: ${query}`);

  // List messages matching query (paginated, cap at 200)
  let messages = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({ q: query, maxResults: '50' });
    if (pageToken) params.set('pageToken', pageToken);
    const listResult = await gmailFetch(accessToken, `/messages?${params}`);
    if (listResult.messages) messages.push(...listResult.messages);
    pageToken = listResult.nextPageToken;
  } while (pageToken && messages.length < 200);

  console.log(`[Gmail] Found ${messages.length} messages matching query`);

  const stats = { processed: 0, imported: 0, duplicates: 0, failed: 0, skipped: 0 };

  for (const msg of messages) {
    // Dedup layer 1: already seen this message ID?
    if (await isDuplicateByMessageId(prisma, msg.id)) {
      stats.duplicates++;
      continue;
    }

    try {
      // Fetch full message with payload
      const fullMsg = await gmailFetch(accessToken, `/messages/${msg.id}?format=full`);

      // Extract sender and subject from headers
      const headers = fullMsg.payload?.headers || [];
      const fromHeader = headers.find((h) => h.name.toLowerCase() === 'from')?.value || '';
      const subjectHeader = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || '';
      const senderEmail = fromHeader.match(/<(.+?)>/)?.[1] || fromHeader.trim();

      // Apply sender whitelist filter
      if (integration.senderWhitelist?.length > 0) {
        const normalised = integration.senderWhitelist.map((e) => e.toLowerCase().trim());
        if (!normalised.includes(senderEmail.toLowerCase().trim())) {
          stats.skipped++;
          continue;
        }
      }

      // Find supported attachments in MIME tree
      const attachments = findAttachments(fullMsg.payload);

      if (attachments.length === 0) {
        stats.skipped++;
        continue;
      }

      // Process each attachment
      for (const att of attachments) {
        // Skip very large attachments (> 20MB)
        if (att.size > 20 * 1024 * 1024) {
          console.log(`[Gmail] Skipping oversized attachment: ${att.filename} (${att.size} bytes)`);
          stats.skipped++;
          continue;
        }

        // Download attachment data from Gmail API
        const attData = await gmailFetch(
          accessToken,
          `/messages/${msg.id}/attachments/${att.attachmentId}`
        );

        // Gmail uses URL-safe base64 encoding
        const buffer = Buffer.from(attData.data, 'base64url');

        const result = await processGmailAttachment(
          prisma,
          {
            buffer,
            filename: att.filename,
            mimetype: att.mimeType,
            senderEmail,
            subject: subjectHeader,
            gmailMessageId: msg.id,
          },
          tenantId,
          userId
        );

        stats.processed++;
        if (result.status === 'imported') stats.imported++;
        else if (result.status === 'duplicate') stats.duplicates++;
        else if (result.status === 'failed') stats.failed++;
      }
    } catch (err) {
      console.error(`[Gmail] Error processing message ${msg.id}:`, err.message);
      stats.failed++;
    }
  }

  // Update last poll timestamp
  await prisma.gmailIntegration.update({
    where: { id: integration.id },
    data: { lastPollAt: new Date() },
  });

  console.log(`[Gmail] Poll complete: ${JSON.stringify(stats)}`);
  return stats;
}
