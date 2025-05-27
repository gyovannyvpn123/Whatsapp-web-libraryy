/**
 * Reaction Manager
 * Handles message reactions and emoji interactions
 * 
 * @class ReactionManager
 */

'use strict';

const EventEmitter = require('events');
const { logger, generateMessageId } = require('./utils');
const { MessageError } = require('./utils');
const { ReactionTypes, EmojiCategories } = require('./constants');

/**
 * Reaction Manager for WhatsApp Web
 * 
 * @extends EventEmitter
 */
class ReactionManager extends EventEmitter {
  /**
   * Create reaction manager
   * 
   * @param {WhatsAppClient} client - WhatsApp client instance
   */
  constructor(client) {
    super();
    
    this.client = client;
    this.reactionCache = new Map();
    this.pendingReactions = new Map();
    this.supportedEmojis = this._initializeSupportedEmojis();
    
    logger.debug('Reaction manager initialized');
  }

  /**
   * Add reaction to a message
   * 
   * @param {string} messageId - Message ID to react to
   * @param {string} emoji - Emoji to react with
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object>} Reaction object
   */
  async addReaction(messageId, emoji, options = {}) {
    try {
      logger.debug('Adding reaction', { messageId, emoji });

      // Validate emoji
      if (!this._validateEmoji(emoji)) {
        throw new MessageError('Invalid or unsupported emoji');
      }

      // Check if message exists
      const message = await this._getMessageById(messageId);
      if (!message) {
        throw new MessageError('Message not found');
      }

      // Check if user already reacted to this message
      const existingReaction = await this._getUserReaction(messageId, this.client.user.id);
      if (existingReaction) {
        // Update existing reaction
        return this.updateReaction(messageId, emoji, options);
      }

      // Create reaction data
      const reactionData = {
        tag: 'reaction',
        id: generateMessageId(),
        messageId: messageId,
        chatId: message.chatId,
        emoji: emoji,
        action: ReactionTypes.ADD,
        timestamp: Date.now(),
        userId: this.client.user.id
      };

      // Send through WebSocket
      await this.client.websocket.sendMessage(reactionData);

      // Store pending reaction
      this.pendingReactions.set(reactionData.id, reactionData);

      // Create reaction object
      const reaction = {
        id: reactionData.id,
        messageId: messageId,
        chatId: message.chatId,
        emoji: emoji,
        fromMe: true,
        timestamp: Date.now(),
        status: 'pending'
      };

      // Update local cache
      this._updateReactionCache(messageId, reaction);

      logger.info('Reaction added successfully', { 
        messageId, 
        emoji, 
        reactionId: reaction.id 
      });
      
      return reaction;
      
    } catch (error) {
      logger.error('Failed to add reaction:', error);
      throw new MessageError(`Failed to add reaction: ${error.message}`);
    }
  }

  /**
   * Remove reaction from a message
   * 
   * @param {string} messageId - Message ID to remove reaction from
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<void>}
   */
  async removeReaction(messageId, options = {}) {
    try {
      logger.debug('Removing reaction', { messageId });

      // Check if user has reacted to this message
      const existingReaction = await this._getUserReaction(messageId, this.client.user.id);
      if (!existingReaction) {
        throw new MessageError('No reaction found to remove');
      }

      // Create reaction removal data
      const reactionData = {
        tag: 'reaction',
        id: generateMessageId(),
        messageId: messageId,
        chatId: existingReaction.chatId,
        emoji: '',
        action: ReactionTypes.REMOVE,
        timestamp: Date.now(),
        userId: this.client.user.id
      };

      // Send through WebSocket
      await this.client.websocket.sendMessage(reactionData);

      // Remove from cache
      this._removeFromReactionCache(messageId, this.client.user.id);

      logger.info('Reaction removed successfully', { messageId });
      
    } catch (error) {
      logger.error('Failed to remove reaction:', error);
      throw new MessageError(`Failed to remove reaction: ${error.message}`);
    }
  }

  /**
   * Update existing reaction
   * 
   * @param {string} messageId - Message ID
   * @param {string} newEmoji - New emoji for reaction
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object>} Updated reaction object
   */
  async updateReaction(messageId, newEmoji, options = {}) {
    try {
      logger.debug('Updating reaction', { messageId, newEmoji });

      // Validate new emoji
      if (!this._validateEmoji(newEmoji)) {
        throw new MessageError('Invalid or unsupported emoji');
      }

      // Get existing reaction
      const existingReaction = await this._getUserReaction(messageId, this.client.user.id);
      if (!existingReaction) {
        throw new MessageError('No existing reaction to update');
      }

      // If same emoji, no need to update
      if (existingReaction.emoji === newEmoji) {
        return existingReaction;
      }

      // Create reaction update data
      const reactionData = {
        tag: 'reaction',
        id: generateMessageId(),
        messageId: messageId,
        chatId: existingReaction.chatId,
        emoji: newEmoji,
        action: ReactionTypes.UPDATE,
        timestamp: Date.now(),
        userId: this.client.user.id
      };

      // Send through WebSocket
      await this.client.websocket.sendMessage(reactionData);

      // Update cache
      const updatedReaction = {
        ...existingReaction,
        emoji: newEmoji,
        timestamp: Date.now()
      };
      this._updateReactionCache(messageId, updatedReaction);

      logger.info('Reaction updated successfully', { 
        messageId, 
        oldEmoji: existingReaction.emoji,
        newEmoji 
      });
      
      return updatedReaction;
      
    } catch (error) {
      logger.error('Failed to update reaction:', error);
      throw new MessageError(`Failed to update reaction: ${error.message}`);
    }
  }

  /**
   * Get all reactions for a message
   * 
   * @param {string} messageId - Message ID
   * @returns {Promise<Array>} Array of reactions
   */
  async getMessageReactions(messageId) {
    try {
      const reactions = this.reactionCache.get(messageId) || [];
      
      // Group reactions by emoji
      const groupedReactions = {};
      reactions.forEach(reaction => {
        if (!groupedReactions[reaction.emoji]) {
          groupedReactions[reaction.emoji] = [];
        }
        groupedReactions[reaction.emoji].push(reaction);
      });

      return Object.entries(groupedReactions).map(([emoji, reactionList]) => ({
        emoji: emoji,
        count: reactionList.length,
        users: reactionList.map(r => ({
          id: r.userId,
          timestamp: r.timestamp
        })),
        hasUserReacted: reactionList.some(r => r.userId === this.client.user.id)
      }));
      
    } catch (error) {
      logger.error('Failed to get message reactions:', error);
      return [];
    }
  }

  /**
   * Get user's reaction to a message
   * 
   * @param {string} messageId - Message ID
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} User's reaction or null
   */
  async getUserReaction(messageId, userId) {
    return this._getUserReaction(messageId, userId);
  }

  /**
   * Get reaction statistics for a chat
   * 
   * @param {string} chatId - Chat ID
   * @param {Object} [options={}] - Options
   * @param {number} [options.days=7] - Number of days to analyze
   * @returns {Promise<Object>} Reaction statistics
   */
  async getReactionStats(chatId, options = {}) {
    try {
      const days = options.days || 7;
      const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
      
      const stats = {
        totalReactions: 0,
        uniqueUsers: new Set(),
        emojiBreakdown: {},
        topEmojis: [],
        topReactors: {},
        dailyActivity: {}
      };

      // Analyze cached reactions
      for (const [messageId, reactions] of this.reactionCache) {
        const message = await this._getMessageById(messageId);
        if (!message || message.chatId !== chatId) {
          continue;
        }

        reactions.forEach(reaction => {
          if (reaction.timestamp >= startTime) {
            stats.totalReactions++;
            stats.uniqueUsers.add(reaction.userId);
            
            // Emoji breakdown
            stats.emojiBreakdown[reaction.emoji] = 
              (stats.emojiBreakdown[reaction.emoji] || 0) + 1;
            
            // Top reactors
            stats.topReactors[reaction.userId] = 
              (stats.topReactors[reaction.userId] || 0) + 1;
            
            // Daily activity
            const day = new Date(reaction.timestamp).toDateString();
            stats.dailyActivity[day] = (stats.dailyActivity[day] || 0) + 1;
          }
        });
      }

      // Process results
      stats.uniqueUsers = stats.uniqueUsers.size;
      
      stats.topEmojis = Object.entries(stats.emojiBreakdown)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([emoji, count]) => ({ emoji, count }));
      
      stats.topReactors = Object.entries(stats.topReactors)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([userId, count]) => ({ userId, count }));

      return stats;
      
    } catch (error) {
      logger.error('Failed to get reaction stats:', error);
      throw new MessageError(`Failed to get reaction stats: ${error.message}`);
    }
  }

  /**
   * Handle incoming reaction
   * 
   * @param {Object} data - Reaction data from WebSocket
   */
  async handleIncoming(data) {
    try {
      const reaction = {
        id: data.id,
        messageId: data.messageId,
        chatId: data.chatId,
        emoji: data.emoji,
        userId: data.userId || data.from,
        timestamp: data.timestamp || Date.now(),
        fromMe: data.userId === this.client.user.id
      };

      // Update cache based on action
      if (data.action === ReactionTypes.REMOVE) {
        this._removeFromReactionCache(data.messageId, reaction.userId);
      } else {
        this._updateReactionCache(data.messageId, reaction);
      }

      logger.debug('Incoming reaction processed', { 
        messageId: data.messageId,
        emoji: data.emoji,
        action: data.action 
      });
      
      this.emit('message_reaction', {
        messageId: data.messageId,
        reaction: reaction,
        action: data.action
      });
      
    } catch (error) {
      logger.error('Failed to handle incoming reaction:', error);
    }
  }

  /**
   * Initialize supported emojis
   * @private
   */
  _initializeSupportedEmojis() {
    // Common WhatsApp reaction emojis
    return [
      '👍', '👎', '❤️', '😂', '😮', '😢', '😡',
      '🔥', '👏', '🙏', '💯', '😍', '🤔', '😊',
      '😭', '😱', '🤯', '🥳', '🤩', '😎', '🤗',
      '😘', '😜', '🙈', '🙊', '💀', '👻', '🤖'
    ];
  }

  /**
   * Validate emoji
   * @private
   */
  _validateEmoji(emoji) {
    if (!emoji || typeof emoji !== 'string') {
      return false;
    }

    // Check if emoji is in supported list
    return this.supportedEmojis.includes(emoji);
  }

  /**
   * Get message by ID
   * @private
   */
  async _getMessageById(messageId) {
    // Try to get from message manager cache
    if (this.client.messages && this.client.messages.messageCache) {
      return this.client.messages.messageCache.get(messageId);
    }
    
    // Fallback - in real implementation, this would query message storage
    return { id: messageId, chatId: 'unknown' };
  }

  /**
   * Get user's reaction to a message
   * @private
   */
  async _getUserReaction(messageId, userId) {
    const reactions = this.reactionCache.get(messageId) || [];
    return reactions.find(reaction => reaction.userId === userId) || null;
  }

  /**
   * Update reaction cache
   * @private
   */
  _updateReactionCache(messageId, reaction) {
    const reactions = this.reactionCache.get(messageId) || [];
    
    // Remove existing reaction from same user
    const filteredReactions = reactions.filter(r => r.userId !== reaction.userId);
    
    // Add new reaction
    filteredReactions.push(reaction);
    
    this.reactionCache.set(messageId, filteredReactions);
  }

  /**
   * Remove reaction from cache
   * @private
   */
  _removeFromReactionCache(messageId, userId) {
    const reactions = this.reactionCache.get(messageId) || [];
    const filteredReactions = reactions.filter(r => r.userId !== userId);
    
    if (filteredReactions.length === 0) {
      this.reactionCache.delete(messageId);
    } else {
      this.reactionCache.set(messageId, filteredReactions);
    }
  }

  /**
   * Clear reaction cache
   */
  clearCache() {
    this.reactionCache.clear();
    this.pendingReactions.clear();
    logger.debug('Reaction cache cleared');
  }
}

module.exports = ReactionManager;
