/**
 * Usage Approaching-Limit Notification
 *
 * Utility to set the X-Usage-Approaching-Limit response header when
 * an AI query result contains _usageMeta (set by the ASAL at 90%+ usage).
 *
 * Call attachUsageHeaders(res, aiResult) after any AI generate() call
 * before sending the response. The frontend checks for this header and
 * shows a dismissable notification bar.
 */

/**
 * If the AI result contains usage metadata (90%+ of limit), set the
 * X-Usage-Approaching-Limit header on the response.
 *
 * @param {Response} res - Express response object
 * @param {object} aiResult - Result from aiServiceRouter.generate()
 */
export function attachUsageHeaders(res, aiResult) {
  if (!aiResult?._usageMeta) return;

  const meta = aiResult._usageMeta;
  res.set('X-Usage-Approaching-Limit', JSON.stringify({
    percent: meta.percentUsed,
    message: "You're approaching your monthly plan limit. Upgrade for uninterrupted access.",
    upgradeUrl: '/settings/billing',
    dismissable: true,
  }));
}

/**
 * If the AI result hit the hard limit, format a user-friendly response body.
 *
 * @param {object} aiResult - Result from aiServiceRouter.generate()
 * @returns {object|null} - Response body if limit reached, null otherwise
 */
export function checkLimitReached(aiResult) {
  if (!aiResult?.limitReached) return null;

  return {
    limitReached: true,
    message: aiResult.message,
    upgradeUrl: aiResult.upgradeUrl,
  };
}
