/**
 * Contact Manager
 * Handles WhatsApp contact management, presence, and profile operations
 * 
 * @class ContactManager
 */

'use strict';

const EventEmitter = require('events');
const { logger, generateMessageId, formatPhoneNumber, validatePhoneNumber } = require('./utils');
const { MessageError } = require('./utils');
const { PresenceTypes, ContactStates } = require('./constants');

/**
 * Contact Manager for WhatsApp Web
 * 
 * @extends EventEmitter
 */
class ContactManager extends EventEmitter {
  /**
   * Create contact manager
   * 
   * @param {WhatsAppClient} client - WhatsApp client instance
   */
  constructor(client) {
    super();
    
    this.client = client;
    this.contactCache = new Map();
    this.presenceCache = new Map();
    this.profilePictureCache = new Map();
    this.statusCache = new Map();
    this.lastSeenCache = new Map();
    
    // Presence tracking
    this.presenceSubscriptions = new Set();
    this.presenceCleanupInterval = null;
    
    logger.debug('Contact manager initialized');
    this._startPresenceCleanup();
  }

  /**
   * Get contact information
   * 
   * @param {string} contactId - Contact ID (phone number)
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.forceRefresh=false] - Force refresh from server
   * @returns {Promise<Object>} Contact information
   */
  async getContact(contactId, options = {}) {
    try {
      const formattedId = formatPhoneNumber(contactId);
      
      // Check cache first (unless force refresh)
      if (!options.forceRefresh && this.contactCache.has(formattedId)) {
        return this.contactCache.get(formattedId);
      }

      // Request contact info from server
      const requestData = {
        tag: 'contact_info',
        id: generateMessageId(),
        contactId: formattedId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // In real implementation, wait for server response
      // For now, create a basic contact object
      const contact = {
        id: formattedId,
        name: null,
        pushName: null,
        shortName: null,
        phone: formattedId,
        isWAContact: true,
        isMyContact: false,
        isBlocked: false,
        lastSeen: null,
        presence: PresenceTypes.UNAVAILABLE,
        profilePicture: null,
        about: null,
        state: ContactStates.AVAILABLE,
        updatedAt: Date.now()
      };

      // Cache the contact
      this.contactCache.set(formattedId, contact);

      logger.debug('Contact info retrieved', { contactId: formattedId });
      
      return contact;
      
    } catch (error) {
      logger.error('Failed to get contact:', error);
      throw new MessageError(`Failed to get contact: ${error.message}`);
    }
  }

  /**
   * Get multiple contacts
   * 
   * @param {string[]} contactIds - Array of contact IDs
   * @param {Object} [options={}] - Options
   * @returns {Promise<Object[]>} Array of contact objects
   */
  async getContacts(contactIds, options = {}) {
    try {
      const contacts = await Promise.allSettled(
        contactIds.map(id => this.getContact(id, options))
      );

      return contacts
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);
        
    } catch (error) {
      logger.error('Failed to get contacts:', error);
      throw new MessageError(`Failed to get contacts: ${error.message}`);
    }
  }

  /**
   * Get all contacts
   * 
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.onlyWAContacts=true] - Only WhatsApp contacts
   * @returns {Promise<Object[]>} Array of all contacts
   */
  async getAllContacts(options = {}) {
    try {
      logger.info('Retrieving all contacts');

      // Request contact list from server
      const requestData = {
        tag: 'contact_list',
        id: generateMessageId(),
        onlyWAContacts: options.onlyWAContacts !== false,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Return cached contacts for now
      return Array.from(this.contactCache.values());
      
    } catch (error) {
      logger.error('Failed to get all contacts:', error);
      throw new MessageError(`Failed to get all contacts: ${error.message}`);
    }
  }

  /**
   * Check if contact is on WhatsApp
   * 
   * @param {string} phoneNumber - Phone number to check
   * @returns {Promise<boolean>} True if contact is on WhatsApp
   */
  async isOnWhatsApp(phoneNumber) {
    try {
      if (!validatePhoneNumber(phoneNumber)) {
        throw new MessageError('Invalid phone number format');
      }

      const formattedNumber = formatPhoneNumber(phoneNumber);

      // Send check request
      const requestData = {
        tag: 'contact_check',
        id: generateMessageId(),
        phoneNumber: formattedNumber,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // In real implementation, wait for server response
      // For now, assume all numbers are on WhatsApp
      return true;
      
    } catch (error) {
      logger.error('Failed to check WhatsApp status:', error);
      return false;
    }
  }

  /**
   * Get contact profile picture
   * 
   * @param {string} contactId - Contact ID
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.highRes=false] - Get high resolution image
   * @returns {Promise<Buffer|null>} Profile picture data or null
   */
  async getProfilePicture(contactId, options = {}) {
    try {
      const formattedId = formatPhoneNumber(contactId);
      const cacheKey = `${formattedId}_${options.highRes ? 'high' : 'low'}`;

      // Check cache first
      if (this.profilePictureCache.has(cacheKey)) {
        return this.profilePictureCache.get(cacheKey);
      }

      // Request profile picture from server
      const requestData = {
        tag: 'profile_picture',
        id: generateMessageId(),
        contactId: formattedId,
        highRes: options.highRes || false,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // In real implementation, wait for server response
      // For now, return null
      return null;
      
    } catch (error) {
      logger.error('Failed to get profile picture:', error);
      return null;
    }
  }

  /**
   * Get contact about/status message
   * 
   * @param {string} contactId - Contact ID
   * @returns {Promise<string|null>} About message or null
   */
  async getContactAbout(contactId) {
    try {
      const formattedId = formatPhoneNumber(contactId);

      // Check cache first
      if (this.statusCache.has(formattedId)) {
        return this.statusCache.get(formattedId);
      }

      // Request about from server
      const requestData = {
        tag: 'contact_about',
        id: generateMessageId(),
        contactId: formattedId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // In real implementation, wait for server response
      return null;
      
    } catch (error) {
      logger.error('Failed to get contact about:', error);
      return null;
    }
  }

  /**
   * Block contact
   * 
   * @param {string} contactId - Contact ID
   * @returns {Promise<void>}
   */
  async blockContact(contactId) {
    try {
      const formattedId = formatPhoneNumber(contactId);
      logger.info('Blocking contact', { contactId: formattedId });

      // Send block request
      const requestData = {
        tag: 'contact_block',
        id: generateMessageId(),
        contactId: formattedId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Update local cache
      const contact = this.contactCache.get(formattedId);
      if (contact) {
        contact.isBlocked = true;
        contact.updatedAt = Date.now();
        this.contactCache.set(formattedId, contact);
      }

      logger.info('Contact blocked successfully', { contactId: formattedId });
      this.emit('contact_blocked', { contactId: formattedId });
      
    } catch (error) {
      logger.error('Failed to block contact:', error);
      throw new MessageError(`Failed to block contact: ${error.message}`);
    }
  }

  /**
   * Unblock contact
   * 
   * @param {string} contactId - Contact ID
   * @returns {Promise<void>}
   */
  async unblockContact(contactId) {
    try {
      const formattedId = formatPhoneNumber(contactId);
      logger.info('Unblocking contact', { contactId: formattedId });

      // Send unblock request
      const requestData = {
        tag: 'contact_unblock',
        id: generateMessageId(),
        contactId: formattedId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Update local cache
      const contact = this.contactCache.get(formattedId);
      if (contact) {
        contact.isBlocked = false;
        contact.updatedAt = Date.now();
        this.contactCache.set(formattedId, contact);
      }

      logger.info('Contact unblocked successfully', { contactId: formattedId });
      this.emit('contact_unblocked', { contactId: formattedId });
      
    } catch (error) {
      logger.error('Failed to unblock contact:', error);
      throw new MessageError(`Failed to unblock contact: ${error.message}`);
    }
  }

  /**
   * Subscribe to contact presence updates
   * 
   * @param {string} contactId - Contact ID
   * @returns {Promise<void>}
   */
  async subscribeToPresence(contactId) {
    try {
      const formattedId = formatPhoneNumber(contactId);

      if (this.presenceSubscriptions.has(formattedId)) {
        return; // Already subscribed
      }

      // Send presence subscription request
      const requestData = {
        tag: 'presence_subscribe',
        id: generateMessageId(),
        contactId: formattedId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      this.presenceSubscriptions.add(formattedId);
      logger.debug('Subscribed to presence updates', { contactId: formattedId });
      
    } catch (error) {
      logger.error('Failed to subscribe to presence:', error);
    }
  }

  /**
   * Unsubscribe from contact presence updates
   * 
   * @param {string} contactId - Contact ID
   * @returns {Promise<void>}
   */
  async unsubscribeFromPresence(contactId) {
    try {
      const formattedId = formatPhoneNumber(contactId);

      if (!this.presenceSubscriptions.has(formattedId)) {
        return; // Not subscribed
      }

      // Send presence unsubscribe request
      const requestData = {
        tag: 'presence_unsubscribe',
        id: generateMessageId(),
        contactId: formattedId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      this.presenceSubscriptions.delete(formattedId);
      this.presenceCache.delete(formattedId);
      
      logger.debug('Unsubscribed from presence updates', { contactId: formattedId });
      
    } catch (error) {
      logger.error('Failed to unsubscribe from presence:', error);
    }
  }

  /**
   * Get contact presence
   * 
   * @param {string} contactId - Contact ID
   * @returns {Promise<Object>} Presence information
   */
  async getPresence(contactId) {
    const formattedId = formatPhoneNumber(contactId);
    
    return this.presenceCache.get(formattedId) || {
      contactId: formattedId,
      presence: PresenceTypes.UNAVAILABLE,
      lastSeen: null,
      isTyping: false,
      isRecording: false,
      isOnline: false
    };
  }

  /**
   * Update own presence
   * 
   * @param {string} presence - Presence type
   * @returns {Promise<void>}
   */
  async updatePresence(presence) {
    try {
      if (!Object.values(PresenceTypes).includes(presence)) {
        throw new MessageError('Invalid presence type');
      }

      // Send presence update
      const requestData = {
        tag: 'presence_update',
        id: generateMessageId(),
        presence: presence,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      logger.debug('Presence updated', { presence });
      
    } catch (error) {
      logger.error('Failed to update presence:', error);
      throw new MessageError(`Failed to update presence: ${error.message}`);
    }
  }

  /**
   * Search contacts
   * 
   * @param {string} query - Search query
   * @param {Object} [options={}] - Search options
   * @param {number} [options.limit=50] - Maximum results
   * @returns {Promise<Object[]>} Search results
   */
  async searchContacts(query, options = {}) {
    try {
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return [];
      }

      const searchTerm = query.toLowerCase().trim();
      const limit = options.limit || 50;
      const results = [];

      // Search in cached contacts
      for (const contact of this.contactCache.values()) {
        if (results.length >= limit) break;

        const searchFields = [
          contact.name,
          contact.pushName,
          contact.shortName,
          contact.phone,
          contact.about
        ].filter(field => field && typeof field === 'string');

        const matches = searchFields.some(field => 
          field.toLowerCase().includes(searchTerm)
        );

        if (matches) {
          results.push(contact);
        }
      }

      return results;
      
    } catch (error) {
      logger.error('Failed to search contacts:', error);
      return [];
    }
  }

  /**
   * Handle presence update
   * 
   * @param {Object} data - Presence data from WebSocket
   */
  async handlePresence(data) {
    try {
      const contactId = data.from || data.contactId;
      if (!contactId) return;

      const presenceInfo = {
        contactId: contactId,
        presence: data.presence || PresenceTypes.UNAVAILABLE,
        lastSeen: data.lastSeen || null,
        isTyping: data.isTyping || false,
        isRecording: data.isRecording || false,
        isOnline: data.presence === PresenceTypes.AVAILABLE,
        timestamp: data.timestamp || Date.now()
      };

      // Update presence cache
      this.presenceCache.set(contactId, presenceInfo);

      // Update contact cache if exists
      const contact = this.contactCache.get(contactId);
      if (contact) {
        contact.presence = presenceInfo.presence;
        contact.lastSeen = presenceInfo.lastSeen;
        contact.updatedAt = Date.now();
        this.contactCache.set(contactId, contact);
      }

      logger.debug('Presence updated', { 
        contactId, 
        presence: presenceInfo.presence,
        isTyping: presenceInfo.isTyping 
      });

      this.emit('presence_update', presenceInfo);
      
    } catch (error) {
      logger.error('Failed to handle presence update:', error);
    }
  }

  /**
   * Handle contact update
   * 
   * @param {Object} data - Contact data from WebSocket
   */
  async handleUpdate(data) {
    try {
      const contactId = data.contactId || data.id;
      if (!contactId) return;

      // Get existing contact or create new one
      let contact = this.contactCache.get(contactId) || {
        id: contactId,
        phone: contactId,
        isWAContact: true,
        isMyContact: false,
        isBlocked: false,
        updatedAt: Date.now()
      };

      // Update contact fields
      if (data.name !== undefined) contact.name = data.name;
      if (data.pushName !== undefined) contact.pushName = data.pushName;
      if (data.shortName !== undefined) contact.shortName = data.shortName;
      if (data.about !== undefined) contact.about = data.about;
      if (data.isBlocked !== undefined) contact.isBlocked = data.isBlocked;
      if (data.profilePicture !== undefined) contact.profilePicture = data.profilePicture;
      if (data.lastSeen !== undefined) contact.lastSeen = data.lastSeen;

      contact.updatedAt = Date.now();

      // Cache the updated contact
      this.contactCache.set(contactId, contact);

      logger.debug('Contact updated', { contactId });
      this.emit('contact_changed', contact);
      
    } catch (error) {
      logger.error('Failed to handle contact update:', error);
    }
  }

  /**
   * Start presence cleanup interval
   * @private
   */
  _startPresenceCleanup() {
    this.presenceCleanupInterval = setInterval(() => {
      this._cleanupPresenceCache();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Cleanup old presence data
   * @private
   */
  _cleanupPresenceCache() {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    for (const [contactId, presence] of this.presenceCache) {
      if (now - presence.timestamp > maxAge) {
        // Set to unavailable but keep in cache
        presence.presence = PresenceTypes.UNAVAILABLE;
        presence.isTyping = false;
        presence.isRecording = false;
        presence.isOnline = false;
      }
    }
  }

  /**
   * Clear all caches
   */
  clearCaches() {
    this.contactCache.clear();
    this.presenceCache.clear();
    this.profilePictureCache.clear();
    this.statusCache.clear();
    this.lastSeenCache.clear();
    this.presenceSubscriptions.clear();
    
    if (this.presenceCleanupInterval) {
      clearInterval(this.presenceCleanupInterval);
      this.presenceCleanupInterval = null;
    }
    
    logger.debug('Contact caches cleared');
  }
}

module.exports = ContactManager;
