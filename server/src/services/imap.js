import { ImapFlow } from 'imapflow';
import { decrypt } from '../lib/encryption.js';
import {
  SUPPORTED_MIMETYPES,
  processGmailAttachment,
  filterBySenderWhitelist,
} from './gmail.js';

// Gmail IMAP settings (only Gmail supported for now)
const GMAIL_IMAP = { host: 'imap.gmail.com', port: 993, secure: true };

/**
 * Test an IMAP connection to Gmail using email + App Password.
 * Connects, authenticates, lists mailbox folders, then disconnects.
 *
 * @param {string} email - Gmail address
 * @param {string} password - Google App Password (16 chars)
 * @returns {{ success: boolean, folders?: string[], error?: string }}
 */
export async function testImapConnection(email, password) {
  const client = new ImapFlow({
    ...GMAIL_IMAP,
    auth: { user: email, pass: password },
    disabledAuthMechanisms: ['XOAUTH2'],
    logger: false,
  });

  try {
    await client.connect();

    // List mailbox folders
    const folders = [];
    const mailboxes = await client.list();
    for (const mailbox of mailboxes) {
      folders.push(mailbox.path);
    }

    await client.logout();
    return { success: true, folders };
  } catch (err) {
    console.error('[IMAP Test] Connection error:', err.message, err.code || '', err.responseStatus || '');
    try { await client.logout(); } catch { /* ignore */ }
    return { success: false, error: err.message };
  }
}

/**
 * Poll a Gmail account via IMAP for invoice attachments.
 * Reuses processGmailAttachment() from gmail.js for the shared downstream pipeline
 * (dedup, OCR, invoice creation).
 *
 * Uses UID-based incremental fetching — only processes messages
 * with UIDs greater than the last processed UID.
 *
 * @param {PrismaClient} prisma - Tenant-scoped client (from basePrisma, not req.prisma)
 * @param {Object} integration - GmailIntegration record with IMAP fields
 * @param {string} tenantId
 * @param {string} userId
 * @returns {{ processed: number, imported: number, duplicates: number, failed: number, skipped: number }}
 */
export async function pollImapForInvoices(prisma, integration, tenantId, userId) {
  const stats = { processed: 0, imported: 0, duplicates: 0, failed: 0, skipped: 0 };

  // Decrypt the stored App Password
  let password;
  try {
    password = decrypt(integration.imapPasswordEnc);
  } catch (err) {
    console.error('[IMAP] Failed to decrypt password:', err.message);
    return stats;
  }

  const client = new ImapFlow({
    host: integration.imapHost || GMAIL_IMAP.host,
    port: integration.imapPort || GMAIL_IMAP.port,
    secure: integration.imapUseSsl !== false,
    auth: { user: integration.imapEmail, pass: password },
    disabledAuthMechanisms: ['XOAUTH2'],
    logger: false,
  });

  try {
    await client.connect();

    // Open INBOX (or configured folder via labelFilter)
    const folder = integration.labelFilter || 'INBOX';
    const lock = await client.getMailboxLock(folder);

    try {
      // Build search criteria
      const searchCriteria = {};
      const lastUid = integration.imapLastUid || 0;

      // Only fetch messages newer than last poll (or configurable lookback for first run)
      if (integration.lastPollAt) {
        searchCriteria.since = integration.lastPollAt;
      } else {
        const lookbackDays = integration.initialLookbackDays || 7;
        const lookbackDate = new Date();
        lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
        searchCriteria.since = lookbackDate;
      }

      // Search for messages
      const messages = await client.search(searchCriteria);
      if (!messages || messages.length === 0) {
        lock.release();
        await client.logout();
        return stats;
      }

      // Cap at 200 messages per poll (same as Gmail OAuth)
      const messageUids = messages.slice(0, 200);
      let highestUid = lastUid;

      for (const uid of messageUids) {
        // Skip already-processed UIDs
        if (uid <= lastUid) continue;

        stats.processed++;
        if (uid > highestUid) highestUid = uid;

        try {
          // Fetch the message with envelope and body structure
          const msg = await client.fetchOne(uid, {
            envelope: true,
            bodyStructure: true,
            uid: true,
          });

          if (!msg || !msg.envelope) {
            stats.skipped++;
            continue;
          }

          const senderEmail = msg.envelope.from?.[0]?.address || '';
          const subject = msg.envelope.subject || '';
          const messageId = msg.envelope.messageId || `imap-${uid}-${Date.now()}`;

          // Apply sender whitelist filter
          if (integration.senderWhitelist && integration.senderWhitelist.length > 0) {
            const filtered = filterBySenderWhitelist(
              [{ senderEmail }],
              integration.senderWhitelist
            );
            if (filtered.length === 0) {
              stats.skipped++;
              continue;
            }
          }

          // Find attachments in the body structure
          const attachments = findImapAttachments(msg.bodyStructure);

          if (attachments.length > 0) {
            console.log(`[IMAP] UID ${uid} from=${senderEmail} subj="${subject}" attachments=${attachments.map(a => a.filename).join(', ')}`);
          }

          if (attachments.length === 0) {
            stats.skipped++;
            continue;
          }

          // Process each supported attachment
          for (const att of attachments) {
            if (!SUPPORTED_MIMETYPES.has(att.type?.toLowerCase())) {
              stats.skipped++;
              continue;
            }

            try {
              // Download the attachment
              const { content } = await client.download(uid, att.part);
              const chunks = [];
              for await (const chunk of content) {
                chunks.push(chunk);
              }
              const buffer = Buffer.concat(chunks);

              // Use the shared pipeline from gmail.js
              const result = await processGmailAttachment(prisma, {
                buffer,
                filename: att.filename || `attachment-${uid}.${att.extension || 'pdf'}`,
                mimetype: att.type,
                senderEmail,
                subject,
                gmailMessageId: messageId,
              }, tenantId, userId);

              if (result.status === 'imported') stats.imported++;
              else if (result.status === 'duplicate') stats.duplicates++;
              else stats.failed++;
            } catch (dlErr) {
              console.error(`[IMAP] Failed to download attachment from UID ${uid}:`, dlErr.message);
              stats.failed++;
            }
          }
        } catch (msgErr) {
          console.error(`[IMAP] Failed to process message UID ${uid}:`, msgErr.message);
          stats.failed++;
        }
      }

      // Update the integration with latest UID and poll time
      await prisma.gmailIntegration.update({
        where: { id: integration.id },
        data: {
          imapLastUid: highestUid,
          lastPollAt: new Date(),
        },
      });

      lock.release();
    } catch (err) {
      lock.release();
      throw err;
    }

    await client.logout();
  } catch (err) {
    console.error('[IMAP] Poll error:', err.message);
    try { await client.logout(); } catch { /* ignore */ }
  }

  return stats;
}

/**
 * Recursively find attachments in an IMAP body structure.
 * Returns array of { part, type, filename, extension }.
 */
function findImapAttachments(structure, prefix = '') {
  const attachments = [];

  if (!structure) return attachments;

  // Single part
  if (structure.type && !structure.childNodes) {
    const disposition = structure.disposition?.toLowerCase();
    const mimeType = structure.type.toLowerCase();
    // Only pick up real attachments (disposition: "attachment").
    // Also accept inline PDFs (some suppliers embed them), but skip
    // inline images — they're almost always email signatures/logos.
    const isRealAttachment = disposition === 'attachment';
    const isInlinePdf = disposition === 'inline' && mimeType.startsWith('application/pdf');

    if (isRealAttachment || isInlinePdf) {
      const filename = structure.dispositionParameters?.filename ||
        structure.parameters?.name ||
        '';
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      // ImapFlow puts the full MIME type in structure.type (e.g. "application/pdf")
      const type = structure.type.toLowerCase();

      if (SUPPORTED_MIMETYPES.has(type)) {
        attachments.push({
          part: prefix || structure.part || '1',
          type,
          filename,
          extension: ext,
        });
      }
    }
    return attachments;
  }

  // Multipart — recurse into children
  if (structure.childNodes) {
    for (let i = 0; i < structure.childNodes.length; i++) {
      const child = structure.childNodes[i];
      const partNum = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      attachments.push(...findImapAttachments(child, partNum));
    }
  }

  return attachments;
}
