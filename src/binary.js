/**
 * Binary Protocol Handler
 * Handles WhatsApp Web binary message encoding and decoding
 * 
 * @class BinaryHandler
 */

'use strict';

const { logger } = require('./utils');

/**
 * Binary Protocol Handler for WhatsApp Web
 */
class BinaryHandler {
  /**
   * Create binary handler
   */
  constructor() {
    // WhatsApp Web binary protocol constants
    this.TAGS = {
      // Core protocol tags
      STREAM_START: 1,
      STREAM_END: 2,
      
      // Message tags
      MESSAGE: 10,
      NOTIFICATION: 11,
      RECEIPT: 12,
      
      // Authentication tags
      AUTH: 20,
      CHALLENGE: 21,
      SUCCESS: 22,
      FAILURE: 23,
      
      // Presence tags
      PRESENCE: 30,
      AVAILABLE: 31,
      UNAVAILABLE: 32,
      
      // Media tags
      MEDIA: 40,
      IMAGE: 41,
      VIDEO: 42,
      AUDIO: 43,
      DOCUMENT: 44,
      
      // Group tags
      GROUP: 50,
      PARTICIPANT: 51,
      
      // Contact tags
      CONTACT: 60,
      STATUS: 61
    };

    // Binary tokens (simplified set)
    this.TOKENS = [
      null, // 0 - reserved
      'stream:start',
      'stream:end',
      'iq',
      'message',
      'notification',
      'presence',
      'receipt',
      'response',
      'success',
      'failure',
      'auth',
      'challenge',
      'type',
      'id',
      'from',
      'to',
      'xmlns',
      'class',
      'text',
      'media',
      'image',
      'video',
      'audio',
      'document',
      'body',
      'participant',
      'group',
      'contact',
      'status'
    ];

    // Attribute mappings
    this.ATTRIBUTES = {
      TYPE: 'type',
      ID: 'id',
      FROM: 'from',
      TO: 'to',
      CLASS: 'class',
      XMLNS: 'xmlns',
      T: 't'
    };

    logger.debug('Binary handler initialized');
  }

  /**
   * Encode object to binary format
   * 
   * @param {Object} obj - Object to encode
   * @returns {Buffer} Binary encoded data
   */
  encode(obj) {
    try {
      const writer = new BinaryWriter();
      this._writeNode(writer, obj);
      return writer.toBuffer();
      
    } catch (error) {
      logger.error('Failed to encode binary data:', error);
      throw error;
    }
  }

  /**
   * Decode binary data to object
   * 
   * @param {Buffer} data - Binary data to decode
   * @returns {Object} Decoded object
   */
  decode(data) {
    try {
      const reader = new BinaryReader(data);
      return this._readNode(reader);
      
    } catch (error) {
      logger.error('Failed to decode binary data:', error);
      throw error;
    }
  }

  /**
   * Write node to binary writer
   * @private
   */
  _writeNode(writer, node) {
    if (typeof node === 'string') {
      this._writeString(writer, node);
      return;
    }

    if (typeof node === 'number') {
      this._writeNumber(writer, node);
      return;
    }

    if (Buffer.isBuffer(node)) {
      this._writeBytes(writer, node);
      return;
    }

    if (Array.isArray(node)) {
      this._writeArray(writer, node);
      return;
    }

    if (typeof node === 'object' && node !== null) {
      this._writeObject(writer, node);
      return;
    }

    // Null or undefined
    writer.writeByte(0);
  }

  /**
   * Write string to binary writer
   * @private
   */
  _writeString(writer, str) {
    const tokenIndex = this.TOKENS.indexOf(str);
    
    if (tokenIndex > 0 && tokenIndex < 256) {
      // Write as token
      writer.writeByte(tokenIndex);
    } else {
      // Write as string literal
      const encoded = Buffer.from(str, 'utf8');
      if (encoded.length < 256) {
        writer.writeByte(252); // String8 marker
        writer.writeByte(encoded.length);
      } else {
        writer.writeByte(253); // String20 marker
        writer.writeInt20(encoded.length);
      }
      writer.writeBytes(encoded);
    }
  }

  /**
   * Write number to binary writer
   * @private
   */
  _writeNumber(writer, num) {
    if (Number.isInteger(num) && num >= 0 && num < 256) {
      writer.writeByte(250); // Number marker
      writer.writeByte(num);
    } else {
      // Convert to string and write
      this._writeString(writer, num.toString());
    }
  }

  /**
   * Write bytes to binary writer
   * @private
   */
  _writeBytes(writer, bytes) {
    writer.writeByte(254); // Bytes marker
    writer.writeInt20(bytes.length);
    writer.writeBytes(bytes);
  }

  /**
   * Write array to binary writer
   * @private
   */
  _writeArray(writer, arr) {
    writer.writeByte(251); // Array marker
    writer.writeByte(arr.length);
    
    for (const item of arr) {
      this._writeNode(writer, item);
    }
  }

  /**
   * Write object to binary writer
   * @private
   */
  _writeObject(writer, obj) {
    // Write tag
    if (obj.tag) {
      this._writeString(writer, obj.tag);
    } else {
      writer.writeByte(0);
    }

    // Count attributes
    const attributes = [];
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'tag' && key !== 'content' && key !== 'children') {
        attributes.push([key, value]);
      }
    }

    // Write attribute count
    writer.writeByte(attributes.length);

    // Write attributes
    for (const [key, value] of attributes) {
      this._writeString(writer, key);
      this._writeNode(writer, value);
    }

    // Write content/children
    if (obj.content !== undefined) {
      this._writeNode(writer, obj.content);
    } else if (obj.children && Array.isArray(obj.children)) {
      this._writeArray(writer, obj.children);
    } else {
      writer.writeByte(0); // No content
    }
  }

  /**
   * Read node from binary reader
   * @private
   */
  _readNode(reader) {
    const marker = reader.readByte();

    if (marker === 0) {
      return null;
    }

    if (marker >= 1 && marker < this.TOKENS.length) {
      return this.TOKENS[marker];
    }

    switch (marker) {
      case 250: // Number
        return reader.readByte();
        
      case 251: // Array
        return this._readArray(reader);
        
      case 252: // String8
        const len8 = reader.readByte();
        return reader.readBytes(len8).toString('utf8');
        
      case 253: // String20
        const len20 = reader.readInt20();
        return reader.readBytes(len20).toString('utf8');
        
      case 254: // Bytes
        const bytesLen = reader.readInt20();
        return reader.readBytes(bytesLen);
        
      case 255: // Object
        return this._readObject(reader);
        
      default:
        throw new Error(`Unknown binary marker: ${marker}`);
    }
  }

  /**
   * Read array from binary reader
   * @private
   */
  _readArray(reader) {
    const length = reader.readByte();
    const array = [];
    
    for (let i = 0; i < length; i++) {
      array.push(this._readNode(reader));
    }
    
    return array;
  }

  /**
   * Read object from binary reader
   * @private
   */
  _readObject(reader) {
    const tag = this._readNode(reader);
    const attributeCount = reader.readByte();
    
    const obj = {};
    
    if (tag) {
      obj.tag = tag;
    }

    // Read attributes
    for (let i = 0; i < attributeCount; i++) {
      const key = this._readNode(reader);
      const value = this._readNode(reader);
      obj[key] = value;
    }

    // Read content
    const content = this._readNode(reader);
    if (content !== null) {
      if (Array.isArray(content)) {
        obj.children = content;
      } else {
        obj.content = content;
      }
    }

    return obj;
  }

  /**
   * Get token for string
   * 
   * @param {string} str - String to get token for
   * @returns {number|null} Token index or null if not found
   */
  getToken(str) {
    const index = this.TOKENS.indexOf(str);
    return index > 0 ? index : null;
  }

  /**
   * Get string for token
   * 
   * @param {number} token - Token index
   * @returns {string|null} String or null if invalid token
   */
  getString(token) {
    return this.TOKENS[token] || null;
  }
}

/**
 * Binary Writer helper class
 */
class BinaryWriter {
  constructor() {
    this.buffers = [];
    this.length = 0;
  }

  writeByte(byte) {
    const buffer = Buffer.from([byte & 0xFF]);
    this.buffers.push(buffer);
    this.length += 1;
  }

  writeBytes(bytes) {
    this.buffers.push(bytes);
    this.length += bytes.length;
  }

  writeInt20(value) {
    // Write 20-bit integer in 3 bytes
    const bytes = Buffer.alloc(3);
    bytes[0] = (value >> 16) & 0xFF;
    bytes[1] = (value >> 8) & 0xFF;
    bytes[2] = value & 0xFF;
    this.writeBytes(bytes);
  }

  writeInt32(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value, 0);
    this.writeBytes(buffer);
  }

  toBuffer() {
    return Buffer.concat(this.buffers, this.length);
  }
}

/**
 * Binary Reader helper class
 */
class BinaryReader {
  constructor(data) {
    this.data = data;
    this.position = 0;
  }

  readByte() {
    if (this.position >= this.data.length) {
      throw new Error('Unexpected end of binary data');
    }
    return this.data[this.position++];
  }

  readBytes(count) {
    if (this.position + count > this.data.length) {
      throw new Error('Unexpected end of binary data');
    }
    
    const bytes = this.data.slice(this.position, this.position + count);
    this.position += count;
    return bytes;
  }

  readInt20() {
    // Read 20-bit integer from 3 bytes
    const bytes = this.readBytes(3);
    return (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  }

  readInt32() {
    const bytes = this.readBytes(4);
    return bytes.readUInt32BE(0);
  }

  hasMore() {
    return this.position < this.data.length;
  }

  getPosition() {
    return this.position;
  }

  getRemaining() {
    return this.data.length - this.position;
  }
}

module.exports = { BinaryHandler, BinaryWriter, BinaryReader };
