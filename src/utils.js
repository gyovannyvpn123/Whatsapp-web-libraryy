/**
 * Utility functions for WhatsApp Web Library
 */

'use strict';

const crypto = require('crypto');

/**
 * Logger utility
 */
const logger = {
  debug: (...args) => {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.log('[DEBUG]', new Date().toISOString(), ...args);
    }
  },
  
  info: (...args) => {
    console.log('[INFO]', new Date().toISOString(), ...args);
  },
  
  warn: (...args) => {
    console.warn('[WARN]', new Date().toISOString(), ...args);
  },
  
  error: (...args) => {
    console.error('[ERROR]', new Date().toISOString(), ...args);
  }
};

/**
 * Get current timestamp in seconds
 */
function getTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Get current timestamp in milliseconds
 */
function getTimestampMs() {
  return Date.now();
}

/**
 * Generate random bytes as base64 string
 */
function generateRandomBase64(length) {
  return crypto.randomBytes(length).toString('base64');
}

/**
 * Generate WhatsApp message ID
 */
function generateMessageId() {
  return '3EB0' + crypto.randomBytes(8).toString('hex').toUpperCase();
}

/**
 * Convert number to bytes
 */
function toBytes(number, length, endianness = 'big') {
  const hex = number.toString(16).padStart(length * 2, '0');
  const bytes = Buffer.from(hex, 'hex');
  return endianness === 'big' ? bytes : bytes.reverse();
}

/**
 * HMAC SHA256
 */
function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/**
 * AES encryption with padding
 */
function aesEncrypt(key, plaintext) {
  // Add PKCS7 padding
  const blockSize = 16;
  const padding = blockSize - (plaintext.length % blockSize);
  const paddedText = Buffer.concat([plaintext, Buffer.alloc(padding, padding)]);
  
  const iv = crypto.randomBytes(blockSize);
  const cipher = crypto.createCipher('aes-256-cbc', key);
  cipher.setIVBytes(iv);
  
  let encrypted = cipher.update(paddedText);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return Buffer.concat([iv, encrypted]);
}

/**
 * AES decryption with unpadding
 */
function aesDecrypt(key, ciphertext) {
  const iv = ciphertext.slice(0, 16);
  const encrypted = ciphertext.slice(16);
  
  const decipher = crypto.createDecipher('aes-256-cbc', key);
  decipher.setIVBytes(iv);
  
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  // Remove PKCS7 padding
  const padding = decrypted[decrypted.length - 1];
  return decrypted.slice(0, decrypted.length - padding);
}

/**
 * WhatsApp encryption (HMAC + AES)
 */
function whatsappEncrypt(encKey, macKey, plaintext) {
  const encrypted = aesEncrypt(encKey, plaintext);
  const hmac = hmacSha256(macKey, encrypted);
  return Buffer.concat([hmac, encrypted]);
}

/**
 * WhatsApp decryption (verify HMAC + decrypt AES)
 */
function whatsappDecrypt(encKey, macKey, ciphertext) {
  const receivedHmac = ciphertext.slice(0, 32);
  const encryptedData = ciphertext.slice(32);
  
  // Verify HMAC
  const computedHmac = hmacSha256(macKey, encryptedData);
  if (!crypto.timingSafeEqual(receivedHmac, computedHmac)) {
    throw new Error('HMAC verification failed');
  }
  
  return aesDecrypt(encKey, encryptedData);
}

/**
 * HKDF (HMAC-based Key Derivation Function)
 */
function hkdf(inputKeyMaterial, salt, info, length) {
  // Extract phase
  const actualSalt = salt && salt.length > 0 ? salt : Buffer.alloc(32);
  const prk = hmacSha256(actualSalt, inputKeyMaterial);
  
  // Expand phase
  const blocks = Math.ceil(length / 32);
  let okm = Buffer.alloc(0);
  let previousBlock = Buffer.alloc(0);
  
  for (let i = 1; i <= blocks; i++) {
    const hmac = crypto.createHmac('sha256', prk);
    hmac.update(previousBlock);
    hmac.update(info);
    hmac.update(Buffer.from([i]));
    
    previousBlock = hmac.digest();
    okm = Buffer.concat([okm, previousBlock]);
  }
  
  return okm.slice(0, length);
}

/**
 * Generate curve25519 key pair (simplified)
 */
function generateCurve25519KeyPair() {
  // Generate 32 random bytes for private key
  const privateKey = crypto.randomBytes(32);
  
  // Clamp the private key according to curve25519 spec
  privateKey[0] &= 248;
  privateKey[31] &= 127;
  privateKey[31] |= 64;
  
  // For demo purposes, generate a mock public key
  // In real implementation, this would use proper curve25519 scalar multiplication
  const publicKey = crypto.randomBytes(32);
  
  return { privateKey, publicKey };
}

/**
 * Parse WhatsApp Web version string
 */
function parseWhatsAppVersion(versionString = '2,2121,6') {
  return versionString.split(',').map(v => parseInt(v, 10));
}

/**
 * Format phone number for WhatsApp
 */
function formatPhoneNumber(phoneNumber) {
  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Add country code if missing (assuming international format)
  if (!cleaned.startsWith('1') && cleaned.length === 10) {
    return '1' + cleaned; // US default
  }
  
  return cleaned;
}

/**
 * Create WhatsApp chat ID from phone number
 */
function createChatId(phoneNumber, isGroup = false) {
  const formatted = formatPhoneNumber(phoneNumber);
  return isGroup ? `${formatted}@g.us` : `${formatted}@c.us`;
}

/**
 * Validate WhatsApp chat ID
 */
function validateChatId(chatId) {
  const regex = /^\d+@(c\.us|g\.us|s\.whatsapp\.net)$/;
  return regex.test(chatId);
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries - 1) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Deep merge objects
 */
function deepMerge(target, ...sources) {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        deepMerge(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }

  return deepMerge(target, ...sources);
}

/**
 * Check if value is object
 */
function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Create error with additional properties
 */
function createError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

/**
 * Custom error classes
 */
class ConnectionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ConnectionError';
    this.code = 'CONNECTION_ERROR';
    Object.assign(this, details);
  }
}

class AuthError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = 'AUTH_ERROR';
    Object.assign(this, details);
  }
}

class MessageError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MessageError';
    this.code = 'MESSAGE_ERROR';
    Object.assign(this, details);
  }
}

class RateLimitError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RateLimitError';
    this.code = 'RATE_LIMIT_ERROR';
    Object.assign(this, details);
  }
}

module.exports = {
  logger,
  getTimestamp,
  getTimestampMs,
  generateRandomBase64,
  generateMessageId,
  toBytes,
  hmacSha256,
  aesEncrypt,
  aesDecrypt,
  whatsappEncrypt,
  whatsappDecrypt,
  hkdf,
  generateCurve25519KeyPair,
  parseWhatsAppVersion,
  formatPhoneNumber,
  createChatId,
  validateChatId,
  sleep,
  retryWithBackoff,
  deepMerge,
  isObject,
  createError,
  ConnectionError,
  AuthError,
  MessageError,
  RateLimitError
};