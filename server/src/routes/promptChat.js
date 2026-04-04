import { Router } from 'express';
import { handleChatMessage, confirmAction } from '../services/promptChatAgent.js';

const router = Router();

// In-memory conversation store (per tenant+user session)
// In production, move to Redis or DB-backed sessions
const conversations = new Map();

function getConversationKey(tenantId, userId) {
  return `${tenantId}:${userId}`;
}

function getConversation(tenantId, userId) {
  return conversations.get(getConversationKey(tenantId, userId)) || [];
}

function appendToConversation(tenantId, userId, role, content) {
  const key = getConversationKey(tenantId, userId);
  const history = conversations.get(key) || [];
  history.push({ role, content });
  // Keep last 20 messages to prevent context overflow
  if (history.length > 20) history.splice(0, history.length - 20);
  conversations.set(key, history);
}

// POST /api/prompt-chat/message — send user message, get agent response
router.post('/message', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const tenantId = req.tenantId;
    const userId = req.user?.id;
    const history = getConversation(tenantId, userId);

    const result = await handleChatMessage(tenantId, userId, message, history);

    // Update conversation history
    appendToConversation(tenantId, userId, 'user', message);
    appendToConversation(tenantId, userId, 'assistant', result.response);

    res.json({
      response: result.response,
      proposedAction: result.proposedAction,
      hasProposedAction: !!result.proposedAction,
    });
  } catch (err) {
    console.error('Error in prompt chat:', err);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// POST /api/prompt-chat/confirm — user confirms a proposed action
router.post('/confirm', async (req, res) => {
  try {
    const { action } = req.body;
    if (!action || !action.action || !action.agentTypeKey) {
      return res.status(400).json({ error: 'Valid action object is required.' });
    }

    const tenantId = req.tenantId;
    const userId = req.user?.id;

    // Build conversation excerpt from recent history
    const history = getConversation(tenantId, userId);
    const recentExchange = history.slice(-4).map((m) => `${m.role}: ${m.content}`).join('\n');

    const result = await confirmAction(tenantId, userId, action, recentExchange);

    // Add confirmation to conversation
    if (result.success) {
      appendToConversation(tenantId, userId, 'assistant',
        `Change confirmed and applied: ${action.action} on ${action.agentTypeKey}${action.conditionKey ? ` (${action.conditionKey})` : ''}.`);
    }

    res.json(result);
  } catch (err) {
    console.error('Error confirming action:', err);
    res.status(500).json({ error: 'Failed to confirm action' });
  }
});

// GET /api/prompt-chat/history — get conversation history
router.get('/history', (req, res) => {
  const history = getConversation(req.tenantId, req.user?.id);
  res.json(history);
});

// DELETE /api/prompt-chat/history — clear conversation history
router.delete('/history', (req, res) => {
  const key = getConversationKey(req.tenantId, req.user?.id);
  conversations.delete(key);
  res.json({ message: 'Conversation cleared.' });
});

// GET /api/prompt-chat/change-log — tenant's prompt change audit trail
router.get('/change-log', async (req, res) => {
  try {
    const logs = await req.prisma.promptChangeLog.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: 'desc' },
      take: parseInt(req.query.limit) || 50,
    });
    res.json(logs);
  } catch (err) {
    console.error('Error listing change log:', err);
    res.status(500).json({ error: 'Failed to list change log' });
  }
});

export default router;
