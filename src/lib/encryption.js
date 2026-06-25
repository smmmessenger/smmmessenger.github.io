import { loadSaltFromDrive, saveSaltToDrive } from './storage.js';

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const PBKDF2_ITERATIONS = 310000; // OWASP recommended minimum for PBKDF2-SHA256
const KEY_LENGTH = 256;
const SALT_STORAGE_KEY = 'smm_pbkdf2_salt'; // localStorage cache key
const VERIFY_STORAGE_KEY = 'smm_key_verify';
const VERIFY_PLAINTEXT = 'smm_messenger_v1_verified';

// --- Base64 helpers (loop-based to avoid stack overflow on large buffers) ------

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Salt management ----------------------------------------------------------

let _cachedSalt = null;

/**
 * Load the PBKDF2 salt.  Checks localStorage first, then falls back to
 * Google Drive.  If neither has one, generates a new random salt and stores
 * it in both places.
 *
 * Must be called AFTER Google Drive auth is complete (gapi token is set).
 */
export async function loadOrCreateSalt() {
  // 1. Try local cache
  const localSalt = localStorage.getItem(SALT_STORAGE_KEY);
  if (localSalt) {
    _cachedSalt = base64ToUint8Array(localSalt);
    return _cachedSalt;
  }

  // 2. Try Google Drive
  const driveSalt = await loadSaltFromDrive();
  if (driveSalt) {
    // Cache locally for next time
    localStorage.setItem(SALT_STORAGE_KEY, driveSalt);
    _cachedSalt = base64ToUint8Array(driveSalt);
    return _cachedSalt;
  }

  // 3. First time ever — generate, save everywhere
  const freshSaltBytes = window.crypto.getRandomValues(new Uint8Array(32));
  const freshSaltB64 = arrayBufferToBase64(freshSaltBytes);
  localStorage.setItem(SALT_STORAGE_KEY, freshSaltB64);
  await saveSaltToDrive(freshSaltB64);
  _cachedSalt = freshSaltBytes;
  return _cachedSalt;
}

// --- Key derivation -----------------------------------------------------------

/**
 * Derive a non-extractable AES-GCM-256 key from a master password.
 * Salt must be loaded first via loadOrCreateSalt().
 */
export async function deriveKey(password) {
  if (!_cachedSalt) {
    await loadOrCreateSalt();
  }

  const encoder = new TextEncoder();

  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false, // not extractable
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: _cachedSalt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: ENCRYPTION_ALGORITHM, length: KEY_LENGTH },
    false, // SECURITY: non-extractable — raw key bytes can never be exported by JS
    ['encrypt', 'decrypt']
  );
}

// --- Key verification ---------------------------------------------------------
// Encrypts a known string on first use.  On subsequent logins we try to decrypt
// it — if decryption fails, the password is wrong.

export async function createKeyVerifier(key) {
  const encrypted = await encryptText(VERIFY_PLAINTEXT, key);
  localStorage.setItem(VERIFY_STORAGE_KEY, JSON.stringify(encrypted));
}

export async function verifyKey(key) {
  const stored = localStorage.getItem(VERIFY_STORAGE_KEY);
  if (!stored) {
    // First time — create verifier and trust the key
    await createKeyVerifier(key);
    return true;
  }
  try {
    const result = await decryptText(JSON.parse(stored), key);
    return result === VERIFY_PLAINTEXT;
  } catch {
    return false;
  }
}

// --- Text encryption / decryption ---------------------------------------------

export async function encryptText(text, key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    data
  );

  return {
    iv: arrayBufferToBase64(iv),
    cipherText: arrayBufferToBase64(cipherBuffer),
  };
}

export async function decryptText(encryptedData, key) {
  const ivBytes = base64ToUint8Array(encryptedData.iv);
  const cipherBytes = base64ToUint8Array(encryptedData.cipherText);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv: ivBytes },
    key,
    cipherBytes
  );

  return new TextDecoder().decode(decryptedBuffer);
}

// --- File encryption / decryption ---------------------------------------------

export async function encryptFile(fileBlob, key) {
  const arrayBuffer = await fileBlob.arrayBuffer();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    arrayBuffer
  );

  // Layout: [12 bytes IV][ciphertext]
  return new Blob([iv, cipherBuffer], { type: 'application/octet-stream' });
}

export async function decryptFile(encryptedBlob, key, mimeType) {
  const arrayBuffer = await encryptedBlob.arrayBuffer();
  const iv = new Uint8Array(arrayBuffer, 0, 12);
  const cipherBuffer = arrayBuffer.slice(12);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    cipherBuffer
  );

  return new Blob([decryptedBuffer], { type: mimeType });
}
