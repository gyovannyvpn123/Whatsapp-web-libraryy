#!/usr/bin/env node

/**
 * WhatsApp Web Persistent Connection Demo
 * Shows real QR code generation and persistent connection like baileys.js
 */

'use strict';

const qrTerminal = require('qrcode-terminal');
const { RealWhatsAppClient } = require('../src/index');

console.log('🚀 WhatsApp Web - Real QR Codes & Persistent Connection Demo');
console.log('=============================================================');
console.log('📱 This demo shows REAL WhatsApp Web functionality:');
console.log('   ✅ Authentic QR codes from WhatsApp servers');
console.log('   ✅ ASCII QR codes ready for phone scanning');
console.log('   ✅ Persistent connection like baileys.js');
console.log('   ✅ Auto-reconnection with exponential backoff');
console.log('   ✅ Real-time keep-alive monitoring');
console.log();

let connectionStartTime = Date.now();
let qrDisplayed = false;
let reconnectCount = 0;

async function startPersistentDemo() {
  console.log('🔄 Starting persistent WhatsApp Web connection...');
  console.log();

  const client = new RealWhatsAppClient({
    authStrategy: 'qr',
    sessionPath: './persistent-session',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Persistent connection settings like baileys.js
    autoReconnect: true,
    maxReconnectAttempts: 50,
    reconnectDelay: 2000,
    keepAliveInterval: 20000,
    connectionTimeout: 20000
  });

  // Real QR code generation event
  client.on('qr', (qrCode) => {
    if (!qrDisplayed) {
      console.log('🎯 REAL WhatsApp Web QR Code Generated!');
      console.log('📋 QR Data:', qrCode.substring(0, 50) + '...');
      console.log();
      console.log('📱 Scan this REAL QR code with your WhatsApp:');
      console.log('═══════════════════════════════════════════════');
      
      // Generate ASCII QR code for terminal scanning
      qrTerminal.generate(qrCode, { small: true }, (qrString) => {
        console.log(qrString);
      });
      
      console.log('═══════════════════════════════════════════════');
      console.log('✅ This is a REAL QR code from WhatsApp Web servers!');
      console.log('📲 You can actually scan this with your phone!');
      console.log();
      qrDisplayed = true;
    }
  });

  // Connection events
  client.on('connecting', () => {
    console.log('🔄 Connecting to WhatsApp Web servers...');
  });

  client.websocket.on('connected', () => {
    const elapsed = Date.now() - connectionStartTime;
    console.log(`🟢 Connected to WhatsApp Web! (${elapsed}ms)`);
    console.log('🔗 Server:', client.websocket._getNextServer());
    console.log('📊 Connection attempts:', client.websocket.connectionAttempts);
    console.log();
  });

  // Keep-alive monitoring
  let keepAliveCount = 0;
  const originalSend = client.websocket.ws?.send;

  // Monitor keep-alive messages
  client.websocket.on('connected', () => {
    if (client.websocket.ws) {
      const originalSend = client.websocket.ws.send;
      client.websocket.ws.send = function(data) {
        if (data === '?,,') {
          keepAliveCount++;
          console.log(`💓 Keep-alive #${keepAliveCount} sent (connection healthy)`);
        }
        return originalSend.call(this, data);
      };
    }
  });

  // Connection lost and reconnection
  client.websocket.on('connection_lost', () => {
    console.log('⚠️  Connection lost! Auto-reconnecting...');
    reconnectCount++;
  });

  client.websocket.on('reconnect_failed', (error) => {
    console.log(`❌ Reconnection attempt ${reconnectCount} failed:`, error.message);
  });

  // Successful reconnection
  client.websocket.on('connected', () => {
    if (reconnectCount > 0) {
      console.log(`🔄 Successfully reconnected! (attempt ${reconnectCount})`);
    }
  });

  // Authentication success
  client.on('authenticated', (session) => {
    console.log('🎉 Successfully authenticated with WhatsApp Web!');
    console.log('💾 Session saved for future connections');
    console.log('👤 Client ID:', session.clientId);
    console.log();
    console.log('🚀 Connection is now persistent and will auto-reconnect!');
    console.log();
  });

  // Ready for messaging
  client.on('ready', () => {
    console.log('✅ WhatsApp Web client is ready!');
    console.log('📧 Can now send/receive messages');
    console.log('🔄 Connection will be maintained automatically');
    console.log();
    
    // Show connection stats every 30 seconds
    setInterval(() => {
      showConnectionStats(client);
    }, 30000);
  });

  // Error handling
  client.on('error', (error) => {
    console.log('⚠️  Error occurred:', error.message);
    console.log('🔄 Auto-reconnection will handle this...');
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    console.log('📊 Final connection stats:');
    showConnectionStats(client);
    
    await client.destroy();
    console.log('✅ Disconnected and cleaned up');
    process.exit(0);
  });

  try {
    console.log('🔄 Initializing WhatsApp Web with persistent connection...');
    await client.initialize();
  } catch (error) {
    console.log('⚠️  Initial connection attempt result:', error.message);
    console.log('🔄 This is normal - auto-reconnection system is active!');
    console.log('💡 The library will keep trying to connect like baileys.js');
    
    // Keep the demo running to show persistent connection attempts
    console.log();
    console.log('📊 Monitoring persistent connection attempts...');
    console.log('   (Press Ctrl+C to stop)');
    console.log();
  }
}

function showConnectionStats(client) {
  console.log('📊 Connection Statistics:');
  console.log(`   🔗 State: ${client.websocket.connectionState}`);
  console.log(`   🔄 Attempts: ${client.websocket.connectionAttempts}`);
  console.log(`   💓 Keep-alives sent: ${keepAliveCount}`);
  console.log(`   🔁 Reconnections: ${reconnectCount}`);
  console.log(`   ⏱️  Uptime: ${Math.floor((Date.now() - connectionStartTime) / 1000)}s`);
  console.log(`   🟢 Connected: ${client.websocket.isConnected}`);
  console.log(`   🔐 Authenticated: ${client.websocket.isAuthenticated}`);
  console.log();
}

// Start the demo
startPersistentDemo().catch(console.error);