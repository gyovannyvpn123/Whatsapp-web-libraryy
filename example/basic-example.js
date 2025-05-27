#!/usr/bin/env node

/**
 * Basic WhatsApp Web Library Example
 * Demonstrates core functionality of the library
 */

'use strict';

const { WhatsAppClient } = require('../src/index');

async function main() {
  console.log('🚀 Starting WhatsApp Web Library Example...');
  console.log('================================================');

  // Create WhatsApp client with authentication options
  const client = new WhatsAppClient({
    authStrategy: 'qr', // or 'pairing'
    sessionPath: './session',
    headless: true,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    maxRetries: 3,
    retryDelay: 5000,
    messageTimeout: 30000,
    rateLimit: {
      messages: 20,
      interval: 60000
    }
  });

  // Event handlers
  client.on('qr', (qr) => {
    console.log('📱 QR Code generated!');
    console.log('Scan this QR code with your WhatsApp app:');
    console.log(qr);
  });

  client.on('ready', () => {
    console.log('✅ WhatsApp Web client is ready!');
    console.log('Client info:', client.getInfo());
  });

  client.on('authenticated', (session) => {
    console.log('🔐 Client authenticated successfully!');
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
  });

  client.on('message', async (message) => {
    console.log('📩 New message received:', {
      from: message.from,
      body: message.body,
      timestamp: new Date(message.timestamp * 1000).toISOString()
    });

    // Auto-reply to test messages
    if (message.body === '!ping') {
      await client.sendText(message.from, '🏓 Pong! WhatsApp Web Library is working!');
    }
  });

  client.on('message_create', (message) => {
    console.log('📤 Message sent:', {
      to: message.to,
      body: message.body
    });
  });

  client.on('disconnected', (reason) => {
    console.log('🔌 Client disconnected:', reason);
  });

  client.on('error', (error) => {
    console.error('💥 Client error:', error);
  });

  try {
    // Initialize the client
    console.log('🔄 Initializing WhatsApp Web client...');
    await client.initialize();

    // Keep the process running
    console.log('🔄 Client is running... Press Ctrl+C to exit');
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down gracefully...');
      try {
        await client.destroy();
        console.log('✅ Client destroyed successfully');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('💥 Failed to initialize client:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run the example
main().catch(console.error);