/**
 * WhatsApp Web Node.js Library
 * A complete, production-ready WhatsApp Web API implementation
 * 
 * @module whatsapp-web-node
 * @version 1.0.0
 * @author WhatsApp Web Node.js Team
 * @license MIT
 */

'use strict';

// Production-ready WhatsApp Web implementation (like baileys.js)
const ProductionWhatsAppClient = require('./production-client');
const RealWebSocketManager = require('./websocket-real');
const RealWhatsAppClient = require('./real-client');

// Legacy components
const WhatsAppClient = require('./client');
const { ConnectionError, AuthError, MessageError, RateLimitError } = require('./utils');

/**
 * Main exports for the WhatsApp Web Node.js library
 * Now featuring real WhatsApp Web protocol implementation
 */
module.exports = {
  // Production-ready WhatsApp Web client (primary export - like baileys.js)
  WhatsAppClient: ProductionWhatsAppClient,
  ProductionWhatsAppClient,
  
  // Real implementation components
  RealWhatsAppClient,
  RealWebSocketManager,
  
  // Legacy client for compatibility
  LegacyWhatsAppClient: WhatsAppClient,
  
  // Error classes
  ConnectionError,
  AuthError,
  MessageError,
  RateLimitError,
  
  // Core components
  utils: require('./utils'),
  BinaryHandler: require('./binary').BinaryHandler,
  SessionManager: require('./session'),
  
  // Version information
  version: '1.0.0',
  
  // Library information
  name: 'whatsapp-web-library',
  description: 'Production-ready WhatsApp Web library with complete functionality'
};

/**
 * Create a new real WhatsApp client instance
 * 
 * @param {Object} options - Client configuration options
 * @returns {RealWhatsAppClient} New real client instance
 * @example
 * const { createClient } = require('whatsapp-web-library');
 * 
 * const client = createClient({
 *   authStrategy: 'qr',
 *   sessionPath: './session'
 * });
 */
function createClient(options = {}) {
  return new ProductionWhatsAppClient(options);
}

/**
 * Get library information
 * 
 * @returns {Object} Library information
 */
function getInfo() {
  const packageInfo = require('../package.json');
  
  return {
    name: packageInfo.name || 'whatsapp-web-node',
    version: packageInfo.version || '1.0.0',
    description: packageInfo.description || 'WhatsApp Web Node.js Library',
    author: packageInfo.author || 'WhatsApp Web Node.js Team',
    license: packageInfo.license || 'MIT',
    homepage: packageInfo.homepage || 'https://github.com/your-org/whatsapp-web-node',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  };
}

// Additional exports
module.exports.createClient = createClient;
module.exports.getInfo = getInfo;

// Default export for ES6 import compatibility
module.exports.default = RealWhatsAppClient;
