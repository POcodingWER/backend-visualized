import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keyLength: number,
) => Promise<Buffer>;
const KEY_LENGTH = 32;

/** scrypt 해시. 저장 형식: `salt:hash` (hex) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}
