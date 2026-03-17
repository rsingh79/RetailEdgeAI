import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Get the encryption key from environment.
 * Falls back to a deterministic dev key (NOT safe for production).
 */
function getKey() {
  const keyHex = process.env.GMAIL_ENCRYPTION_KEY;
  if (keyHex && keyHex.length === 64) {
    return Buffer.from(keyHex, 'hex');
  }
  // Dev fallback — generates a deterministic key from JWT_SECRET
  const secret = process.env.JWT_SECRET || 'retailedge-dev-secret';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns: "iv:authTag:ciphertext" (all hex-encoded)
 *
 * @param {string} text - Plaintext to encrypt
 * @returns {string} Encrypted string in format iv:authTag:ciphertext
 */
export function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a string encrypted with encrypt().
 *
 * @param {string} encryptedText - String in format iv:authTag:ciphertext
 * @returns {string} Decrypted plaintext
 */
export function decrypt(encryptedText) {
  const key = getKey();
  const [ivHex, authTagHex, ciphertext] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
