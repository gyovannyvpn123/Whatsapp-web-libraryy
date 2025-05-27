/**
 * WhatsApp Web Constants
 * Real constants used by WhatsApp Web protocol
 */

'use strict';

module.exports = {
  // WebSocket endpoints
  WA_WEB_SERVERS: [
    'wss://w1.web.whatsapp.com/ws',
    'wss://w2.web.whatsapp.com/ws',
    'wss://w3.web.whatsapp.com/ws',
    'wss://w4.web.whatsapp.com/ws',
    'wss://w5.web.whatsapp.com/ws',
    'wss://w6.web.whatsapp.com/ws',
    'wss://w7.web.whatsapp.com/ws',
    'wss://w8.web.whatsapp.com/ws'
  ],

  // WhatsApp Web version
  WA_VERSION: '2,2121,6',

  // Message types
  MessageTypes: {
    TEXT: 'conversation',
    IMAGE: 'imageMessage',
    VIDEO: 'videoMessage',
    AUDIO: 'audioMessage',
    DOCUMENT: 'documentMessage',
    STICKER: 'stickerMessage',
    LOCATION: 'locationMessage',
    CONTACT: 'contactMessage'
  },

  // Presence types
  PresenceTypes: {
    AVAILABLE: 'available',
    UNAVAILABLE: 'unavailable',
    COMPOSING: 'composing',
    RECORDING: 'recording',
    PAUSED: 'paused'
  },

  // Group roles
  GroupRoles: {
    ADMIN: 'admin',
    MEMBER: 'member'
  }
};