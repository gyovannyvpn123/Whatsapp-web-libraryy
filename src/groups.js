/**
 * Group Manager
 * Handles WhatsApp group creation, management, and administration
 * 
 * @class GroupManager
 */

'use strict';

const EventEmitter = require('events');
const { logger, generateMessageId, formatPhoneNumber, validatePhoneNumber } = require('./utils');
const { MessageError, AuthError } = require('./utils');
const { GroupRoles, GroupActions, MessageTypes } = require('./constants');

/**
 * Group Manager for WhatsApp Web
 * 
 * @extends EventEmitter
 */
class GroupManager extends EventEmitter {
  /**
   * Create group manager
   * 
   * @param {WhatsAppClient} client - WhatsApp client instance
   */
  constructor(client) {
    super();
    
    this.client = client;
    this.groupCache = new Map();
    this.pendingOperations = new Map();
    this.participantCache = new Map();
    
    logger.debug('Group manager initialized');
  }

  /**
   * Create a new group
   * 
   * @param {string} name - Group name
   * @param {string[]} participants - Array of participant phone numbers
   * @param {Object} [options={}] - Additional options
   * @param {string} [options.description] - Group description
   * @param {Buffer} [options.picture] - Group picture data
   * @returns {Promise<Object>} Created group object
   */
  async createGroup(name, participants, options = {}) {
    try {
      logger.info('Creating group', { name, participantCount: participants.length });

      // Validate group name
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new MessageError('Group name is required');
      }

      if (name.length > 100) {
        throw new MessageError('Group name cannot exceed 100 characters');
      }

      // Validate participants
      if (!Array.isArray(participants) || participants.length === 0) {
        throw new MessageError('At least one participant is required');
      }

      if (participants.length > 256) {
        throw new MessageError('Cannot add more than 256 participants');
      }

      // Validate and format participant numbers
      const validParticipants = participants.map(phone => {
        if (!validatePhoneNumber(phone)) {
          throw new MessageError(`Invalid phone number: ${phone}`);
        }
        return formatPhoneNumber(phone);
      });

      // Remove duplicates
      const uniqueParticipants = [...new Set(validParticipants)];

      // Create group data
      const groupData = {
        tag: 'group_create',
        id: generateMessageId(),
        name: name.trim(),
        participants: uniqueParticipants,
        description: options.description || '',
        timestamp: Date.now()
      };

      // Send group creation request
      await this.client.websocket.sendMessage(groupData);

      // Store pending operation
      this.pendingOperations.set(groupData.id, {
        type: 'create',
        data: groupData,
        timestamp: Date.now()
      });

      // Simulate group creation response (in real implementation, wait for server response)
      const groupId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@g.us`;
      
      const group = {
        id: groupId,
        name: name.trim(),
        description: options.description || '',
        participants: uniqueParticipants.map(phone => ({
          id: phone,
          role: GroupRoles.MEMBER,
          joinedAt: Date.now()
        })),
        admins: [this.client.user.id],
        owner: this.client.user.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        settings: {
          onlyAdminsCanMessage: false,
          onlyAdminsCanEditInfo: true,
          disappearingMessages: false
        }
      };

      // Add current user as admin
      group.participants.push({
        id: this.client.user.id,
        role: GroupRoles.ADMIN,
        joinedAt: Date.now()
      });

      // Cache the group
      this.groupCache.set(groupId, group);

      // Set group picture if provided
      if (options.picture) {
        await this.setGroupPicture(groupId, options.picture);
      }

      logger.info('Group created successfully', { groupId, name });
      this.emit('group_created', group);

      return group;
      
    } catch (error) {
      logger.error('Failed to create group:', error);
      throw new MessageError(`Failed to create group: ${error.message}`);
    }
  }

  /**
   * Get group information
   * 
   * @param {string} groupId - Group ID
   * @returns {Promise<Object>} Group information
   */
  async getGroupInfo(groupId) {
    try {
      // Check cache first
      if (this.groupCache.has(groupId)) {
        return this.groupCache.get(groupId);
      }

      // Request group info from server
      const requestData = {
        tag: 'group_info',
        id: generateMessageId(),
        groupId: groupId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // In real implementation, wait for server response
      // For now, return null if not cached
      return null;
      
    } catch (error) {
      logger.error('Failed to get group info:', error);
      throw new MessageError(`Failed to get group info: ${error.message}`);
    }
  }

  /**
   * Add participants to group
   * 
   * @param {string} groupId - Group ID
   * @param {string[]} participants - Array of participant phone numbers
   * @returns {Promise<Object>} Operation result
   */
  async addParticipants(groupId, participants) {
    try {
      logger.info('Adding participants to group', { groupId, count: participants.length });

      await this._checkGroupPermissions(groupId, GroupActions.ADD_PARTICIPANTS);

      // Validate participants
      const validParticipants = participants.map(phone => {
        if (!validatePhoneNumber(phone)) {
          throw new MessageError(`Invalid phone number: ${phone}`);
        }
        return formatPhoneNumber(phone);
      });

      // Check group size limit
      const group = await this.getGroupInfo(groupId);
      if (group && group.participants.length + validParticipants.length > 256) {
        throw new MessageError('Group size limit exceeded (256 participants)');
      }

      // Send add participants request
      const requestData = {
        tag: 'group_participants_add',
        id: generateMessageId(),
        groupId: groupId,
        participants: validParticipants,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Update local cache
      if (group) {
        validParticipants.forEach(phone => {
          if (!group.participants.find(p => p.id === phone)) {
            group.participants.push({
              id: phone,
              role: GroupRoles.MEMBER,
              joinedAt: Date.now()
            });
          }
        });
        
        group.updatedAt = Date.now();
        this.groupCache.set(groupId, group);
      }

      const result = {
        success: validParticipants,
        failed: [],
        groupId: groupId
      };

      logger.info('Participants added successfully', { groupId, count: validParticipants.length });
      this.emit('participants_added', { groupId, participants: validParticipants });

      return result;
      
    } catch (error) {
      logger.error('Failed to add participants:', error);
      throw new MessageError(`Failed to add participants: ${error.message}`);
    }
  }

  /**
   * Remove participants from group
   * 
   * @param {string} groupId - Group ID
   * @param {string[]} participants - Array of participant phone numbers
   * @returns {Promise<Object>} Operation result
   */
  async removeParticipants(groupId, participants) {
    try {
      logger.info('Removing participants from group', { groupId, count: participants.length });

      await this._checkGroupPermissions(groupId, GroupActions.REMOVE_PARTICIPANTS);

      // Format participants
      const validParticipants = participants.map(phone => formatPhoneNumber(phone));

      // Send remove participants request
      const requestData = {
        tag: 'group_participants_remove',
        id: generateMessageId(),
        groupId: groupId,
        participants: validParticipants,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Update local cache
      const group = this.groupCache.get(groupId);
      if (group) {
        group.participants = group.participants.filter(p => !validParticipants.includes(p.id));
        group.updatedAt = Date.now();
        this.groupCache.set(groupId, group);
      }

      const result = {
        success: validParticipants,
        failed: [],
        groupId: groupId
      };

      logger.info('Participants removed successfully', { groupId, count: validParticipants.length });
      this.emit('participants_removed', { groupId, participants: validParticipants });

      return result;
      
    } catch (error) {
      logger.error('Failed to remove participants:', error);
      throw new MessageError(`Failed to remove participants: ${error.message}`);
    }
  }

  /**
   * Promote participants to admin
   * 
   * @param {string} groupId - Group ID
   * @param {string[]} participants - Array of participant phone numbers
   * @returns {Promise<Object>} Operation result
   */
  async promoteParticipants(groupId, participants) {
    try {
      logger.info('Promoting participants to admin', { groupId, count: participants.length });

      await this._checkGroupPermissions(groupId, GroupActions.PROMOTE_PARTICIPANTS);

      // Format participants
      const validParticipants = participants.map(phone => formatPhoneNumber(phone));

      // Send promote request
      const requestData = {
        tag: 'group_participants_promote',
        id: generateMessageId(),
        groupId: groupId,
        participants: validParticipants,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Update local cache
      const group = this.groupCache.get(groupId);
      if (group) {
        group.participants.forEach(participant => {
          if (validParticipants.includes(participant.id)) {
            participant.role = GroupRoles.ADMIN;
          }
        });
        
        // Add to admins list
        validParticipants.forEach(phone => {
          if (!group.admins.includes(phone)) {
            group.admins.push(phone);
          }
        });
        
        group.updatedAt = Date.now();
        this.groupCache.set(groupId, group);
      }

      const result = {
        success: validParticipants,
        failed: [],
        groupId: groupId
      };

      logger.info('Participants promoted successfully', { groupId, count: validParticipants.length });
      this.emit('participants_promoted', { groupId, participants: validParticipants });

      return result;
      
    } catch (error) {
      logger.error('Failed to promote participants:', error);
      throw new MessageError(`Failed to promote participants: ${error.message}`);
    }
  }

  /**
   * Demote admin participants
   * 
   * @param {string} groupId - Group ID
   * @param {string[]} participants - Array of participant phone numbers
   * @returns {Promise<Object>} Operation result
   */
  async demoteParticipants(groupId, participants) {
    try {
      logger.info('Demoting admin participants', { groupId, count: participants.length });

      await this._checkGroupPermissions(groupId, GroupActions.DEMOTE_PARTICIPANTS);

      // Format participants
      const validParticipants = participants.map(phone => formatPhoneNumber(phone));

      // Send demote request
      const requestData = {
        tag: 'group_participants_demote',
        id: generateMessageId(),
        groupId: groupId,
        participants: validParticipants,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Update local cache
      const group = this.groupCache.get(groupId);
      if (group) {
        group.participants.forEach(participant => {
          if (validParticipants.includes(participant.id)) {
            participant.role = GroupRoles.MEMBER;
          }
        });
        
        // Remove from admins list
        group.admins = group.admins.filter(admin => !validParticipants.includes(admin));
        
        group.updatedAt = Date.now();
        this.groupCache.set(groupId, group);
      }

      const result = {
        success: validParticipants,
        failed: [],
        groupId: groupId
      };

      logger.info('Participants demoted successfully', { groupId, count: validParticipants.length });
      this.emit('participants_demoted', { groupId, participants: validParticipants });

      return result;
      
    } catch (error) {
      logger.error('Failed to demote participants:', error);
      throw new MessageError(`Failed to demote participants: ${error.message}`);
    }
  }

  /**
   * Update group name
   * 
   * @param {string} groupId - Group ID
   * @param {string} name - New group name
   * @returns {Promise<Object>} Updated group object
   */
  async updateGroupName(groupId, name) {
    try {
      logger.info('Updating group name', { groupId, name });

      await this._checkGroupPermissions(groupId, GroupActions.EDIT_INFO);

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new MessageError('Group name is required');
      }

      if (name.length > 100) {
        throw new MessageError('Group name cannot exceed 100 characters');
      }

      // Send update request
      const requestData = {
        tag: 'group_update_name',
        id: generateMessageId(),
        groupId: groupId,
        name: name.trim(),
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Update local cache
      const group = this.groupCache.get(groupId);
      if (group) {
        group.name = name.trim();
        group.updatedAt = Date.now();
        this.groupCache.set(groupId, group);
      }

      logger.info('Group name updated successfully', { groupId, name });
      this.emit('group_name_updated', { groupId, name: name.trim() });

      return group;
      
    } catch (error) {
      logger.error('Failed to update group name:', error);
      throw new MessageError(`Failed to update group name: ${error.message}`);
    }
  }

  /**
   * Update group description
   * 
   * @param {string} groupId - Group ID
   * @param {string} description - New group description
   * @returns {Promise<Object>} Updated group object
   */
  async updateGroupDescription(groupId, description) {
    try {
      logger.info('Updating group description', { groupId });

      await this._checkGroupPermissions(groupId, GroupActions.EDIT_INFO);

      if (description && description.length > 512) {
        throw new MessageError('Group description cannot exceed 512 characters');
      }

      // Send update request
      const requestData = {
        tag: 'group_update_description',
        id: generateMessageId(),
        groupId: groupId,
        description: description || '',
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Update local cache
      const group = this.groupCache.get(groupId);
      if (group) {
        group.description = description || '';
        group.updatedAt = Date.now();
        this.groupCache.set(groupId, group);
      }

      logger.info('Group description updated successfully', { groupId });
      this.emit('group_description_updated', { groupId, description: description || '' });

      return group;
      
    } catch (error) {
      logger.error('Failed to update group description:', error);
      throw new MessageError(`Failed to update group description: ${error.message}`);
    }
  }

  /**
   * Set group picture
   * 
   * @param {string} groupId - Group ID
   * @param {Buffer} pictureData - Picture data
   * @returns {Promise<void>}
   */
  async setGroupPicture(groupId, pictureData) {
    try {
      logger.info('Setting group picture', { groupId });

      await this._checkGroupPermissions(groupId, GroupActions.EDIT_INFO);

      if (!Buffer.isBuffer(pictureData)) {
        throw new MessageError('Picture data must be a Buffer');
      }

      if (pictureData.length > 1024 * 1024) { // 1MB limit
        throw new MessageError('Picture size cannot exceed 1MB');
      }

      // Upload picture through media manager
      const uploadResult = await this.client.media._uploadMedia({
        data: pictureData,
        mimetype: 'image/jpeg',
        filename: 'group_picture.jpg'
      });

      // Send update request
      const requestData = {
        tag: 'group_update_picture',
        id: generateMessageId(),
        groupId: groupId,
        pictureId: uploadResult.mediaId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      logger.info('Group picture updated successfully', { groupId });
      this.emit('group_picture_updated', { groupId, pictureId: uploadResult.mediaId });
      
    } catch (error) {
      logger.error('Failed to set group picture:', error);
      throw new MessageError(`Failed to set group picture: ${error.message}`);
    }
  }

  /**
   * Leave group
   * 
   * @param {string} groupId - Group ID
   * @returns {Promise<void>}
   */
  async leaveGroup(groupId) {
    try {
      logger.info('Leaving group', { groupId });

      // Send leave request
      const requestData = {
        tag: 'group_leave',
        id: generateMessageId(),
        groupId: groupId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Remove from cache
      this.groupCache.delete(groupId);

      logger.info('Left group successfully', { groupId });
      this.emit('group_left', { groupId });
      
    } catch (error) {
      logger.error('Failed to leave group:', error);
      throw new MessageError(`Failed to leave group: ${error.message}`);
    }
  }

  /**
   * Get group invite link
   * 
   * @param {string} groupId - Group ID
   * @returns {Promise<string>} Group invite link
   */
  async getGroupInviteLink(groupId) {
    try {
      logger.info('Getting group invite link', { groupId });

      await this._checkGroupPermissions(groupId, GroupActions.GET_INVITE_LINK);

      // Send request for invite link
      const requestData = {
        tag: 'group_invite_link',
        id: generateMessageId(),
        groupId: groupId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // In real implementation, wait for server response
      const inviteLink = `https://chat.whatsapp.com/${generateMessageId()}`;
      
      logger.info('Group invite link retrieved', { groupId });
      
      return inviteLink;
      
    } catch (error) {
      logger.error('Failed to get group invite link:', error);
      throw new MessageError(`Failed to get group invite link: ${error.message}`);
    }
  }

  /**
   * Revoke group invite link
   * 
   * @param {string} groupId - Group ID
   * @returns {Promise<string>} New group invite link
   */
  async revokeGroupInviteLink(groupId) {
    try {
      logger.info('Revoking group invite link', { groupId });

      await this._checkGroupPermissions(groupId, GroupActions.REVOKE_INVITE_LINK);

      // Send revoke request
      const requestData = {
        tag: 'group_invite_revoke',
        id: generateMessageId(),
        groupId: groupId,
        timestamp: Date.now()
      };

      await this.client.websocket.sendMessage(requestData);

      // Generate new invite link
      const newInviteLink = `https://chat.whatsapp.com/${generateMessageId()}`;
      
      logger.info('Group invite link revoked', { groupId });
      this.emit('group_invite_revoked', { groupId, newLink: newInviteLink });
      
      return newInviteLink;
      
    } catch (error) {
      logger.error('Failed to revoke group invite link:', error);
      throw new MessageError(`Failed to revoke group invite link: ${error.message}`);
    }
  }

  /**
   * Handle incoming group notification
   * 
   * @param {Object} data - Notification data from WebSocket
   */
  async handleNotification(data) {
    try {
      logger.debug('Processing group notification', { type: data.type, groupId: data.groupId });

      switch (data.type) {
        case 'group_participant_add':
          await this._handleParticipantAdd(data);
          break;
        case 'group_participant_remove':
          await this._handleParticipantRemove(data);
          break;
        case 'group_participant_promote':
          await this._handleParticipantPromote(data);
          break;
        case 'group_participant_demote':
          await this._handleParticipantDemote(data);
          break;
        case 'group_update':
          await this._handleGroupUpdate(data);
          break;
        case 'group_create':
          await this._handleGroupCreate(data);
          break;
        default:
          logger.debug('Unhandled group notification type:', data.type);
      }
      
    } catch (error) {
      logger.error('Failed to handle group notification:', error);
    }
  }

  /**
   * Check if user has permission for group action
   * @private
   */
  async _checkGroupPermissions(groupId, action) {
    const group = await this.getGroupInfo(groupId);
    
    if (!group) {
      throw new MessageError('Group not found');
    }

    const userParticipant = group.participants.find(p => p.id === this.client.user.id);
    
    if (!userParticipant) {
      throw new AuthError('You are not a member of this group');
    }

    // Check specific permissions
    switch (action) {
      case GroupActions.ADD_PARTICIPANTS:
      case GroupActions.REMOVE_PARTICIPANTS:
      case GroupActions.PROMOTE_PARTICIPANTS:
      case GroupActions.DEMOTE_PARTICIPANTS:
      case GroupActions.GET_INVITE_LINK:
      case GroupActions.REVOKE_INVITE_LINK:
        if (userParticipant.role !== GroupRoles.ADMIN && group.owner !== this.client.user.id) {
          throw new AuthError('Admin privileges required for this action');
        }
        break;
      case GroupActions.EDIT_INFO:
        if (group.settings.onlyAdminsCanEditInfo && 
            userParticipant.role !== GroupRoles.ADMIN && 
            group.owner !== this.client.user.id) {
          throw new AuthError('Admin privileges required to edit group info');
        }
        break;
    }
  }

  /**
   * Handle participant add notification
   * @private
   */
  async _handleParticipantAdd(data) {
    const group = this.groupCache.get(data.groupId);
    if (group) {
      data.participants.forEach(phone => {
        if (!group.participants.find(p => p.id === phone)) {
          group.participants.push({
            id: phone,
            role: GroupRoles.MEMBER,
            joinedAt: Date.now()
          });
        }
      });
      
      group.updatedAt = Date.now();
      this.groupCache.set(data.groupId, group);
    }

    this.emit('group_join', {
      groupId: data.groupId,
      participants: data.participants,
      addedBy: data.author
    });
  }

  /**
   * Handle participant remove notification
   * @private
   */
  async _handleParticipantRemove(data) {
    const group = this.groupCache.get(data.groupId);
    if (group) {
      group.participants = group.participants.filter(p => !data.participants.includes(p.id));
      group.updatedAt = Date.now();
      this.groupCache.set(data.groupId, group);
    }

    this.emit('group_leave', {
      groupId: data.groupId,
      participants: data.participants,
      removedBy: data.author
    });
  }

  /**
   * Handle participant promote notification
   * @private
   */
  async _handleParticipantPromote(data) {
    const group = this.groupCache.get(data.groupId);
    if (group) {
      group.participants.forEach(participant => {
        if (data.participants.includes(participant.id)) {
          participant.role = GroupRoles.ADMIN;
        }
      });
      
      data.participants.forEach(phone => {
        if (!group.admins.includes(phone)) {
          group.admins.push(phone);
        }
      });
      
      group.updatedAt = Date.now();
      this.groupCache.set(data.groupId, group);
    }

    this.emit('group_update', {
      groupId: data.groupId,
      action: 'promote',
      participants: data.participants,
      by: data.author
    });
  }

  /**
   * Handle participant demote notification
   * @private
   */
  async _handleParticipantDemote(data) {
    const group = this.groupCache.get(data.groupId);
    if (group) {
      group.participants.forEach(participant => {
        if (data.participants.includes(participant.id)) {
          participant.role = GroupRoles.MEMBER;
        }
      });
      
      group.admins = group.admins.filter(admin => !data.participants.includes(admin));
      
      group.updatedAt = Date.now();
      this.groupCache.set(data.groupId, group);
    }

    this.emit('group_update', {
      groupId: data.groupId,
      action: 'demote',
      participants: data.participants,
      by: data.author
    });
  }

  /**
   * Handle group update notification
   * @private
   */
  async _handleGroupUpdate(data) {
    const group = this.groupCache.get(data.groupId);
    if (group) {
      if (data.name !== undefined) {
        group.name = data.name;
      }
      if (data.description !== undefined) {
        group.description = data.description;
      }
      
      group.updatedAt = Date.now();
      this.groupCache.set(data.groupId, group);
    }

    this.emit('group_update', {
      groupId: data.groupId,
      updates: data,
      by: data.author
    });
  }

  /**
   * Handle group create notification
   * @private
   */
  async _handleGroupCreate(data) {
    const group = {
      id: data.groupId,
      name: data.name,
      description: data.description || '',
      participants: data.participants || [],
      admins: data.admins || [],
      owner: data.owner,
      createdAt: data.timestamp,
      updatedAt: data.timestamp,
      settings: data.settings || {}
    };

    this.groupCache.set(data.groupId, group);

    this.emit('group_created', group);
  }

  /**
   * Clear group cache
   */
  clearCache() {
    this.groupCache.clear();
    this.pendingOperations.clear();
    this.participantCache.clear();
    logger.debug('Group cache cleared');
  }
}

module.exports = GroupManager;
