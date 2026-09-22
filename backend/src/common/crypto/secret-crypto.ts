import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Chiave a lunghezza fissa (32 byte) derivata da SECRET_ENCRYPTION_KEY via
 * sha256: accetta qualsiasi stringa come valore d'ambiente, non serve che
 * sia già esadecimale/base64 a 32 byte esatti.
 */
function getKey(): Buffer {
  const secret = process.env.SECRET_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY non impostata: necessaria per cifrare credenziali di terzi (es. token Loyverse).',
    );
  }
  return createHash('sha256').update(secret).digest();
}

/**
 * Cifra un segreto (es. token di un'integrazione esterna) prima di salvarlo
 * su database: mai in chiaro, a differenza delle altre impostazioni locale
 * per locale, perché è una credenziale verso un servizio terzo.
 */
export function encryptSecret(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
