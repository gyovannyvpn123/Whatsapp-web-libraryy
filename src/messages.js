/**
 * Message Manager
 * Handles sending, receiving and managing WhatsApp messages
 * 
 * @class MessageManager
 */

'use strict';

const EventEmitter = require('events');
const { logger, generateMessageId, formatPhoneNumber } = require('./utils');
const { MessageError } = require('./utils');
const { MessageTypes, ChatTypes } = require('./constants');

/**
 * Message Manager for WhatsApp Web
 * 
 * @extends EventEmitter
 */
class MessageManager extends EventEmitter {
  /**
   * Create message manager
   * 
   * @param {WhatsAppClient} client - WhatsApp client instance
   */
  constructor(client) {
    super();
    
    this.client = client;
    this.pendingMessages = new Map();
    this.messageCache = new Map();
    this.typingStates = new Map();
    
    logger.debug('Message manager initialized');
  }

  /**
   * Send a message
   * 
   * @param {string} chatId - Chat ID to send message to
   * @param {string|Object} content - Message content
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object>} Sent message object
   */
  async send(chatId, content, options = {}) {
    try {
      logger.debug('Sending message', { chatId, type: typeof content });

      // Validate chat ID
      if (!this._validateChatId(chatId)) {
        throw new MessageError('Invalid chat ID format');
      }

      // Prepare message data
      const messageData = await this._prepareMessage(chatId, content, options);
      
      // Send through WebSocket
      await this.client.websocket.sendMessage(messageData);
      
      // Store in pending messages
      this.pendingMessages.set(messageData.id, {
        ...messageData,
        timestamp: Date.now(),
        status: 'pending'
      });

      // Create message object
      const message = {
        id: messageData.id,
        chatId: chatId,
        fromMe: true,
        timestamp: Date.now(),
        type: messageData.type || 'text',
        body: content,
        status: 'pending',
        ...options
      };

      logger.info('Message sent successfully', { messageId: message.id, chatId });
      
      return message;
      
    } catch (error) {
      logger.error('Failed to send message:', error);
      throw new MessageError(`Failed to send message: ${error.message}`);
    }
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
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new MessageError('Text content cannot be empty');
    }

    return this.send(chatId, text, { ...options, type: MessageTypes.TEXT });
  }

  /**
   * Send location message
   * 
   * @param {string} chatId - Chat ID
   * @param {Object} location - Location data
   * @param {number} location.latitude - Latitude
   * @param {number} location.longitude - Longitude
   * @param {string} [location.name] - Location name
   * @param {string} [location.address] - Location address
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object>} Sent message object
   */
  async sendLocation(chatId, location, options = {}) {
    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      throw new MessageError('Invalid location data');
    }

    const locationData = {
      type: MessageTypes.LOCATION,
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name || '',
      address: location.address || ''
    };

    return this.send(chatId, locationData, options);
  }

  /**
   * Send contact message
   * 
   * @param {string} chatId - Chat ID
   * @param {Object} contact - Contact data
   * @param {string} contact.name - Contact name
   * @param {string} contact.phone - Contact phone number
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object>} Sent message object
   */
  async sendContact(chatId, contact, options = {}) {
    if (!contact || !contact.name || !contact.phone) {
      throw new MessageError('Contact name and phone are required');
    }

    const contactData = {
      type: MessageTypes.CONTACT,
      name: contact.name,
      phone: formatPhoneNumber(contact.phone),
      ...contact
    };

    return this.send(chatId, contactData, options);
  }

  /**
   * Reply to a message
   * 
   * @param {string} messageId - ID of message to reply to
   * @param {string|Object} content - Reply content
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object>} Sent reply message
   */
  async replyToMessage(messageId, content, options = {}) {
    const originalMessage = this.messageCache.get(messageId);
    
    if (!originalMessage) {
      throw new MessageError('Original message not found');
    }

    const replyOptions = {
      ...options,
      quotedMessage: {
        id: messageId,
        chatId: originalMessage.chatId,
        content: originalMessage.body,
        author: originalMessage.author
      }
    };

    return this.send(originalMessage.chatId, content, replyOptions);
  }

  /**
   * Edit a message
   * 
   * @param {string} messageId - Message ID to edit
   * @param {string} newContent - New message content
   * @returns {Promise<Object>} Edited message object
   */
  async editMessage(messageId, newContent) {
    try {
      const message = this.pendingMessages.get(messageId) || this.messageCache.get(messageId);
      
      if (!message) {
        throw new MessageError('Message not found');
      }

      if (!message.fromMe) {
        throw new MessageError('Can only edit own messages');
      }

      const editData = {
        tag: 'message_edit',
        id: generateMessageId(),
        messageId: messageId,
        newContent: newContent,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(editData);

      logger.info('Message edited successfully', { messageId });
      
      const editedMessage = {
        ...message,
        body: newContent,
        edited: true,
        editTimestamp: Date.now()
      };

      this.messageCache.set(messageId, editedMessage);
      this.emit('message_edit', editedMessage);

      return editedMessage;
      
    } catch (error) {
      logger.error('Failed to edit message:', error);
      throw new MessageError(`Failed to edit message: ${error.message}`);
    }
  }

  /**
   * Delete a message
   * 
   * @param {string} messageId - Message ID to delete
   * @param {boolean} [forEveryone=false] - Delete for everyone
   * @returns {Promise<void>}
   */
  async deleteMessage(messageId, forEveryone = false) {
    try {
      const message = this.pendingMessages.get(messageId) || this.messageCache.get(messageId);
      
      if (!message) {
        throw new MessageError('Message not found');
      }

      if (forEveryone && !message.fromMe) {
        throw new MessageError('Can only delete own messages for everyone');
      }

      const deleteData = {
        tag: 'message_delete',
        id: generateMessageId(),
        messageId: messageId,
        forEveryone: forEveryone,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(deleteData);

      logger.info('Message deleted successfully', { messageId, forEveryone });
      
      // Remove from caches
      this.pendingMessages.delete(messageId);
      this.messageCache.delete(messageId);

      this.emit('message_delete', { messageId, forEveryone });
      
    } catch (error) {
      logger.error('Failed to delete message:', error);
      throw new MessageError(`Failed to delete message: ${error.message}`);
    }
  }

  /**
   * Send typing indicator
   * 
   * @param {string} chatId - Chat ID
   * @param {boolean} [isTyping=true] - Whether currently typing
   * @returns {Promise<void>}
   */
  async sendTyping(chatId, isTyping = true) {
    try {
      const typingData = {
        tag: 'chatstate',
        chatId: chatId,
        state: isTyping ? 'composing' : 'paused',
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(typingData);
      
      this.typingStates.set(chatId, isTyping);
      
      logger.debug('Typing state sent', { chatId, isTyping });
      
    } catch (error) {
      logger.error('Failed to send typing state:', error);
    }
  }

  /**
   * Mark messages as read
   * 
   * @param {string} chatId - Chat ID
   * @param {string[]} [messageIds] - Specific message IDs to mark as read
   * @returns {Promise<void>}
   */
  async markAsRead(chatId, messageIds = []) {
    try {
      const readData = {
        tag: 'read_receipt',
        chatId: chatId,
        messageIds: messageIds,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(readData);
      
      logger.debug('Messages marked as read', { chatId, count: messageIds.length });
      
    } catch (error) {
      logger.error('Failed to mark messages as read:', error);
    }
  }

  /**
   * Search messages
   * 
   * @param {string} query - Search query
   * @param {Object} [options={}] - Search options
   * @param {string} [options.chatId] - Limit search to specific chat
   * @param {number} [options.limit=50] - Maximum results
   * @param {number} [options.offset=0] - Results offset
   * @returns {Promise<Array>} Search results
   */
  async searchMessages(query, options = {}) {
    try {
      const searchData = {
        tag: 'message_search',
        query: query,
        chatId: options.chatId,
        limit: options.limit || 50,
        offset: options.offset || 0,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(searchData);
      
      // In real implementation, this would wait for search results
      // For now, return empty array
      return [];
      
    } catch (error) {
      logger.error('Failed to search messages:', error);
      throw new MessageError(`Failed to search messages: ${error.message}`);
    }
  }

  /**
   * Handle incoming message
   * 
   * @param {Object} data - Message data from WebSocket
   */
  async handleIncoming(data) {
    try {
      const message = await this._parseIncomingMessage(data);
      
      // Cache the message
      this.messageCache.set(message.id, message);
      
      // Update pending message status if it's our own
      if (this.pendingMessages.has(message.id)) {
        const pending = this.pendingMessages.get(message.id);
        pending.status = 'sent';
        this.pendingMessages.set(message.id, pending);
      }

      logger.debug('Incoming message processed', { 
        messageId: message.id, 
        chatId: message.chatId,
        type: message.type 
      });
      
      this.emit('message', message);
      
    } catch (error) {
      logger.error('Failed to handle incoming message:', error);
    }
  }

  /**
   * Prepare message data for sending
   * @private
   */
  async _prepareMessage(chatId, content, options) {
    const messageId = generateMessageId();
    
    let messageData = {
      tag: 'message',
      id: messageId,
      chatId: chatId,
      timestamp: Date.now(),
      type: MessageTypes.TEXT
    };

    // Handle different content types
    if (typeof content === 'string') {
      messageData.body = content;
      messageData.type = MessageTypes.TEXT;
    } else if (typeof content === 'object') {
      messageData = { ...messageData, ...content };
    }

    // Add quoted message if replying
    if (options.quotedMessage) {
      messageData.quotedMessage = options.quotedMessage;
    }

    // Add mentions if any
    if (options.mentions && options.mentions.length > 0) {
      messageData.mentions = options.mentions;
    }

    return messageData;
  }

  /**
   * Parse incoming message data
   * @private
   */
  async _parseIncomingMessage(data) {
    const message = {
      id: data.id || generateMessageId(),
      chatId: data.chatId || data.from,
      fromMe: data.fromMe || false,
      author: data.author || data.participant || data.from,
      timestamp: data.timestamp || Date.now(),
      type: data.type || MessageTypes.TEXT,
      body: data.body || data.text || '',
      status: 'received'
    };

    // Handle different message types
    switch (data.type) {
      case MessageTypes.IMAGE:
      case MessageTypes.VIDEO:
      case MessageTypes.AUDIO:
      case MessageTypes.DOCUMENT:
        message.hasMedia = true;
        message.mediaData = data.mediaData;
        message.caption = data.caption;
        break;
      
      case MessageTypes.LOCATION:
        message.location = {
          latitude: data.latitude,
          longitude: data.longitude,
          name: data.locationName,
          address: data.locationAddress
        };
        break;
      
      case MessageTypes.CONTACT:
        message.contact = {
          name: data.contactName,
          phone: data.contactPhone,
          vcard: data.vcard
        };
        break;
    }

    // Handle quoted messages
    if (data.quotedMessage) {
      message.quotedMessage = data.quotedMessage;
    }

    // Handle mentions
    if (data.mentions) {
      message.mentions = data.mentions;
    }

    return message;
  }

  /**
   * Validate chat ID format
   * @private
   */
  _validateChatId(chatId) {
    if (!chatId || typeof chatId !== 'string') {
      return false;
    }

    // WhatsApp chat ID formats:
    // Individual: number@c.us
    // Group: number-timestamp@g.us
    // Broadcast: status@broadcast
    const chatIdRegex = /^(\d+@c\.us|\d+-\d+@g\.us|status@broadcast)$/;
    return chatIdRegex.test(chatId);
  }

  /**
   * Clean up old pending messages
   * @private
   */
  _cleanupPendingMessages() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [messageId, message] of this.pendingMessages) {
      if (now - message.timestamp > timeout) {
        this.pendingMessages.delete(messageId);
        logger.debug('Cleaned up expired pending message', { messageId });
      }
    }
  }
}

module.exports = MessageManager;
