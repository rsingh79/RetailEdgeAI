/**
 * Conversation Cleanup — detects abandoned conversations.
 *
 * Runs periodically (every 30 minutes) to find conversations where:
 * - Last message was from the user (AI never responded or user sent follow-up)
 * - Last message is older than 30 minutes
 * - resolutionStatus is null (not yet classified)
 *
 * Marks them as "abandoned" and emits an interaction signal.
 */
import { basePrisma } from '../lib/prisma.js';
import {
  recordPromptMeta,
  recordOutcome,
  recordCorrectionCount,
  emitSignal,
} from './signalCollector.js';

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const ABANDONMENT_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes of inactivity

let cleanupTimer = null;

/**
 * Start the periodic cleanup job.
 */
export function startConversationCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => detectAbandoned(), CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

/**
 * Stop the cleanup job.
 */
export function stopConversationCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Detect and mark abandoned conversations.
 */
async function detectAbandoned() {
  try {
    const cutoff = new Date(Date.now() - ABANDONMENT_THRESHOLD_MS);

    // Find conversations with no resolutionStatus where the last activity was before cutoff
    const staleConversations = await basePrisma.conversation.findMany({
      where: {
        resolutionStatus: null,
        lastMessageAt: { lt: cutoff },
        messageCount: { gt: 0 },
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        messageCount: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { role: true },
        },
      },
      take: 50, // batch limit to avoid overloading
    });

    let abandonedCount = 0;

    for (const conv of staleConversations) {
      const lastMessageRole = conv.messages[0]?.role;

      // Only mark as abandoned if last message was from user (they didn't get a useful response)
      // Conversations ending with assistant messages are considered resolved
      if (lastMessageRole === 'user') {
        // Mark as abandoned
        await basePrisma.conversation.update({
          where: { id: conv.id },
          data: { resolutionStatus: 'abandoned' },
        });

        // Emit abandonment signal
        const key = `abandoned:${conv.id}`;
        recordPromptMeta(key, {
          agentRoleKey: 'business_advisor',
          tenantId: conv.tenantId,
          userId: conv.userId,
          baseVersionId: 'abandonment_detection',
        });
        recordOutcome(key, {
          resolutionStatus: 'abandoned',
          topicTags: ['conversation_abandoned'],
        });
        recordCorrectionCount(key, Math.max(0, conv.messageCount - 1));
        emitSignal(key, conv.id);

        abandonedCount++;
      } else if (lastMessageRole === 'assistant') {
        // Conversation ended with AI response — mark as resolved
        await basePrisma.conversation.update({
          where: { id: conv.id },
          data: { resolutionStatus: 'resolved' },
        });
      }
    }

    if (abandonedCount > 0) {
      console.log(`Conversation cleanup: marked ${abandonedCount} conversation(s) as abandoned`);
    }
  } catch (err) {
    console.error('Conversation cleanup error:', err.message);
  }
}

export { detectAbandoned as _detectAbandoned };
