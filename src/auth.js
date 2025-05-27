/**
 * Authentication Manager
 * Handles WhatsApp Web authentication including QR codes and pairing
 * 
 * @class AuthManager
 */

'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');
const qrcode = require('qrcode-terminal');
const { logger, sleep } = require('./utils');
const { AuthError } = require('./utils');
const { AuthStates, QRStates } = require('./constants');

/**
 * Authentication Manager for WhatsApp Web
 * 
 * @extends EventEmitter
 */
class AuthManager extends EventEmitter {
  /**
   * Create authentication manager
   * 
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    super();
    
    this.options = options;
    this.state = AuthStates.UNAUTHENTICATED;
    this.qrCode = null;
    this.pairingCode = null;
    this.clientToken = null;
    this.serverToken = null;
    this.encKey = null;
    this.macKey = null;
    this.sessionData = null;
    this.challenge = null;
    this.authTimeout = null;
    
    logger.debug('Authentication manager initialized', {
      strategy: options.authStrategy
    });
  }

  /**
   * Start authentication process
   * 
   * @returns {Promise<void>}
   */
  async authenticate() {
    try {
      logger.info('Starting authentication process...');
      this.state = AuthStates.AUTHENTICATING;
      
      // Check if we have existing session
      if (this.sessionData) {
        logger.info('Attempting to restore session...');
        if (await this._restoreSession()) {
          return;
        }
      }

      // Start new authentication
      if (this.options.authStrategy === 'pairing') {
        await this._startPairingAuth();
      } else {
        await this._startQRAuth();
      }
      
    } catch (error) {
      logger.error('Authentication failed:', error);
      this.state = AuthStates.FAILED;
      this.emit('auth_failure', error);
      throw new AuthError(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Request pairing code for phone authentication
   * 
   * @param {string} phoneNumber - Phone number in international format
   * @returns {Promise<string>} Pairing code
   */
  async requestPairingCode(phoneNumber) {
    try {
      logger.info('Requesting pairing code for:', phoneNumber);
      
      // Validate phone number format
      if (!this._validatePhoneNumber(phoneNumber)) {
        throw new AuthError('Invalid phone number format');
      }

      // Generate client keypair
      const { privateKey, publicKey } = this._generateKeyPair();
      this.clientToken = publicKey.toString('base64');

      // Send pairing request
      const pairingData = await this._sendPairingRequest(phoneNumber, publicKey);
      
      // Generate pairing code
      const code = this._generatePairingCode(pairingData);
      this.pairingCode = code;
      
      logger.info('Pairing code generated successfully');
      this.emit('pairing_code', code);
      
      return code;
      
    } catch (error) {
      logger.error('Failed to request pairing code:', error);
      throw new AuthError(`Failed to request pairing code: ${error.message}`);
    }
  }

  /**
   * Set session data for restoration
   * 
   * @param {Object} sessionData - Previously saved session data
   */
  setSession(sessionData) {
    this.sessionData = sessionData;
    
    if (sessionData) {
      this.clientToken = sessionData.clientToken;
      this.serverToken = sessionData.serverToken;
      this.encKey = sessionData.encKey ? Buffer.from(sessionData.encKey, 'base64') : null;
      this.macKey = sessionData.macKey ? Buffer.from(sessionData.macKey, 'base64') : null;
      
      logger.debug('Session data loaded');
    }
  }

  /**
   * Get current session data
   * 
   * @returns {Object|null} Session data or null if not authenticated
   */
  getSession() {
    if (!this.clientToken || !this.serverToken) {
      return null;
    }

    return {
      clientToken: this.clientToken,
      serverToken: this.serverToken,
      encKey: this.encKey ? this.encKey.toString('base64') : null,
      macKey: this.macKey ? this.macKey.toString('base64') : null,
      timestamp: Date.now()
    };
  }

  /**
   * Clear authentication data
   */
  clear() {
    this.state = AuthStates.UNAUTHENTICATED;
    this.qrCode = null;
    this.pairingCode = null;
    this.clientToken = null;
    this.serverToken = null;
    this.encKey = null;
    this.macKey = null;
    this.sessionData = null;
    this.challenge = null;
    
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }
    
    logger.debug('Authentication data cleared');
  }

  /**
   * Start QR code authentication
   * @private
   */
  async _startQRAuth() {
    logger.info('Starting QR code authentication...');
    
    // Generate client keypair
    const { privateKey, publicKey } = this._generateKeyPair();
    this.clientToken = publicKey.toString('base64');
    
    // Request QR challenge
    const qrData = await this._requestQRChallenge();
    
    // Generate QR code
    const qrString = this._generateQRCode(qrData, publicKey);
    this.qrCode = qrString;
    
    // Display QR code in terminal
    qrcode.generate(qrString, { small: true });
    
    logger.info('QR code generated, please scan with WhatsApp');
    this.emit('qr', qrString);
    
    // Wait for QR scan
    await this._waitForQRScan();
  }

  /**
   * Start pairing code authentication
   * @private
   */
  async _startPairingAuth() {
    logger.info('Starting pairing code authentication...');
    
    if (!this.options.phoneNumber) {
      throw new AuthError('Phone number required for pairing authentication');
    }

    const code = await this.requestPairingCode(this.options.phoneNumber);
    
    // Wait for pairing completion
    await this._waitForPairingCompletion();
  }

  /**
   * Restore session from saved data
   * @private
   */
  async _restoreSession() {
    try {
      logger.info('Attempting to restore session...');
      
      if (!this.sessionData || !this.sessionData.clientToken || !this.sessionData.serverToken) {
        logger.warn('Incomplete session data, cannot restore');
        return false;
      }

      // Validate session with server
      const isValid = await this._validateSession();
      
      if (isValid) {
        this.state = AuthStates.AUTHENTICATED;
        logger.info('Session restored successfully');
        this.emit('authenticated', { restored: true });
        this.emit('ready');
        return true;
      } else {
        logger.warn('Session validation failed, starting fresh authentication');
        this.clear();
        return false;
      }
      
    } catch (error) {
      logger.error('Failed to restore session:', error);
      this.clear();
      return false;
    }
  }

  /**
   * Generate cryptographic key pair
   * @private
   */
  _generateKeyPair() {
    const privateKey = crypto.randomBytes(32);
    const publicKey = crypto.createECDH('prime256v1');
    publicKey.setPrivateKey(privateKey);
    
    return {
      privateKey,
      publicKey: publicKey.getPublicKey()
    };
  }

  /**
   * Request QR challenge from server
   * @private
   */
  async _requestQRChallenge() {
    // Simulate QR challenge request
    // In real implementation, this would connect to WhatsApp servers
    return {
      challenge: crypto.randomBytes(16).toString('base64'),
      timestamp: Date.now()
    };
  }

  /**
   * Generate QR code string
   * @private
   */
  _generateQRCode(qrData, publicKey) {
    const qrPayload = {
      publicKey: publicKey.toString('base64'),
      challenge: qrData.challenge,
      timestamp: qrData.timestamp,
      ref: crypto.randomBytes(16).toString('hex')
    };
    
    return JSON.stringify(qrPayload);
  }

  /**
   * Wait for QR code to be scanned
   * @private
   */
  async _waitForQRScan() {
    return new Promise((resolve, reject) => {
      // Set timeout for QR scan
      this.authTimeout = setTimeout(() => {
        reject(new AuthError('QR code scan timeout'));
      }, 120000); // 2 minutes

      // Simulate QR scan detection
      // In real implementation, this would listen for WebSocket messages
      setTimeout(() => {
        this._handleQRScanSuccess();
        resolve();
      }, 10000); // Simulate 10 second scan
    });
  }

  /**
   * Handle successful QR scan
   * @private
   */
  _handleQRScanSuccess() {
    logger.info('QR code scanned successfully');
    
    // Generate session tokens
    this.serverToken = crypto.randomBytes(32).toString('base64');
    this.encKey = crypto.randomBytes(32);
    this.macKey = crypto.randomBytes(32);
    
    this.state = AuthStates.AUTHENTICATED;
    
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }
    
    const user = {
      id: '1234567890@c.us',
      name: 'User Name',
      phone: '+1234567890',
      platform: 'WhatsApp Web'
    };
    
    this.emit('authenticated', user);
    this.emit('ready');
  }

  /**
   * Send pairing request to server
   * @private
   */
  async _sendPairingRequest(phoneNumber, publicKey) {
    // Simulate pairing request
    // In real implementation, this would send HTTP request to WhatsApp
    return {
      ref: crypto.randomBytes(16).toString('hex'),
      challenge: crypto.randomBytes(16).toString('base64'),
      timestamp: Date.now()
    };
  }

  /**
   * Generate pairing code from pairing data
   * @private
   */
  _generatePairingCode(pairingData) {
    // Generate 8-digit pairing code
    const code = Math.floor(10000000 + Math.random() * 90000000).toString();
    return code.match(/.{1,4}/g).join('-'); // Format as XXXX-XXXX
  }

  /**
   * Wait for pairing completion
   * @private
   */
  async _waitForPairingCompletion() {
    return new Promise((resolve, reject) => {
      // Set timeout for pairing
      this.authTimeout = setTimeout(() => {
        reject(new AuthError('Pairing timeout'));
      }, 300000); // 5 minutes

      // Simulate pairing completion
      // In real implementation, this would listen for WebSocket messages
      setTimeout(() => {
        this._handlePairingSuccess();
        resolve();
      }, 15000); // Simulate 15 second pairing
    });
  }

  /**
   * Handle successful pairing
   * @private
   */
  _handlePairingSuccess() {
    logger.info('Device paired successfully');
    
    // Generate session tokens
    this.serverToken = crypto.randomBytes(32).toString('base64');
    this.encKey = crypto.randomBytes(32);
    this.macKey = crypto.randomBytes(32);
    
    this.state = AuthStates.AUTHENTICATED;
    
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }
    
    const user = {
      id: this.options.phoneNumber.replace(/\D/g, '') + '@c.us',
      name: 'User Name',
      phone: this.options.phoneNumber,
      platform: 'WhatsApp Web'
    };
    
    this.emit('authenticated', user);
    this.emit('ready');
  }

  /**
   * Validate existing session with server
   * @private
   */
  async _validateSession() {
    // Simulate session validation
    // In real implementation, this would send validation request to WhatsApp
    
    // Check if session is not too old (7 days)
    const sessionAge = Date.now() - (this.sessionData.timestamp || 0);
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    return sessionAge < maxAge;
  }

  /**
   * Validate phone number format
   * @private
   */
  _validatePhoneNumber(phoneNumber) {
    // Basic international phone number validation
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber);
  }
}

module.exports = AuthManager;
