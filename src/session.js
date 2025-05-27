/**
 * Session Manager
 * Handles WhatsApp session storage, restoration, and backup
 * 
 * @class SessionManager
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { logger, AuthError } = require('./utils');

/**
 * Session Manager for WhatsApp Web
 */
class SessionManager {
  /**
   * Create session manager
   * 
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.options = options;
    this.sessionPath = options.sessionPath || './session';
    this.sessionFile = path.join(this.sessionPath, 'session.json');
    this.backupPath = path.join(this.sessionPath, 'backups');
    this.encryptSession = options.encryptSession !== false;
    this.encryptionKey = options.encryptionKey || this._generateEncryptionKey();
    this.maxBackups = options.maxBackups || 5;
    
    logger.debug('Session manager initialized', { 
      sessionPath: this.sessionPath,
      encrypted: this.encryptSession 
    });
  }

  /**
   * Save session data
   * 
   * @param {Object} sessionData - Session data to save
   * @returns {Promise<void>}
   */
  async save(sessionData) {
    try {
      logger.info('Saving session data');

      // Ensure session directory exists
      await this._ensureDirectoryExists(this.sessionPath);

      // Prepare session data
      const dataToSave = {
        ...sessionData,
        timestamp: Date.now(),
        version: '1.0.0'
      };

      // Encrypt if enabled
      let serializedData = JSON.stringify(dataToSave, null, 2);
      if (this.encryptSession) {
        serializedData = this._encryptData(serializedData);
      }

      // Create backup before saving new session
      await this._createBackup();

      // Write session data
      await fs.writeFile(this.sessionFile, serializedData, 'utf8');

      logger.info('Session data saved successfully');
      
    } catch (error) {
      logger.error('Failed to save session:', error);
      throw new AuthError(`Failed to save session: ${error.message}`);
    }
  }

  /**
   * Load session data
   * 
   * @returns {Promise<Object|null>} Session data or null if not found
   */
  async load() {
    try {
      logger.info('Loading session data');

      // Check if session file exists
      if (!(await this._fileExists(this.sessionFile))) {
        logger.info('No session file found');
        return null;
      }

      // Read session data
      let serializedData = await fs.readFile(this.sessionFile, 'utf8');

      // Decrypt if needed
      if (this.encryptSession) {
        try {
          serializedData = this._decryptData(serializedData);
        } catch (decryptError) {
          logger.error('Failed to decrypt session data:', decryptError);
          
          // Try to restore from backup
          const backupData = await this._restoreFromBackup();
          if (backupData) {
            return backupData;
          }
          
          throw new AuthError('Failed to decrypt session data and no valid backup found');
        }
      }

      // Parse session data
      const sessionData = JSON.parse(serializedData);

      // Validate session data
      if (!this._validateSessionData(sessionData)) {
        logger.error('Invalid session data format');
        
        // Try to restore from backup
        const backupData = await this._restoreFromBackup();
        if (backupData) {
          return backupData;
        }
        
        return null;
      }

      // Check if session is too old
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      if (sessionData.timestamp && Date.now() - sessionData.timestamp > maxAge) {
        logger.warn('Session data is too old, ignoring');
        return null;
      }

      logger.info('Session data loaded successfully');
      return sessionData;
      
    } catch (error) {
      logger.error('Failed to load session:', error);
      
      // Try to restore from backup
      try {
        const backupData = await this._restoreFromBackup();
        if (backupData) {
          logger.info('Session restored from backup');
          return backupData;
        }
      } catch (backupError) {
        logger.error('Failed to restore from backup:', backupError);
      }
      
      return null;
    }
  }

  /**
   * Clear session data
   * 
   * @returns {Promise<void>}
   */
  async clear() {
    try {
      logger.info('Clearing session data');

      // Create backup before clearing
      await this._createBackup();

      // Remove session file
      if (await this._fileExists(this.sessionFile)) {
        await fs.unlink(this.sessionFile);
      }

      logger.info('Session data cleared successfully');
      
    } catch (error) {
      logger.error('Failed to clear session:', error);
      throw new AuthError(`Failed to clear session: ${error.message}`);
    }
  }

  /**
   * Check if session exists
   * 
   * @returns {Promise<boolean>} True if session exists
   */
  async exists() {
    return this._fileExists(this.sessionFile);
  }

  /**
   * Get session info
   * 
   * @returns {Promise<Object|null>} Session info or null
   */
  async getInfo() {
    try {
      if (!(await this.exists())) {
        return null;
      }

      const stats = await fs.stat(this.sessionFile);
      
      return {
        exists: true,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        encrypted: this.encryptSession
      };
      
    } catch (error) {
      logger.error('Failed to get session info:', error);
      return null;
    }
  }

  /**
   * Create session backup
   * 
   * @returns {Promise<void>}
   */
  async backup() {
    await this._createBackup();
  }

  /**
   * List available backups
   * 
   * @returns {Promise<Object[]>} Array of backup info objects
   */
  async listBackups() {
    try {
      if (!(await this._directoryExists(this.backupPath))) {
        return [];
      }

      const files = await fs.readdir(this.backupPath);
      const backups = [];

      for (const file of files) {
        if (file.startsWith('session_backup_') && file.endsWith('.json')) {
          const filePath = path.join(this.backupPath, file);
          const stats = await fs.stat(filePath);
          
          backups.push({
            filename: file,
            path: filePath,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
          });
        }
      }

      // Sort by creation date (newest first)
      backups.sort((a, b) => b.created.getTime() - a.created.getTime());

      return backups;
      
    } catch (error) {
      logger.error('Failed to list backups:', error);
      return [];
    }
  }

  /**
   * Restore from specific backup
   * 
   * @param {string} [backupFilename] - Backup filename, or latest if not specified
   * @returns {Promise<Object|null>} Restored session data or null
   */
  async restoreFromBackup(backupFilename = null) {
    try {
      const backups = await this.listBackups();
      
      if (backups.length === 0) {
        logger.warn('No backups available');
        return null;
      }

      let backupFile;
      if (backupFilename) {
        backupFile = backups.find(b => b.filename === backupFilename);
        if (!backupFile) {
          throw new Error(`Backup file not found: ${backupFilename}`);
        }
      } else {
        backupFile = backups[0]; // Latest backup
      }

      logger.info('Restoring session from backup', { filename: backupFile.filename });

      // Read backup data
      let serializedData = await fs.readFile(backupFile.path, 'utf8');

      // Decrypt if needed
      if (this.encryptSession) {
        serializedData = this._decryptData(serializedData);
      }

      // Parse and validate
      const sessionData = JSON.parse(serializedData);
      if (!this._validateSessionData(sessionData)) {
        throw new Error('Invalid backup data format');
      }

      // Save as current session
      await this.save(sessionData);

      logger.info('Session restored from backup successfully');
      return sessionData;
      
    } catch (error) {
      logger.error('Failed to restore from backup:', error);
      throw new AuthError(`Failed to restore from backup: ${error.message}`);
    }
  }

  /**
   * Clean old backups
   * 
   * @returns {Promise<void>}
   */
  async cleanOldBackups() {
    try {
      const backups = await this.listBackups();
      
      if (backups.length <= this.maxBackups) {
        return; // No cleanup needed
      }

      // Remove oldest backups
      const backupsToRemove = backups.slice(this.maxBackups);
      
      for (const backup of backupsToRemove) {
        await fs.unlink(backup.path);
        logger.debug('Removed old backup', { filename: backup.filename });
      }

      logger.info('Old backups cleaned', { removed: backupsToRemove.length });
      
    } catch (error) {
      logger.error('Failed to clean old backups:', error);
    }
  }

  /**
   * Create backup of current session
   * @private
   */
  async _createBackup() {
    try {
      if (!(await this._fileExists(this.sessionFile))) {
        return; // No session to backup
      }

      // Ensure backup directory exists
      await this._ensureDirectoryExists(this.backupPath);

      // Create backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilename = `session_backup_${timestamp}.json`;
      const backupFilePath = path.join(this.backupPath, backupFilename);

      // Copy session file to backup
      await fs.copyFile(this.sessionFile, backupFilePath);

      logger.debug('Session backup created', { filename: backupFilename });

      // Clean old backups
      await this.cleanOldBackups();
      
    } catch (error) {
      logger.error('Failed to create backup:', error);
      // Don't throw error for backup failures
    }
  }

  /**
   * Restore from latest backup
   * @private
   */
  async _restoreFromBackup() {
    try {
      return await this.restoreFromBackup();
    } catch (error) {
      logger.error('Failed to restore from backup:', error);
      return null;
    }
  }

  /**
   * Validate session data format
   * @private
   */
  _validateSessionData(sessionData) {
    if (!sessionData || typeof sessionData !== 'object') {
      return false;
    }

    // Check required fields
    const requiredFields = ['clientToken', 'serverToken'];
    for (const field of requiredFields) {
      if (!sessionData[field]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate encryption key
   * @private
   */
  _generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Encrypt data
   * @private
   */
  _encryptData(data) {
    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(this.encryptionKey, 'hex');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipher(algorithm, key);
    cipher.setAAD(Buffer.from('whatsapp-session', 'utf8'));
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
      algorithm,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted
    });
  }

  /**
   * Decrypt data
   * @private
   */
  _decryptData(encryptedData) {
    const parsed = JSON.parse(encryptedData);
    const { algorithm, iv, authTag, data } = parsed;
    
    const key = Buffer.from(this.encryptionKey, 'hex');
    
    const decipher = crypto.createDecipher(algorithm, key);
    decipher.setAAD(Buffer.from('whatsapp-session', 'utf8'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Check if file exists
   * @private
   */
  async _fileExists(filePath) {
    try {
      await fs.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if directory exists
   * @private
   */
  async _directoryExists(dirPath) {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Ensure directory exists
   * @private
   */
  async _ensureDirectoryExists(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

module.exports = SessionManager;
