

function validateInterest(body, registry, now = new Date()) {
  const failure = () => ({ valid: false, code: 'invalid_submission' });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return failure();
  const allowed = new Set(['schemaVersion', 'submissionId', 'pageId', 'featureId', 'intent', 'email', 'comment', 'updatesConsent', 'privacyVersion', 'website']);
  if (Object.keys(body).some(key => !allowed.has(key))) return failure();
  let size = 0;
  for (const char of JSON.stringify(body)) {
    const point = char.codePointAt(0);
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  if (size > 8192) return failure();
  if (body.schemaVersion !== 1 || body.privacyVersion !== 'interest-2026-10-23') return failure();
  if (typeof body.submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId)) return failure();
  if (typeof body.pageId !== 'string' || typeof body.featureId !== 'string' || !Object.hasOwn(registry.pages, body.pageId) || !registry.pages[body.pageId].includes(body.featureId)) return failure();
  if (!['interested', 'feedback', 'problem'].includes(body.intent)) return failure();
  if (typeof body.email !== 'string' || typeof body.comment !== 'string' || typeof body.updatesConsent !== 'boolean' || body.website !== '') return failure();
  const email = body.email.trim();
  const comment = body.comment.trim();
  if (email.length > 254 || comment.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(email + comment)) return failure();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return failure();
  if (body.updatesConsent && !email) return failure();
  if (body.intent !== 'interested' && !comment) return failure();
  return { valid: true, row: {
    submissionId: body.submissionId.toLowerCase(), schemaVersion: 1, pageId: body.pageId, featureId: body.featureId,
    intent: body.intent, email, comment, updatesConsent: body.updatesConsent,
    privacyVersion: body.privacyVersion, receivedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 90 * 86400000).toISOString()
  } };
}

export { validateInterest };
