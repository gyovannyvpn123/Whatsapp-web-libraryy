/**
 * Status Manager
 * Handles WhatsApp status/stories viewing, posting, and management
 * 
 * @class StatusManager
 */

'use strict';

const EventEmitter = require('events');
const { logger, generateMessageId, formatPhoneNumber } = require('./utils');
const { MessageError } = require('./utils');
const { MessageTypes, StatusTypes, PrivacySettings } = require('./constants');

/**
 * Status Manager for WhatsApp Web
 * 
 * @extends EventEmitter
 */
class StatusManager extends EventEmitter {
  /**
   * Create status manager
   * 
   * @param {WhatsAppClient} client - WhatsApp client instance
   */
  constructor(client) {
    super();
    
    this.client = client;
    this.statusCache = new Map();
    this.myStatusCache = new Map();
    this.viewedStatusCache = new Map();
    this.statusSubscriptions = new Set();
    
    // Status expiry tracking
    this.statusExpiryInterval = null;
    
    logger.debug('Status manager initialized');
    this._startStatusExpiryCheck();
  }

  /**
   * Post text status
   * 
   * @param {string} text - Status text
   * @param {Object} [options={}] - Status options
   * @param {string} [options.backgroundColor] - Background color
   * @param {string} [options.font] - Font style
   * @param {Array} [options.viewers] - Specific viewers (private status)
   * @returns {Promise<Object>} Posted status object
   */
  async postTextStatus(text, options = {}) {
    try {
      logger.info('Posting text status');

      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new MessageError('Status text cannot be empty');
      }

      if (text.length > 700) {
        throw new MessageError('Status text cannot exceed 700 characters');
      }

      // Prepare status data
      const statusData = {
        tag: 'status_post',
        id: generateMessageId(),
        type: StatusTypes.TEXT,
        text: text.trim(),
        backgroundColor: options.backgroundColor || '#000000',
        font: options.font || 'default',
        privacy: options.viewers ? PrivacySettings.CUSTOM : PrivacySettings.CONTACTS,
        viewers: options.viewers || [],
        timestamp: Date.now(),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
      };

      // Send status post request
      await this.client.websocket.sendMessage(statusData);

      // Create status object
      const status = {
        id: statusData.id,
        type: StatusTypes.TEXT,
        content: {
          text: text.trim(),
          backgroundColor: statusData.backgroundColor,
          font: statusData.font
        },
        from: this.client.user.id,
        timestamp: statusData.timestamp,
        expiresAt: statusData.expiresAt,
        viewers: [],
        privacy: statusData.privacy,
        isViewed: false,
        fromMe: true
      };

      // Cache own status
      this.myStatusCache.set(status.id, status);

      logger.info('Text status posted successfully', { statusId: status.id });
      this.emit('status_posted', status);

      return status;
      
    } catch (error) {
      logger.error('Failed to post text status:', error);
      throw new MessageError(`Failed to post text status: ${error.message}`);
    }
  }

  /**
   * Post media status
   * 
   * @param {Object} media - Media object
   * @param {string} media.type - Media type (image, video)
   * @param {Buffer|string} media.data - Media data or file path
   * @param {Object} [options={}] - Status options
   * @param {string} [options.caption] - Media caption
   * @param {Array} [options.viewers] - Specific viewers (private status)
   * @returns {Promise<Object>} Posted status object
   */
  async postMediaStatus(media, options = {}) {
    try {
      logger.info('Posting media status', { type: media.type });

      if (!media || !media.type || !media.data) {
        throw new MessageError('Invalid media object');
      }

      if (![StatusTypes.IMAGE, StatusTypes.VIDEO].includes(media.type)) {
        throw new MessageError('Invalid media type for status');
      }

      // Upload media first
      const uploadResult = await this.client.media._uploadMedia({
        data: media.data,
        mimetype: media.mimetype || 'image/jpeg',
        filename: media.filename || `status_${Date.now()}`
      });

      // Prepare status data
      const statusData = {
        tag: 'status_post',
        id: generateMessageId(),
        type: media.type,
        mediaId: uploadResult.mediaId,
        mediaUrl: uploadResult.url,
        caption: options.caption || '',
        privacy: options.viewers ? PrivacySettings.CUSTOM : PrivacySettings.CONTACTS,
        viewers: options.viewers || [],
        timestamp: Date.now(),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
      };

      // Send status post request
      await this.client.websocket.sendMessage(statusData);

      // Create status object
      const status = {
        id: statusData.id,
        type: media.type,
        content: {
          mediaId: uploadResult.mediaId,
          mediaUrl: uploadResult.url,
          caption: options.caption || '',
          mimetype: media.mimetype || 'image/jpeg'
        },
        from: this.client.user.id,
        timestamp: statusData.timestamp,
        expiresAt: statusData.expiresAt,
        viewers: [],
        privacy: statusData.privacy,
        isViewed: false,
        fromMe: true
      };

      // Cache own status
      this.myStatusCache.set(status.id, status);

      logger.info('Media status posted successfully', { statusId: status.id, type: media.type });
      this.emit('status_posted', status);

      return status;
      
    } catch (error) {
      logger.error('Failed to post media status:', error);
      throw new MessageError(`Failed to post media status: ${error.message}`);
    }
  }

  /**
   * Get contact statuses
   * 
   * @param {string} [contactId] - Specific contact ID, or all if not provided
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.includeViewed=false] - Include already viewed statuses
   * @returns {Promise<Object[]>} Array of status objects
   */
  async getStatuses(contactId = null, options = {}) {
    try {
      const statuses = [];

      if (contactId) {
        // Get statuses for specific contact
        const formattedId = formatPhoneNumber(contactId);
        const contactStatuses = this.statusCache.get(formattedId) || [];
        
        statuses.push(...contactStatuses.filter(status => {
          return options.includeViewed || !this._isStatusViewed(status.id);
        }));
      } else {
        // Get all statuses
        for (const contactStatuses of this.statusCache.values()) {
          statuses.push(...contactStatuses.filter(status => {
            return options.includeViewed || !this._isStatusViewed(status.id);
          }));
        }
      }

      // Filter out expired statuses
      const validStatuses = statuses.filter(status => status.expiresAt > Date.now());

      // Sort by timestamp (newest first)
      validStatuses.sort((a, b) => b.timestamp - a.timestamp);

      return validStatuses;
      
    } catch (error) {
      logger.error('Failed to get statuses:', error);
      return [];
    }
  }

  /**
   * Get own statuses
   * 
   * @returns {Promise<Object[]>} Array of own status objects
   */
  async getMyStatuses() {
    try {
      const statuses = Array.from(this.myStatusCache.values());
      
      // Filter out expired statuses
      const validStatuses = statuses.filter(status => status.expiresAt > Date.now());
      
      // Sort by timestamp (newest first)
      validStatuses.sort((a, b) => b.timestamp - a.timestamp);

      return validStatuses;
      
    } catch (error) {
      logger.error('Failed to get own statuses:', error);
      return [];
    }
  }

  /**
   * View a status
   * 
   * @param {string} statusId - Status ID
   * @param {string} contactId - Contact who posted the status
   * @returns {Promise<Object>} Status object
   */
  async viewStatus(statusId, contactId) {
    try {
      logger.debug('Viewing status', { statusId, contactId });

      const formattedId = formatPhoneNumber(contactId);
      
      // Find the status
      const contactStatuses = this.statusCache.get(formattedId) || [];
      const status = contactStatuses.find(s => s.id === statusId);
      
      if (!status) {
        throw new MessageError('Status not found');
      }

      // Check if status is expired
      if (status.expiresAt <= Date.now()) {
        throw new MessageError('Status has expired');
      }

      // Send view notification to server
      const viewData = {
        tag: 'status_view',
        id: generateMessageId(),
        statusId: statusId,
        contactId: formattedId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(viewData);

      // Mark as viewed locally
      this.viewedStatusCache.set(statusId, Date.now());

      logger.debug('Status viewed successfully', { statusId });
      this.emit('status_viewed', { statusId, contactId: formattedId, status });

      return status;
      
    } catch (error) {
      logger.error('Failed to view status:', error);
      throw new MessageError(`Failed to view status: ${error.message}`);
    }
  }

  /**
   * React to a status
   * 
   * @param {string} statusId - Status ID
   * @param {string} contactId - Contact who posted the status
   * @param {string} emoji - Reaction emoji
   * @returns {Promise<void>}
   */
  async reactToStatus(statusId, contactId, emoji) {
    try {
      logger.debug('Reacting to status', { statusId, contactId, emoji });

      if (!this.client.reactions._validateEmoji(emoji)) {
        throw new MessageError('Invalid or unsupported emoji');
      }

      const formattedId = formatPhoneNumber(contactId);

      // Send reaction
      const reactionData = {
        tag: 'status_reaction',
        id: generateMessageId(),
        statusId: statusId,
        contactId: formattedId,
        emoji: emoji,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(reactionData);

      logger.debug('Status reaction sent successfully', { statusId, emoji });
      this.emit('status_reaction_sent', { statusId, contactId: formattedId, emoji });
      
    } catch (error) {
      logger.error('Failed to react to status:', error);
      throw new MessageError(`Failed to react to status: ${error.message}`);
    }
  }

  /**
   * Delete own status
   * 
   * @param {string} statusId - Status ID to delete
   * @returns {Promise<void>}
   */
  async deleteStatus(statusId) {
    try {
      logger.info('Deleting status', { statusId });

      // Check if status exists and belongs to user
      const status = this.myStatusCache.get(statusId);
      if (!status) {
        throw new MessageError('Status not found or not owned by user');
      }

      // Send delete request
      const deleteData = {
        tag: 'status_delete',
        id: generateMessageId(),
        statusId: statusId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(deleteData);

      // Remove from cache
      this.myStatusCache.delete(statusId);

      logger.info('Status deleted successfully', { statusId });
      this.emit('status_deleted', { statusId });
      
    } catch (error) {
      logger.error('Failed to delete status:', error);
      throw new MessageError(`Failed to delete status: ${error.message}`);
    }
  }

  /**
   * Get status viewers
   * 
   * @param {string} statusId - Status ID
   * @returns {Promise<Object[]>} Array of viewer objects
   */
  async getStatusViewers(statusId) {
    try {
      const status = this.myStatusCache.get(statusId);
      if (!status) {
        throw new MessageError('Status not found or not owned by user');
      }

      // Request viewers from server
      const requestData = {
        tag: 'status_viewers',
        id: generateMessageId(),
        statusId: statusId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // In real implementation, wait for server response
      // For now, return cached viewers
      return status.viewers || [];
      
    } catch (error) {
      logger.error('Failed to get status viewers:', error);
      return [];
    }
  }

  /**
   * Subscribe to status updates for contacts
   * 
   * @param {string[]} contactIds - Array of contact IDs
   * @returns {Promise<void>}
   */
  async subscribeToStatusUpdates(contactIds) {
    try {
      const formattedIds = contactIds.map(id => formatPhoneNumber(id));

      // Send subscription request
      const subscribeData = {
        tag: 'status_subscribe',
        id: generateMessageId(),
        contactIds: formattedIds,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(subscribeData);

      // Add to subscriptions
      formattedIds.forEach(id => this.statusSubscriptions.add(id));

      logger.debug('Subscribed to status updates', { count: formattedIds.length });
      
    } catch (error) {
      logger.error('Failed to subscribe to status updates:', error);
    }
  }

  /**
   * Unsubscribe from status updates
   * 
   * @param {string[]} contactIds - Array of contact IDs
   * @returns {Promise<void>}
   */
  async unsubscribeFromStatusUpdates(contactIds) {
    try {
      const formattedIds = contactIds.map(id => formatPhoneNumber(id));

      // Send unsubscribe request
      const unsubscribeData = {
        tag: 'status_unsubscribe',
        id: generateMessageId(),
        contactIds: formattedIds,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(unsubscribeData);

      // Remove from subscriptions
      formattedIds.forEach(id => this.statusSubscriptions.delete(id));

      logger.debug('Unsubscribed from status updates', { count: formattedIds.length });
      
    } catch (error) {
      logger.error('Failed to unsubscribe from status updates:', error);
    }
  }

  /**
   * Handle status update from WebSocket
   * 
   * @param {Object} data - Status data from WebSocket
   */
  async handleUpdate(data) {
    try {
      const contactId = data.from || data.contactId;
      if (!contactId) return;

      const status = {
        id: data.id || data.statusId,
        type: data.type || StatusTypes.TEXT,
        content: data.content || {},
        from: contactId,
        timestamp: data.timestamp || Date.now(),
        expiresAt: data.expiresAt || (Date.now() + 24 * 60 * 60 * 1000),
        viewers: data.viewers || [],
        privacy: data.privacy || PrivacySettings.CONTACTS,
        isViewed: false,
        fromMe: contactId === this.client.user.id
      };

      // Parse content based on type
      if (data.type === StatusTypes.TEXT) {
        status.content = {
          text: data.text || data.content?.text || '',
          backgroundColor: data.backgroundColor || data.content?.backgroundColor || '#000000',
          font: data.font || data.content?.font || 'default'
        };
      } else if ([StatusTypes.IMAGE, StatusTypes.VIDEO].includes(data.type)) {
        status.content = {
          mediaId: data.mediaId || data.content?.mediaId,
          mediaUrl: data.mediaUrl || data.content?.mediaUrl,
          caption: data.caption || data.content?.caption || '',
          mimetype: data.mimetype || data.content?.mimetype
        };
      }

      // Cache the status
      if (status.fromMe) {
        this.myStatusCache.set(status.id, status);
      } else {
        const contactStatuses = this.statusCache.get(contactId) || [];
        
        // Remove existing status with same ID
        const existingIndex = contactStatuses.findIndex(s => s.id === status.id);
        if (existingIndex >= 0) {
          contactStatuses.splice(existingIndex, 1);
        }
        
        contactStatuses.push(status);
        this.statusCache.set(contactId, contactStatuses);
      }

      logger.debug('Status update processed', { 
        statusId: status.id, 
        contactId, 
        type: status.type 
      });
      
      this.emit('status_update', status);
      
    } catch (error) {
      logger.error('Failed to handle status update:', error);
    }
  }

  /**
   * Check if status is viewed
   * @private
   */
  _isStatusViewed(statusId) {
    return this.viewedStatusCache.has(statusId);
  }

  /**
   * Start status expiry check interval
   * @private
   */
  _startStatusExpiryCheck() {
    this.statusExpiryInterval = setInterval(() => {
      this._cleanupExpiredStatuses();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Clean up expired statuses
   * @private
   */
  _cleanupExpiredStatuses() {
    const now = Date.now();

    // Clean up contact statuses
    for (const [contactId, statuses] of this.statusCache) {
      const validStatuses = statuses.filter(status => status.expiresAt > now);
      
      if (validStatuses.length === 0) {
        this.statusCache.delete(contactId);
      } else if (validStatuses.length !== statuses.length) {
        this.statusCache.set(contactId, validStatuses);
      }
    }

    // Clean up own statuses
    for (const [statusId, status] of this.myStatusCache) {
      if (status.expiresAt <= now) {
        this.myStatusCache.delete(statusId);
      }
    }

    // Clean up viewed status cache (keep for 7 days)
    const maxViewedAge = 7 * 24 * 60 * 60 * 1000;
    for (const [statusId, viewedAt] of this.viewedStatusCache) {
      if (now - viewedAt > maxViewedAge) {
        this.viewedStatusCache.delete(statusId);
      }
    }
  }

  /**
   * Clear all caches
   */
  clearCaches() {
    this.statusCache.clear();
    this.myStatusCache.clear();
    this.viewedStatusCache.clear();
    this.statusSubscriptions.clear();
    
    if (this.statusExpiryInterval) {
      clearInterval(this.statusExpiryInterval);
      this.statusExpiryInterval = null;
    }
    
    logger.debug('Status caches cleared');
  }
}

module.exports = StatusManager;
