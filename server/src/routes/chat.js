/**
 * Chat routes for the Business AI Advisor.
 *
 * All routes are tenant-scoped via req.prisma (injected by tenantScope middleware).
 * SSE streaming is used for the message endpoint to deliver real-time responses.
 */

import { Router } from 'express';
import { chatRateLimit } from '../middleware/chatRateLimit.js';
import { runAdvisorStreaming } from '../services/agents/orchestrator.js';

const router = Router();

// ── GET /conversations — List user's conversations ──
router.get('/conversations', async (req, res) => {
  try {
    const conversations = await req.prisma.conversation.findMany({
      where: { userId: req.user.id },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
        messageCount: true,
        totalCostUsd: true,
        createdAt: true,
      },
      take: 50,
    });

    res.json(conversations);
  } catch (err) {
    console.error('Error listing conversations:', err.message);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// ── POST /conversations — Create new conversation ──
router.post('/conversations', async (req, res) => {
  try {
    const conversation = await req.prisma.conversation.create({
      data: {
        userId: req.user.id,
        title: req.body.title || null,
      },
    });

    res.status(201).json(conversation);
  } catch (err) {
    console.error('Error creating conversation:', err.message);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// ── GET /conversations/:id — Get conversation with messages ──
router.get('/conversations/:id', async (req, res) => {
  try {
    const conversation = await req.prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            toolCalls: true,
            inputTokens: true,
            outputTokens: true,
            costUsd: true,
            durationMs: true,
            feedbackRating: true,
            feedbackComment: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (err) {
    console.error('Error loading conversation:', err.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// ── DELETE /conversations/:id — Delete conversation ──
router.delete('/conversations/:id', async (req, res) => {
  try {
    const existing = await req.prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await req.prisma.conversation.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting conversation:', err.message);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// ── PATCH /conversations/:id — Update conversation title ──
router.patch('/conversations/:id', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Title is required' });
    }

    const existing = await req.prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const updated = await req.prisma.conversation.update({
      where: { id: req.params.id },
      data: { title: title.substring(0, 200) },
    });

    res.json(updated);
  } catch (err) {
    console.error('Error updating conversation:', err.message);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

// ── POST /conversations/:id/messages — Send message + stream response ──
router.post(
  '/conversations/:id/messages',
  chatRateLimit,
  async (req, res) => {
    const { content } = req.body;
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    try {
      // Verify conversation exists and belongs to user
      const conversation = await req.prisma.conversation.findFirst({
        where: { id: req.params.id, userId: req.user.id },
        select: { id: true, messageCount: true, title: true },
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      // Save the user message
      await req.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: content.trim(),
        },
      });

      // Auto-generate title from first message
      if (!conversation.title && conversation.messageCount === 0) {
        const autoTitle = content.trim().substring(0, 100);
        await req.prisma.conversation.update({
          where: { id: conversation.id },
          data: { title: autoTitle },
        });
      }

      // Load recent messages as context (last 20)
      const recentMessages = await req.prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        select: { role: true, content: true },
        take: 20,
      });

      // Format messages for Claude API
      const claudeMessages = recentMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable Nginx buffering
      });

      // Handle client disconnect
      let clientDisconnected = false;
      req.on('close', () => {
        clientDisconnected = true;
      });

      // Run the advisor
      const result = await runAdvisorStreaming({
        tenantId: req.user.tenantId,
        userId: req.user.id,
        messages: claudeMessages,
        prisma: req.prisma,
        res,
      });

      // Save the assistant message (fire-and-forget)
      if (result.content && !clientDisconnected) {
        req.prisma.message
          .create({
            data: {
              conversationId: conversation.id,
              role: 'assistant',
              content: result.content,
              toolCalls: result.toolCalls,
              toolResults: result.toolResults,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              costUsd: result.costUsd,
              durationMs: result.durationMs,
            },
          })
          .catch((err) =>
            console.error('Failed to save assistant message:', err.message)
          );

        // Update conversation stats (fire-and-forget)
        req.prisma.conversation
          .update({
            where: { id: conversation.id },
            data: {
              messageCount: { increment: 2 }, // user + assistant
              lastMessageAt: new Date(),
              totalCostUsd: { increment: result.costUsd || 0 },
            },
          })
          .catch((err) =>
            console.error('Failed to update conversation stats:', err.message)
          );
      }

      // End the SSE stream
      if (!res.writableEnded) {
        res.end();
      }
    } catch (err) {
      console.error('Error in chat message:', err.message);

      // If headers already sent (SSE mode), send error as SSE event
      if (res.headersSent) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`
        );
        if (!res.writableEnded) res.end();
      } else {
        res.status(500).json({ error: 'Failed to process message' });
      }
    }
  }
);

// ── PATCH /messages/:messageId/feedback — Submit feedback ──
router.patch('/messages/:messageId/feedback', async (req, res) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || ![1, 5].includes(rating)) {
      return res
        .status(400)
        .json({ error: 'Rating must be 1 (thumbs down) or 5 (thumbs up)' });
    }

    // Verify the message belongs to a conversation owned by this user
    const message = await req.prisma.message.findFirst({
      where: {
        id: req.params.messageId,
        role: 'assistant',
        conversation: { userId: req.user.id },
      },
      select: { id: true },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const updated = await req.prisma.message.update({
      where: { id: req.params.messageId },
      data: {
        feedbackRating: rating,
        feedbackComment: comment || null,
      },
    });

    res.json({ success: true, feedbackRating: updated.feedbackRating });
  } catch (err) {
    console.error('Error saving feedback:', err.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

export default router;
