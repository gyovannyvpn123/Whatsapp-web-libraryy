/**
 * WhatsApp Web Client
 * Main client class for WhatsApp Web interactions
 * 
 * @class WhatsAppClient
 */

'use strict';

const EventEmitter = require('events');
const WebSocketManager = require('./websocket');
const AuthManager = require('./auth');
const MessageManager = require('./messages');
const MediaManager = require('./media');
const ReactionManager = require('./reactions');
const GroupManager = require('./groups');
const ContactManager = require('./contacts');
const StatusManager = require('./status');
const SessionManager = require('./session');
const CryptoManager = require('./crypto');
const { logger } = require('./utils');
const { ConnectionError, AuthError } = require('./utils');
const { ClientStates, DefaultOptions } = require('./constants');

/**
 * WhatsApp Web Client
 * 
 * @extends EventEmitter
 */
class WhatsAppClient extends EventEmitter {
  /**
   * Create a WhatsApp client
   * 
   * @param {Object} options - Client configuration
   * @param {string} [options.authStrategy='qr'] - Authentication strategy ('qr' or 'pairing')
   * @param {string} [options.sessionPath='./session'] - Path to store session data
   * @param {string} [options.phoneNumber] - Phone number for pairing authentication
   * @param {boolean} [options.headless=true] - Run in headless mode
   * @param {string} [options.userAgent] - Custom user agent string
   * @param {string} [options.proxyUrl] - Proxy URL for connections
   * @param {number} [options.maxRetries=3] - Maximum connection retries
   * @param {number} [options.retryDelay=5000] - Delay between retries (ms)
   * @param {number} [options.messageTimeout=30000] - Message timeout (ms)
   * @param {Object} [options.rateLimit] - Rate limiting configuration
   * @param {number} [options.rateLimit.messages=20] - Messages per interval
   * @param {number} [options.rateLimit.interval=60000] - Rate limit interval (ms)
   */
  constructor(options = {}) {
    super();
    
    // Merge options with defaults
    this.options = { ...DefaultOptions, ...options };
    
    // Client state
    this.state = ClientStates.DISCONNECTED;
    this.info = null;
    this.user = null;
    
    // Initialize managers
    this._initializeManagers();
    
    // Setup event handlers
    this._setupEventHandlers();
    
    // Rate limiting
    this._messageQueue = [];
    this._rateLimitTimer = null;
    
    logger.info('WhatsApp client initialized', { 
      authStrategy: this.options.authStrategy,
      sessionPath: this.options.sessionPath 
    });
  }

  /**
   * Initialize all manager instances
   * @private
   */
  _initializeManagers() {
    this.websocket = new WebSocketManager(this.options);
    this.auth = new AuthManager(this.options);
    this.messages = new MessageManager(this);
    this.media = new MediaManager(this);
    this.reactions = new ReactionManager(this);
    this.groups = new GroupManager(this);
    this.contacts = new ContactManager(this);
    this.status = new StatusManager(this);
    this.session = new SessionManager(this.options);
    this.crypto = new CryptoManager();
  }

  /**
   * Setup event handlers between managers
   * @private
   */
  _setupEventHandlers() {
    // WebSocket events
    this.websocket.on('connected', () => {
      this.state = ClientStates.CONNECTED;
      this.emit('connected');
    });

    this.websocket.on('disconnected', (reason) => {
      this.state = ClientStates.DISCONNECTED;
      this.emit('disconnected', reason);
    });

    this.websocket.on('message', (data) => {
      this._handleWebSocketMessage(data);
    });

    this.websocket.on('error', (error) => {
      logger.error('WebSocket error:', error);
      this.emit('error', error);
    });

    // Authentication events
    this.auth.on('qr', (qr) => {
      this.emit('qr', qr);
    });

    this.auth.on('pairing_code', (code) => {
      this.emit('pairing_code', code);
    });

    this.auth.on('authenticated', (user) => {
      this.state = ClientStates.AUTHENTICATED;
      this.user = user;
      this.emit('authenticated', user);
    });

    this.auth.on('auth_failure', (error) => {
      this.state = ClientStates.AUTH_FAILED;
      this.emit('auth_failure', error);
    });

    this.auth.on('ready', () => {
      this.state = ClientStates.READY;
      this.emit('ready');
    });

    // Message events
    this.messages.on('message', (message) => {
      this.emit('message', message);
    });

    this.messages.on('message_edit', (message) => {
      this.emit('message_edit', message);
    });

    this.messages.on('message_delete', (message) => {
      this.emit('message_delete', message);
    });

    // Group events
    this.groups.on('group_join', (notification) => {
      this.emit('group_join', notification);
    });

    this.groups.on('group_leave', (notification) => {
      this.emit('group_leave', notification);
    });

    this.groups.on('group_update', (notification) => {
      this.emit('group_update', notification);
    });

    // Contact events
    this.contacts.on('contact_changed', (contact) => {
      this.emit('contact_changed', contact);
    });

    // Status events
    this.status.on('status_update', (status) => {
      this.emit('status_update', status);
    });

    // Reaction events
    this.reactions.on('message_reaction', (reaction) => {
      this.emit('message_reaction', reaction);
    });
  }

  /**
   * Initialize the WhatsApp client
   * 
   * @returns {Promise<void>}
   * @throws {ConnectionError} When connection fails
   * @throws {AuthError} When authentication fails
   */
  async initialize() {
    try {
      logger.info('Initializing WhatsApp client...');
      
      this.state = ClientStates.INITIALIZING;
      
      // Load existing session if available
      const sessionData = await this.session.load();
      if (sessionData) {
        logger.info('Found existing session, attempting to restore...');
        this.auth.setSession(sessionData);
      }

      // Initialize crypto manager
      await this.crypto.initialize();

      // Connect WebSocket
      await this.websocket.connect();

      // Start authentication process
      await this.auth.authenticate();

      // Start rate limiting
      this._startRateLimiting();

      logger.info('WhatsApp client initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize client:', error);
      this.state = ClientStates.FAILED;
      
      if (error.name === 'AuthError') {
        throw new AuthError(`Authentication failed: ${error.message}`);
      } else {
        throw new ConnectionError(`Failed to initialize client: ${error.message}`);
      }
    }
  }

  /**
   * Destroy the client and cleanup resources
   * 
   * @returns {Promise<void>}
   */
  async destroy() {
    try {
      logger.info('Destroying WhatsApp client...');
      
      this.state = ClientStates.DISCONNECTING;
      
      // Stop rate limiting
      this._stopRateLimiting();
      
      // Close WebSocket connection
      if (this.websocket) {
        await this.websocket.disconnect();
      }
      
      // Clear session if needed
      if (this.session) {
        await this.session.clear();
      }
      
      // Remove all listeners
      this.removeAllListeners();
      
      this.state = ClientStates.DESTROYED;
      
      logger.info('WhatsApp client destroyed');
      
    } catch (error) {
      logger.error('Error destroying client:', error);
      throw error;
    }
  }

  /**
   * Logout and clear session
   * 
   * @returns {Promise<void>}
   */
  async logout() {
    try {
      logger.info('Logging out...');
      
      // Send logout message to server
      if (this.state === ClientStates.READY) {
        await this.websocket.sendMessage({
          tag: 'logout'
        });
      }
      
      // Clear session data
      await this.session.clear();
      
      // Reset state
      this.state = ClientStates.DISCONNECTED;
      this.user = null;
      
      this.emit('logout');
      
      logger.info('Logged out successfully');
      
    } catch (error) {
      logger.error('Error during logout:', error);
      throw error;
    }
  }

  /**
   * Request pairing code for phone authentication
   * 
   * @param {string} phoneNumber - Phone number in international format
   * @returns {Promise<string>} Pairing code
   */
  async requestPairingCode(phoneNumber) {
    return this.auth.requestPairingCode(phoneNumber);
  }

  /**
   * Send a message
   * 
   * @param {string} chatId - Chat ID to send message to
   * @param {string|Object} content - Message content
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object>} Sent message object
   */
  async sendMessage(chatId, content, options = {}) {
    this._checkReady();
    return this._queueMessage(() => this.messages.send(chatId, content, options));
  }

  /**
   * Send text message
   * 
   * @param {string} chatId - Chat ID
   * @param {string} text - Text content
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object>} Sent message object
   */
  async sendText(chatId, text, options = {}) {
    return this.sendMessage(chatId, text, options);
  }

  /**
   * Send media message
   * 
   * @param {string} chatId - Chat ID
   * @param {Object} media - Media object
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object>} Sent message object
   */
  async sendMedia(chatId, media, options = {}) {
    this._checkReady();
    return this._queueMessage(() => this.media.send(chatId, media, options));
  }

  /**
   * Get client information
   * 
   * @returns {Object} Client information
   */
  getInfo() {
    return {
      state: this.state,
      user: this.user,
      platform: this.info?.platform || 'unknown',
      version: this.info?.version || 'unknown',
      connected: this.state === ClientStates.READY
    };
  }

  /**
   * Check if client is ready
   * @private
   */
  _checkReady() {
    if (this.state !== ClientStates.READY) {
      throw new Error(`Client not ready. Current state: ${this.state}`);
    }
  }

  /**
   * Handle incoming WebSocket messages
   * @private
   */
  async _handleWebSocketMessage(data) {
    try {
      // Decrypt message if needed
      if (data.encrypted) {
        data = await this.crypto.decrypt(data);
      }

      // Route message to appropriate handler
      if (data.tag === 'message') {
        await this.messages.handleIncoming(data);
      } else if (data.tag === 'notification') {
        await this._handleNotification(data);
      } else if (data.tag === 'presence') {
        await this.contacts.handlePresence(data);
      } else if (data.tag === 'status') {
        await this.status.handleUpdate(data);
      }
      
    } catch (error) {
      logger.error('Error handling WebSocket message:', error);
      this.emit('error', error);
    }
  }

  /**
   * Handle notifications
   * @private
   */
  async _handleNotification(data) {
    switch (data.type) {
      case 'group_participant_add':
      case 'group_participant_remove':
      case 'group_participant_promote':
      case 'group_participant_demote':
        await this.groups.handleNotification(data);
        break;
      case 'contact_changed':
        await this.contacts.handleUpdate(data);
        break;
      default:
        logger.debug('Unhandled notification type:', data.type);
    }
  }

  /**
   * Queue message for rate limiting
   * @private
   */
  async _queueMessage(messageFunction) {
    return new Promise((resolve, reject) => {
      this._messageQueue.push({
        function: messageFunction,
        resolve,
        reject,
        timestamp: Date.now()
      });
    });
  }

  /**
   * Start rate limiting timer
   * @private
   */
  _startRateLimiting() {
    if (this._rateLimitTimer) {
      return;
    }

    const { messages, interval } = this.options.rateLimit;
    const delayPerMessage = interval / messages;

    this._rateLimitTimer = setInterval(async () => {
      if (this._messageQueue.length === 0) {
        return;
      }

      const message = this._messageQueue.shift();
      
      try {
        const result = await message.function();
        message.resolve(result);
      } catch (error) {
        message.reject(error);
      }
      
    }, delayPerMessage);
  }

  /**
   * Stop rate limiting timer
   * @private
   */
  _stopRateLimiting() {
    if (this._rateLimitTimer) {
      clearInterval(this._rateLimitTimer);
      this._rateLimitTimer = null;
    }

    // Reject all pending messages
    this._messageQueue.forEach(message => {
      message.reject(new Error('Client shutting down'));
    });
    this._messageQueue = [];
  }
}

module.exports = WhatsAppClient;
