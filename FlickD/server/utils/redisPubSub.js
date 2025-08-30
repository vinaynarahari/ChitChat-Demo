const Redis = require('ioredis');
const { getIO } = require('../socket');
const { ObjectId } = require('mongodb');
const { getCollection } = require('../database/collections');

// Channel names
const CHANNELS = {
  MESSAGE_READY: 'message:ready',
  TRANSCRIPTION_READY: 'transcription:ready'
};

// Create Redis client for Pub/Sub using ioredis (same as main app)
const pubSubClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  retryStrategy: (times) => Math.min(times * 50, 1000),
  connectTimeout: 10000,
  commandTimeout: 5000,
  keepAlive: 10000
});

// Initialize Pub/Sub
const initializePubSub = async () => {
  try {
    if (pubSubClient.status === 'ready') {
      console.log('Redis Pub/Sub client already connected');
      return;
    }

    // Wait for connection to be ready
    await new Promise((resolve, reject) => {
      if (pubSubClient.status === 'ready') {
        resolve();
        return;
      }
      
      const timeout = setTimeout(() => {
        reject(new Error('Redis Pub/Sub connection timeout'));
      }, 10000);
      
      pubSubClient.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      pubSubClient.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    
    console.log('Redis Pub/Sub client connected');

    // Check for Valkey-specific features
    try {
      const info = await pubSubClient.info('server');
      if (info.includes('valkey') || info.includes('Valkey')) {
        console.log('✅ Valkey detected for Pub/Sub - using optimized configuration');
      } else {
        console.log('ℹ️ Standard Redis detected for Pub/Sub - using compatible configuration');
      }
    } catch (error) {
      console.log('ℹ️ Could not detect Redis variant for Pub/Sub - using compatible configuration');
    }

    // Subscribe to channels
    await pubSubClient.subscribe(CHANNELS.MESSAGE_READY);
    await pubSubClient.subscribe(CHANNELS.TRANSCRIPTION_READY);
    
    // Set up message handlers
    pubSubClient.on('message', (channel, message) => {
      if (channel === CHANNELS.MESSAGE_READY) {
        handleMessageReady(message);
      } else if (channel === CHANNELS.TRANSCRIPTION_READY) {
        handleTranscriptionReady(message);
      }
    });
  } catch (error) {
    console.error('Redis Pub/Sub initialization error:', error);
    throw error;
  }
};

// Handle new message ready event
const handleMessageReady = async (message) => {
  try {
    const { groupChatId, messageId } = JSON.parse(message);
    const io = getIO();
    
    // Emit to specific group chat room
    io.to(groupChatId).emit('message:ready', { messageId });
  } catch (error) {
    console.error('Error handling message ready event:', error);
  }
};

// Handle transcription ready event
const handleTranscriptionReady = async (message) => {
  try {
    const { messageId, transcription } = JSON.parse(message);
    const io = getIO();
    // Get message to find group chat
    const recordedMessagesCollection = getCollection('recordedMessages');
    const messageDoc = await recordedMessagesCollection.findOne(
      { _id: new ObjectId(messageId) },
      { projection: { groupChatId: 1 } }
    );
    if (messageDoc) {
      console.log('[Socket] Emitting transcription:ready to group:', messageDoc.groupChatId, 'for message:', messageId);
      io.to(messageDoc.groupChatId).emit('transcription:ready', {
        messageId,
        transcription
      });
    } else {
      console.warn('[Socket] Could not find message for transcription:ready emit:', messageId);
    }
  } catch (error) {
    console.error('Error handling transcription ready event:', error);
  }
};

// Publish message ready event
const publishMessageReady = async (groupChatId, messageId) => {
  try {
    await pubSubClient.publish(
      CHANNELS.MESSAGE_READY,
      JSON.stringify({ groupChatId, messageId })
    );
  } catch (error) {
    console.error('Error publishing message ready event:', error);
  }
};

// Publish transcription ready event
const publishTranscriptionReady = async (messageId, transcription) => {
  try {
    await pubSubClient.publish(
      CHANNELS.TRANSCRIPTION_READY,
      JSON.stringify({ messageId, transcription })
    );
  } catch (error) {
    console.error('Error publishing transcription ready event:', error);
  }
};

module.exports = {
  initializePubSub,
  publishMessageReady,
  publishTranscriptionReady
}; 