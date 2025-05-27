/**
 * Cryptography Manager
 * Handles WhatsApp Web encryption, decryption, and security operations
 * 
 * @class CryptoManager
 */

'use strict';

const crypto = require('crypto');
const { logger } = require('./utils');

/**
 * Cryptography Manager for WhatsApp Web
 */
class CryptoManager {
  /**
   * Create crypto manager
   */
  constructor() {
    this.privateKey = null;
    this.publicKey = null;
    this.sharedSecret = null;
    this.macKey = null;
    this.encKey = null;
    this.keyPair = null;
    
    logger.debug('Crypto manager initialized');
  }

  /**
   * Initialize cryptographic components
   * 
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      logger.info('Initializing cryptographic components');

      // Generate ECDH key pair
      this.keyPair = crypto.createECDH('prime256v1');
      this.privateKey = this.keyPair.generateKeys();
      this.publicKey = this.keyPair.getPublicKey();

      logger.info('Cryptographic components initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize crypto components:', error);
      throw error;
    }
  }

  /**
   * Generate key pair for authentication
   * 
   * @returns {Object} Key pair object
   */
  generateKeyPair() {
    const ecdh = crypto.createECDH('prime256v1');
    const privateKey = ecdh.generateKeys();
    const publicKey = ecdh.getPublicKey();

    return {
      privateKey,
      publicKey,
      ecdh
    };
  }

  /**
   * Compute shared secret from server public key
   * 
   * @param {Buffer} serverPublicKey - Server's public key
   * @returns {Buffer} Shared secret
   */
  computeSharedSecret(serverPublicKey) {
    try {
      if (!this.keyPair) {
        throw new Error('Key pair not initialized');
      }

      this.sharedSecret = this.keyPair.computeSecret(serverPublicKey);
      
      // Derive encryption and MAC keys from shared secret
      this._deriveKeys();

      logger.debug('Shared secret computed successfully');
      return this.sharedSecret;
      
    } catch (error) {
      logger.error('Failed to compute shared secret:', error);
      throw error;
    }
  }

  /**
   * Encrypt message data
   * 
   * @param {Buffer|string} data - Data to encrypt
   * @param {Object} [options={}] - Encryption options
   * @returns {Object} Encrypted data with metadata
   */
  encrypt(data, options = {}) {
    try {
      if (!this.encKey) {
        throw new Error('Encryption key not available');
      }

      const plaintext = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      
      // Generate random IV
      const iv = crypto.randomBytes(16);
      
      // Create cipher
      const cipher = crypto.createCipherGCM('aes-256-gcm', this.encKey);
      cipher.setIVBytes(iv);
      
      // Add additional authenticated data if provided
      if (options.aad) {
        cipher.setAAD(Buffer.from(options.aad));
      }
      
      // Encrypt data
      let encrypted = cipher.update(plaintext);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      // Get authentication tag
      const authTag = cipher.getAuthTag();
      
      return {
        encrypted,
        iv,
        authTag,
        algorithm: 'aes-256-gcm'
      };
      
    } catch (error) {
      logger.error('Failed to encrypt data:', error);
      throw error;
    }
  }

  /**
   * Decrypt message data
   * 
   * @param {Object} encryptedData - Encrypted data object
   * @param {Object} [options={}] - Decryption options
   * @returns {Buffer} Decrypted data
   */
  decrypt(encryptedData, options = {}) {
    try {
      if (!this.encKey) {
        throw new Error('Encryption key not available');
      }

      const { encrypted, iv, authTag, algorithm } = encryptedData;
      
      if (algorithm !== 'aes-256-gcm') {
        throw new Error(`Unsupported algorithm: ${algorithm}`);
      }
      
      // Create decipher
      const decipher = crypto.createDecipherGCM('aes-256-gcm', this.encKey);
      decipher.setIVBytes(iv);
      decipher.setAuthTag(authTag);
      
      // Add additional authenticated data if provided
      if (options.aad) {
        decipher.setAAD(Buffer.from(options.aad));
      }
      
      // Decrypt data
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted;
      
    } catch (error) {
      logger.error('Failed to decrypt data:', error);
      throw error;
    }
  }

  /**
   * Generate HMAC signature
   * 
   * @param {Buffer|string} data - Data to sign
   * @param {Object} [options={}] - Signing options
   * @returns {Buffer} HMAC signature
   */
  sign(data, options = {}) {
    try {
      if (!this.macKey) {
        throw new Error('MAC key not available');
      }

      const algorithm = options.algorithm || 'sha256';
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      
      const hmac = crypto.createHmac(algorithm, this.macKey);
      hmac.update(dataBuffer);
      
      return hmac.digest();
      
    } catch (error) {
      logger.error('Failed to sign data:', error);
      throw error;
    }
  }

  /**
   * Verify HMAC signature
   * 
   * @param {Buffer|string} data - Original data
   * @param {Buffer} signature - Signature to verify
   * @param {Object} [options={}] - Verification options
   * @returns {boolean} True if signature is valid
   */
  verify(data, signature, options = {}) {
    try {
      if (!this.macKey) {
        throw new Error('MAC key not available');
      }

      const expectedSignature = this.sign(data, options);
      
      // Use constant-time comparison to prevent timing attacks
      return crypto.timingSafeEqual(signature, expectedSignature);
      
    } catch (error) {
      logger.error('Failed to verify signature:', error);
      return false;
    }
  }

  /**
   * Generate random bytes
   * 
   * @param {number} size - Number of bytes to generate
   * @returns {Buffer} Random bytes
   */
  randomBytes(size) {
    return crypto.randomBytes(size);
  }

  /**
   * Generate cryptographically secure random string
   * 
   * @param {number} length - String length
   * @param {string} [charset] - Character set to use
   * @returns {string} Random string
   */
  randomString(length, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
    let result = '';
    const bytes = crypto.randomBytes(length);
    
    for (let i = 0; i < length; i++) {
      result += charset[bytes[i] % charset.length];
    }
    
    return result;
  }

  /**
   * Hash data using specified algorithm
   * 
   * @param {Buffer|string} data - Data to hash
   * @param {string} [algorithm='sha256'] - Hash algorithm
   * @returns {Buffer} Hash digest
   */
  hash(data, algorithm = 'sha256') {
    try {
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      const hash = crypto.createHash(algorithm);
      hash.update(dataBuffer);
      
      return hash.digest();
      
    } catch (error) {
      logger.error('Failed to hash data:', error);
      throw error;
    }
  }

  /**
   * Generate key derivation using PBKDF2
   * 
   * @param {string|Buffer} password - Password/secret
   * @param {Buffer} salt - Salt bytes
   * @param {number} iterations - Number of iterations
   * @param {number} keyLength - Desired key length
   * @param {string} [digest='sha256'] - Hash digest algorithm
   * @returns {Buffer} Derived key
   */
  deriveKey(password, salt, iterations, keyLength, digest = 'sha256') {
    try {
      return crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest);
      
    } catch (error) {
      logger.error('Failed to derive key:', error);
      throw error;
    }
  }

  /**
   * Generate curve25519 key pair
   * 
   * @returns {Object} Curve25519 key pair
   */
  generateCurve25519KeyPair() {
    try {
      // Generate 32 random bytes for private key
      const privateKey = crypto.randomBytes(32);
      
      // Clamp the private key (set specific bits as per curve25519 spec)
      privateKey[0] &= 248;
      privateKey[31] &= 127;
      privateKey[31] |= 64;
      
      // For a real implementation, you would compute the public key
      // from the private key using curve25519 scalar multiplication
      // This is a simplified version
      const publicKey = crypto.randomBytes(32);
      
      return {
        privateKey,
        publicKey
      };
      
    } catch (error) {
      logger.error('Failed to generate curve25519 key pair:', error);
      throw error;
    }
  }

  /**
   * Encrypt media with AES-256
   * 
   * @param {Buffer} mediaData - Media data to encrypt
   * @param {Buffer} [mediaKey] - Media encryption key (generated if not provided)
   * @returns {Object} Encrypted media data and key
   */
  encryptMedia(mediaData, mediaKey = null) {
    try {
      // Generate media key if not provided
      if (!mediaKey) {
        mediaKey = crypto.randomBytes(32);
      }
      
      // Generate IV
      const iv = crypto.randomBytes(16);
      
      // Create cipher
      const cipher = crypto.createCipher('aes-256-cbc', mediaKey);
      cipher.setIVBytes(iv);
      
      // Encrypt media
      let encrypted = cipher.update(mediaData);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      // Generate MAC
      const mac = crypto.createHmac('sha256', mediaKey);
      mac.update(iv);
      mac.update(encrypted);
      const macDigest = mac.digest();
      
      return {
        encryptedData: encrypted,
        mediaKey,
        iv,
        mac: macDigest
      };
      
    } catch (error) {
      logger.error('Failed to encrypt media:', error);
      throw error;
    }
  }

  /**
   * Decrypt media with AES-256
   * 
   * @param {Buffer} encryptedData - Encrypted media data
   * @param {Buffer} mediaKey - Media decryption key
   * @param {Buffer} iv - Initialization vector
   * @param {Buffer} expectedMac - Expected MAC for verification
   * @returns {Buffer} Decrypted media data
   */
  decryptMedia(encryptedData, mediaKey, iv, expectedMac) {
    try {
      // Verify MAC first
      const mac = crypto.createHmac('sha256', mediaKey);
      mac.update(iv);
      mac.update(encryptedData);
      const computedMac = mac.digest();
      
      if (!crypto.timingSafeEqual(expectedMac, computedMac)) {
        throw new Error('Media MAC verification failed');
      }
      
      // Create decipher
      const decipher = crypto.createDecipher('aes-256-cbc', mediaKey);
      decipher.setIVBytes(iv);
      
      // Decrypt media
      let decrypted = decipher.update(encryptedData);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted;
      
    } catch (error) {
      logger.error('Failed to decrypt media:', error);
      throw error;
    }
  }

  /**
   * Get public key in base64 format
   * 
   * @returns {string|null} Base64 encoded public key
   */
  getPublicKeyBase64() {
    return this.publicKey ? this.publicKey.toString('base64') : null;
  }

  /**
   * Get encryption keys info
   * 
   * @returns {Object} Keys information
   */
  getKeysInfo() {
    return {
      hasKeyPair: !!this.keyPair,
      hasSharedSecret: !!this.sharedSecret,
      hasEncKey: !!this.encKey,
      hasMacKey: !!this.macKey,
      publicKeySize: this.publicKey ? this.publicKey.length : 0,
      privateKeySize: this.privateKey ? this.privateKey.length : 0
    };
  }

  /**
   * Clear all cryptographic keys
   */
  clearKeys() {
    // Securely clear sensitive data
    if (this.privateKey) {
      this.privateKey.fill(0);
      this.privateKey = null;
    }
    
    if (this.sharedSecret) {
      this.sharedSecret.fill(0);
      this.sharedSecret = null;
    }
    
    if (this.encKey) {
      this.encKey.fill(0);
      this.encKey = null;
    }
    
    if (this.macKey) {
      this.macKey.fill(0);
      this.macKey = null;
    }
    
    this.publicKey = null;
    this.keyPair = null;
    
    logger.debug('Cryptographic keys cleared');
  }

  /**
   * Derive encryption and MAC keys from shared secret
   * @private
   */
  _deriveKeys() {
    if (!this.sharedSecret) {
      throw new Error('Shared secret not available');
    }

    // Use HKDF to derive keys from shared secret
    const salt = Buffer.alloc(32); // Zero salt for compatibility
    const info = Buffer.from('WhatsApp Web Keys', 'utf8');
    
    // Derive 64 bytes total (32 for encryption + 32 for MAC)
    const derivedKeys = this._hkdf(this.sharedSecret, salt, info, 64);
    
    // Split derived keys
    this.encKey = derivedKeys.slice(0, 32);
    this.macKey = derivedKeys.slice(32, 64);
    
    logger.debug('Encryption and MAC keys derived from shared secret');
  }

  /**
   * HMAC-based Key Derivation Function (HKDF)
   * @private
   */
  _hkdf(inputKeyMaterial, salt, info, length) {
    // Extract phase
    const prk = crypto.createHmac('sha256', salt.length > 0 ? salt : Buffer.alloc(32))
      .update(inputKeyMaterial)
      .digest();
    
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
}

module.exports = CryptoManager;
