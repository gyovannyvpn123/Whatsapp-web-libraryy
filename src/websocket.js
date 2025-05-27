/**
 * WebSocket Manager
 * Handles WebSocket connections to WhatsApp Web servers
 * 
 * @class WebSocketManager
 */

'use strict';

const EventEmitter = require('events');
const WebSocket = require('ws');
const { logger, generateUserAgent, sleep } = require('./utils');
const { ConnectionError } = require('./utils');
const { WSStates, WAUrls } = require('./constants');

/**
 * WebSocket Manager for WhatsApp Web connections
 * 
 * @extends EventEmitter
 */
class WebSocketManager extends EventEmitter {
  /**
   * Create WebSocket manager
   * 
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    super();
    
    this.options = options;
    this.ws = null;
    this.state = WSStates.DISCONNECTED;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxRetries || 3;
    this.reconnectDelay = options.retryDelay || 5000;
    this.pingInterval = null;
    this.pongTimeout = null;
    this.messageQueue = [];
    this.isConnecting = false;
    
    // Connection parameters
    this.userAgent = options.userAgent || generateUserAgent();
    this.origin = WAUrls.WEB_ORIGIN;
    this.serverUrl = WAUrls.WEBSOCKET_URL;
    
    logger.debug('WebSocket manager initialized', {
      userAgent: this.userAgent,
      maxRetries: this.maxReconnectAttempts
    });
  }

  /**
   * Connect to WhatsApp Web WebSocket server
   * 
   * @returns {Promise<void>}
   * @throws {ConnectionError} When connection fails
   */
  async connect() {
    if (this.isConnecting || this.state === WSStates.CONNECTED) {
      return;
    }

    this.isConnecting = true;
    logger.info('Connecting to WhatsApp Web...');

    try {
      await this._establishConnection();
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      
      logger.info('Successfully connected to WhatsApp Web');
      this.emit('connected');
      
    } catch (error) {
      this.isConnecting = false;
      logger.error('Failed to connect to WhatsApp Web:', error);
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        await this._scheduleReconnect();
      } else {
        throw new ConnectionError(`Failed to connect after ${this.maxReconnectAttempts} attempts`);
      }
    }
  }

  /**
   * Disconnect from WebSocket server
   * 
   * @returns {Promise<void>}
   */
  async disconnect() {
    logger.info('Disconnecting from WhatsApp Web...');
    
    this._cleanup();
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Client disconnect');
    }
    
    this.state = WSStates.DISCONNECTED;
    this.emit('disconnected', 'CLIENT_DISCONNECT');
  }

  /**
   * Send message through WebSocket
   * 
   * @param {Object} message - Message to send
   * @returns {Promise<void>}
   * @throws {Error} When not connected or message fails to send
   */
  async sendMessage(message) {
    if (this.state !== WSStates.CONNECTED) {
      throw new Error('WebSocket not connected');
    }

    const messageData = this._serializeMessage(message);
    
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket connection not open'));
        return;
      }

      this.ws.send(messageData, (error) => {
        if (error) {
          logger.error('Failed to send message:', error);
          reject(error);
        } else {
          logger.debug('Message sent successfully', { tag: message.tag });
          resolve();
        }
      });
    });
  }

  /**
   * Send binary data through WebSocket
   * 
   * @param {Buffer} data - Binary data to send
   * @returns {Promise<void>}
   */
  async sendBinary(data) {
    if (this.state !== WSStates.CONNECTED) {
      throw new Error('WebSocket not connected');
    }

    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket connection not open'));
        return;
      }

      this.ws.send(data, { binary: true }, (error) => {
        if (error) {
          logger.error('Failed to send binary data:', error);
          reject(error);
        } else {
          logger.debug('Binary data sent successfully');
          resolve();
        }
      });
    });
  }

  /**
   * Get connection state
   * 
   * @returns {string} Current connection state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if WebSocket is connected
   * 
   * @returns {boolean} True if connected
   */
  isConnected() {
    return this.state === WSStates.CONNECTED && 
           this.ws && 
           this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Establish WebSocket connection
   * @private
   */
  async _establishConnection() {
    return new Promise((resolve, reject) => {
      const wsOptions = {
        headers: {
          'Origin': this.origin,
          'User-Agent': this.userAgent,
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 30000,
        handshakeTimeout: 30000
      };

      // Add proxy support if configured
      if (this.options.proxyUrl) {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        wsOptions.agent = new HttpsProxyAgent(this.options.proxyUrl);
      }

      this.ws = new WebSocket(this.serverUrl, wsOptions);
      
      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        this.ws.terminate();
        reject(new ConnectionError('Connection timeout'));
      }, 30000);

      this.ws.on('open', () => {
        clearTimeout(connectionTimeout);
        this.state = WSStates.CONNECTED;
        this._setupHeartbeat();
        resolve();
      });

      this.ws.on('message', (data, isBinary) => {
        this._handleMessage(data, isBinary);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(connectionTimeout);
        this._handleClose(code, reason?.toString());
      });

      this.ws.on('error', (error) => {
        clearTimeout(connectionTimeout);
        logger.error('WebSocket error:', error);
        reject(error);
      });

      this.ws.on('pong', () => {
        logger.debug('Received pong from server');
        if (this.pongTimeout) {
          clearTimeout(this.pongTimeout);
          this.pongTimeout = null;
        }
      });
    });
  }

  /**
   * Handle incoming messages
   * @private
   */
  _handleMessage(data, isBinary) {
    try {
      let message;
      
      if (isBinary) {
        message = this._deserializeBinary(data);
      } else {
        message = this._deserializeMessage(data);
      }

      logger.debug('Received message', { 
        tag: message.tag || 'unknown',
        type: message.type || 'unknown',
        size: data.length 
      });

      this.emit('message', message);
      
    } catch (error) {
      logger.error('Failed to parse incoming message:', error);
      this.emit('error', error);
    }
  }

  /**
   * Handle WebSocket close
   * @private
   */
  _handleClose(code, reason) {
    logger.info('WebSocket connection closed', { code, reason });
    
    this._cleanup();
    this.state = WSStates.DISCONNECTED;
    
    const wasConnected = this.reconnectAttempts === 0;
    
    this.emit('disconnected', reason || 'CONNECTION_CLOSED');
    
    // Auto-reconnect if not intentionally closed
    if (code !== 1000 && code !== 1001 && wasConnected) {
      this._scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   * @private
   */
  async _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Maximum reconnection attempts reached');
      this.emit('error', new ConnectionError('Maximum reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
    logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    await sleep(delay);
    
    try {
      await this.connect();
    } catch (error) {
      logger.error('Reconnection attempt failed:', error);
    }
  }

  /**
   * Setup heartbeat mechanism
   * @private
   */
  _setupHeartbeat() {
    this._cleanup();
    
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        logger.debug('Sending ping to server');
        this.ws.ping();
        
        // Set timeout for pong response
        this.pongTimeout = setTimeout(() => {
          logger.warn('Pong timeout, closing connection');
          this.ws.terminate();
        }, 10000);
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Cleanup timers and listeners
   * @private
   */
  _cleanup() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Serialize message for sending
   * @private
   */
  _serializeMessage(message) {
    try {
      // Add timestamp and message ID
      const enrichedMessage = {
        ...message,
        id: message.id || this._generateMessageId(),
        timestamp: message.timestamp || Date.now()
      };

      return JSON.stringify(enrichedMessage);
      
    } catch (error) {
      throw new Error(`Failed to serialize message: ${error.message}`);
    }
  }

  /**
   * Deserialize incoming message
   * @private
   */
  _deserializeMessage(data) {
    try {
      const text = data.toString('utf8');
      return JSON.parse(text);
      
    } catch (error) {
      // Try to handle as raw text
      return {
        tag: 'raw',
        data: data.toString('utf8')
      };
    }
  }

  /**
   * Deserialize binary message
   * @private
   */
  _deserializeBinary(data) {
    // Implementation depends on WhatsApp's binary protocol
    // This is a simplified version
    return {
      tag: 'binary',
      data: data,
      size: data.length
    };
  }

  /**
   * Generate unique message ID
   * @private
   */
  _generateMessageId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = WebSocketManager;
