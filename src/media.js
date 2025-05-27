/**
 * Media Manager
 * Handles media upload, download, and processing for WhatsApp
 * 
 * @class MediaManager
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { logger, generateMessageId, getMimeType, validateFileSize } = require('./utils');
const { MessageError } = require('./utils');
const { MessageTypes, MediaTypes, MediaLimits } = require('./constants');

/**
 * Media Manager for WhatsApp Web
 * 
 * @extends EventEmitter
 */
class MediaManager extends EventEmitter {
  /**
   * Create media manager
   * 
   * @param {WhatsAppClient} client - WhatsApp client instance
   */
  constructor(client) {
    super();
    
    this.client = client;
    this.uploadCache = new Map();
    this.downloadCache = new Map();
    this.processingQueue = [];
    this.maxConcurrentProcessing = 3;
    this.currentProcessing = 0;
    
    logger.debug('Media manager initialized');
  }

  /**
   * Send media message
   * 
   * @param {string} chatId - Chat ID to send media to
   * @param {Object} media - Media object
   * @param {string} media.type - Media type (image, video, audio, document)
   * @param {string|Buffer} media.data - File path or Buffer data
   * @param {string} [media.filename] - Original filename
   * @param {string} [media.caption] - Media caption
   * @param {Object} [media.metadata] - Media metadata
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Object>} Sent media message
   */
  async send(chatId, media, options = {}) {
    try {
      logger.debug('Sending media message', { 
        chatId, 
        type: media.type,
        hasData: !!media.data 
      });

      // Validate media object
      this._validateMedia(media);

      // Prepare media data
      const mediaData = await this._prepareMediaData(media);
      
      // Upload media to WhatsApp servers
      const uploadResult = await this._uploadMedia(mediaData);
      
      // Create message with media reference
      const messageData = {
        tag: 'message',
        id: generateMessageId(),
        chatId: chatId,
        type: media.type,
        timestamp: Date.now(),
        media: {
          id: uploadResult.mediaId,
          url: uploadResult.url,
          encKey: uploadResult.encKey,
          sha256: uploadResult.sha256,
          fileLength: uploadResult.fileLength,
          mimetype: mediaData.mimetype,
          filename: media.filename || mediaData.filename,
          caption: media.caption || '',
          metadata: media.metadata || {}
        }
      };

      // Send through WebSocket
      await this.client.websocket.sendMessage(messageData);

      const message = {
        id: messageData.id,
        chatId: chatId,
        fromMe: true,
        timestamp: Date.now(),
        type: media.type,
        hasMedia: true,
        mediaData: messageData.media,
        caption: media.caption || '',
        status: 'pending'
      };

      logger.info('Media message sent successfully', { 
        messageId: message.id, 
        chatId, 
        type: media.type 
      });
      
      return message;
      
    } catch (error) {
      logger.error('Failed to send media message:', error);
      throw new MessageError(`Failed to send media message: ${error.message}`);
    }
  }

  /**
   * Send image
   * 
   * @param {string} chatId - Chat ID
   * @param {string|Buffer} imageData - Image file path or Buffer
   * @param {Object} [options={}] - Options
   * @param {string} [options.caption] - Image caption
   * @param {Object} [options.metadata] - Image metadata
   * @returns {Promise<Object>} Sent image message
   */
  async sendImage(chatId, imageData, options = {}) {
    const media = {
      type: MessageTypes.IMAGE,
      data: imageData,
      caption: options.caption,
      metadata: options.metadata
    };

    return this.send(chatId, media, options);
  }

  /**
   * Send video
   * 
   * @param {string} chatId - Chat ID
   * @param {string|Buffer} videoData - Video file path or Buffer
   * @param {Object} [options={}] - Options
   * @param {string} [options.caption] - Video caption
   * @param {Object} [options.metadata] - Video metadata
   * @returns {Promise<Object>} Sent video message
   */
  async sendVideo(chatId, videoData, options = {}) {
    const media = {
      type: MessageTypes.VIDEO,
      data: videoData,
      caption: options.caption,
      metadata: options.metadata
    };

    return this.send(chatId, media, options);
  }

  /**
   * Send audio
   * 
   * @param {string} chatId - Chat ID
   * @param {string|Buffer} audioData - Audio file path or Buffer
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.ptt=false] - Send as voice note
   * @param {Object} [options.metadata] - Audio metadata
   * @returns {Promise<Object>} Sent audio message
   */
  async sendAudio(chatId, audioData, options = {}) {
    const media = {
      type: options.ptt ? MessageTypes.PTT : MessageTypes.AUDIO,
      data: audioData,
      metadata: options.metadata
    };

    return this.send(chatId, media, options);
  }

  /**
   * Send document
   * 
   * @param {string} chatId - Chat ID
   * @param {string|Buffer} documentData - Document file path or Buffer
   * @param {Object} [options={}] - Options
   * @param {string} [options.filename] - Document filename
   * @param {Object} [options.metadata] - Document metadata
   * @returns {Promise<Object>} Sent document message
   */
  async sendDocument(chatId, documentData, options = {}) {
    const media = {
      type: MessageTypes.DOCUMENT,
      data: documentData,
      filename: options.filename,
      metadata: options.metadata
    };

    return this.send(chatId, media, options);
  }

  /**
   * Download media from message
   * 
   * @param {Object} message - Message with media
   * @param {Object} [options={}] - Download options
   * @param {string} [options.filepath] - Save to specific file path
   * @returns {Promise<Object>} Downloaded media data
   */
  async downloadMedia(message, options = {}) {
    try {
      if (!message.hasMedia || !message.mediaData) {
        throw new MessageError('Message does not contain media');
      }

      const mediaData = message.mediaData;
      logger.debug('Downloading media', { 
        messageId: message.id, 
        mediaId: mediaData.id,
        type: message.type 
      });

      // Check cache first
      const cacheKey = mediaData.id || mediaData.url;
      if (this.downloadCache.has(cacheKey)) {
        logger.debug('Media found in cache', { mediaId: mediaData.id });
        return this.downloadCache.get(cacheKey);
      }

      // Download from server
      const downloadedData = await this._downloadFromServer(mediaData);
      
      // Decrypt if needed
      if (mediaData.encKey) {
        downloadedData.data = await this._decryptMedia(downloadedData.data, mediaData.encKey);
      }

      // Verify integrity
      if (mediaData.sha256) {
        await this._verifyMediaIntegrity(downloadedData.data, mediaData.sha256);
      }

      // Save to file if requested
      if (options.filepath) {
        await fs.writeFile(options.filepath, downloadedData.data);
        downloadedData.filepath = options.filepath;
      }

      // Cache the result
      this.downloadCache.set(cacheKey, downloadedData);

      logger.info('Media downloaded successfully', { 
        messageId: message.id,
        size: downloadedData.data.length 
      });
      
      return downloadedData;
      
    } catch (error) {
      logger.error('Failed to download media:', error);
      throw new MessageError(`Failed to download media: ${error.message}`);
    }
  }

  /**
   * Get media thumbnail
   * 
   * @param {Object} message - Message with media
   * @returns {Promise<Buffer|null>} Thumbnail data or null
   */
  async getThumbnail(message) {
    if (!message.hasMedia || !message.mediaData) {
      return null;
    }

    const mediaData = message.mediaData;
    
    if (mediaData.thumbnailData) {
      return Buffer.from(mediaData.thumbnailData, 'base64');
    }

    // Generate thumbnail for images and videos
    if (message.type === MessageTypes.IMAGE || message.type === MessageTypes.VIDEO) {
      try {
        const fullMedia = await this.downloadMedia(message);
        return await this._generateThumbnail(fullMedia.data, message.type);
      } catch (error) {
        logger.error('Failed to generate thumbnail:', error);
        return null;
      }
    }

    return null;
  }

  /**
   * Process media queue
   * 
   * @returns {Promise<void>}
   */
  async processQueue() {
    if (this.currentProcessing >= this.maxConcurrentProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.currentProcessing++;
    const task = this.processingQueue.shift();

    try {
      await task.process();
      task.resolve();
    } catch (error) {
      task.reject(error);
    } finally {
      this.currentProcessing--;
      
      // Process next item in queue
      if (this.processingQueue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  /**
   * Validate media object
   * @private
   */
  _validateMedia(media) {
    if (!media || typeof media !== 'object') {
      throw new MessageError('Invalid media object');
    }

    if (!media.type || !Object.values(MessageTypes).includes(media.type)) {
      throw new MessageError('Invalid media type');
    }

    if (!media.data) {
      throw new MessageError('Media data is required');
    }

    // Validate file size limits
    const sizeLimit = MediaLimits[media.type];
    if (sizeLimit && media.data.length > sizeLimit) {
      throw new MessageError(`Media exceeds size limit of ${sizeLimit} bytes`);
    }
  }

  /**
   * Prepare media data for upload
   * @private
   */
  async _prepareMediaData(media) {
    let data;
    let filename;
    let mimetype;

    if (typeof media.data === 'string') {
      // File path
      data = await fs.readFile(media.data);
      filename = media.filename || path.basename(media.data);
      mimetype = getMimeType(media.data);
    } else if (Buffer.isBuffer(media.data)) {
      // Buffer data
      data = media.data;
      filename = media.filename || `media_${Date.now()}`;
      mimetype = media.mimetype || 'application/octet-stream';
    } else {
      throw new MessageError('Invalid media data format');
    }

    // Validate file size
    validateFileSize(data.length, media.type);

    return {
      data,
      filename,
      mimetype,
      size: data.length
    };
  }

  /**
   * Upload media to WhatsApp servers
   * @private
   */
  async _uploadMedia(mediaData) {
    const mediaId = generateMessageId();
    const encKey = crypto.randomBytes(32);
    
    // Encrypt media data
    const encryptedData = await this._encryptMedia(mediaData.data, encKey);
    
    // Calculate hash
    const sha256 = crypto.createHash('sha256').update(mediaData.data).digest('hex');
    
    // Simulate upload to WhatsApp servers
    // In real implementation, this would upload to actual WhatsApp media servers
    const uploadResult = {
      mediaId: mediaId,
      url: `https://mmg.whatsapp.net/v/t62.7-24/${mediaId}`,
      encKey: encKey.toString('base64'),
      sha256: sha256,
      fileLength: mediaData.size
    };

    // Cache the upload
    this.uploadCache.set(mediaId, {
      ...uploadResult,
      originalData: mediaData.data,
      mimetype: mediaData.mimetype,
      filename: mediaData.filename
    });

    logger.debug('Media uploaded successfully', { 
      mediaId, 
      size: mediaData.size,
      mimetype: mediaData.mimetype 
    });

    return uploadResult;
  }

  /**
   * Download media from server
   * @private
   */
  async _downloadFromServer(mediaData) {
    // Simulate download from WhatsApp servers
    // In real implementation, this would download from actual URL
    
    const cached = this.uploadCache.get(mediaData.id);
    if (cached) {
      return {
        data: cached.originalData,
        mimetype: cached.mimetype,
        filename: cached.filename,
        size: cached.originalData.length
      };
    }

    // Fallback for actual server download
    throw new MessageError('Media not found on server');
  }

  /**
   * Encrypt media data
   * @private
   */
  async _encryptMedia(data, key) {
    const cipher = crypto.createCipher('aes-256-cbc', key);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return encrypted;
  }

  /**
   * Decrypt media data
   * @private
   */
  async _decryptMedia(encryptedData, keyBase64) {
    const key = Buffer.from(keyBase64, 'base64');
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    return decrypted;
  }

  /**
   * Verify media integrity
   * @private
   */
  async _verifyMediaIntegrity(data, expectedSha256) {
    const actualSha256 = crypto.createHash('sha256').update(data).digest('hex');
    
    if (actualSha256 !== expectedSha256) {
      throw new MessageError('Media integrity verification failed');
    }
  }

  /**
   * Generate thumbnail for media
   * @private
   */
  async _generateThumbnail(data, mediaType) {
    // Simplified thumbnail generation
    // In real implementation, this would use image/video processing libraries
    
    if (mediaType === MessageTypes.IMAGE) {
      // Return first 1KB as thumbnail (simplified)
      return data.slice(0, 1024);
    } else if (mediaType === MessageTypes.VIDEO) {
      // Generate video thumbnail (simplified)
      return Buffer.alloc(1024); // Placeholder
    }
    
    return null;
  }

  /**
   * Clear caches
   */
  clearCaches() {
    this.uploadCache.clear();
    this.downloadCache.clear();
    logger.debug('Media caches cleared');
  }
}

module.exports = MediaManager;
