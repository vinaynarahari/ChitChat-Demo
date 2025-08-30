const Redis = require('ioredis');
require('dotenv').config();

// Import MongoDB collections
const { ObjectId } = require('mongodb');
let recordedMessagesCollection;

// Function to set the collection reference (called from server/index.js)
const setRecordedMessagesCollection = (collection) => {
  recordedMessagesCollection = collection;
};

// Redis configuration with optimized settings for Valkey compatibility
const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  connectTimeout: 10000,
  // Enable pipelining for better performance
  enableOfflineQueue: true,
  // Optimize for memory usage
  maxScripts: 100,
  // Enable keep-alive
  keepAlive: 10000,
  // Valkey-specific optimizations
  lazyConnect: false,
  showFriendlyErrorStack: true,
  // Enable auto-pipelining for better performance with Valkey
  enableAutoPipelining: true,
  // Optimize for Valkey's enhanced memory management
  maxRetriesPerRequest: 3,
  // Enable connection pooling for better performance
  family: 4,
  // Optimize for Valkey's improved timeout handling
  commandTimeout: 5000,
  // Enable TLS if needed for Valkey
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined
};

// Create Redis client with optimized pipeline
const redisClient = new Redis(REDIS_CONFIG);
const pipeline = redisClient.pipeline();

// Handle Redis connection events
redisClient.on('connect', () => {
  console.log('Redis client connected');
});

redisClient.on('ready', async () => {
  console.log('Redis client ready');
  // Check for Valkey-specific features
  try {
    const info = await redisClient.info('server');
    if (info.includes('valkey') || info.includes('Valkey')) {
      console.log('✅ Valkey detected - using optimized configuration');
    } else {
      console.log('ℹ️ Standard Redis detected - using compatible configuration');
    }
  } catch (error) {
    console.log('ℹ️ Could not detect Redis variant - using compatible configuration');
  }
});

redisClient.on('error', (err) => {
  console.error('Redis client error:', err);
});

// Optimized cache wrapper with batching support
const cacheWrap = async (key, fetchFn, ttl = 300) => {
  console.log(`[cacheWrap] 🔍 Checking cache for key: ${key}`);
  
  // Check if Redis is ready and available
  if (process.env.USE_REDIS !== 'true' || redisClient.status !== 'ready') {
    console.log(`[cacheWrap] ⚠️ Redis disabled or not ready, calling fetchFn directly`);
    return fetchFn();
  }

  try {
    // Try to get from cache
    const cachedData = await redisClient.get(key);
    if (cachedData) {
      console.log(`[cacheWrap] ✅ Cache HIT for key: ${key}`);
      return JSON.parse(cachedData);
    }

    // Cache miss - fetch from source
    console.log(`[cacheWrap] ❌ Cache MISS for key: ${key}, fetching from source...`);
    const data = await fetchFn();
    
    // Cache the result directly (not using pipeline for better reliability)
    if (data) {
      console.log(`[cacheWrap] 💾 Caching result for key: ${key} with TTL: ${ttl}s`);
      await redisClient.setex(key, ttl, JSON.stringify(data));
    } else {
      console.log(`[cacheWrap] ⚠️ No data to cache for key: ${key}`);
    }
    
    return data;
  } catch (error) {
    console.error(`[cacheWrap] ❌ Cache error for key: ${key}:`, error);
    return fetchFn();
  }
};

// Optimized cache invalidation
const invalidateCache = async (pattern) => {
  if (process.env.USE_REDIS !== 'true') {
    return;
  }

  try {
    // KEYS command is disabled in ElastiCache/Valkey for performance
    // Skip pattern-based invalidation and let TTL handle cleanup
    console.log('Cache invalidation skipped for pattern (KEYS disabled):', pattern);
  } catch (error) {
    console.error('Cache invalidation error:', error);
  }
};

// Unread count utility functions (moved to top level)
const incrementUserUnreadCount = async (groupChatId, userId) => {
  if (process.env.USE_REDIS !== 'true' || redisClient.status !== 'ready') {
    return 0;
  }
  try {
    const currentCount = await redisClient.hget(`unread:${groupChatId}`, userId) || '0';
    const newCount = parseInt(currentCount) + 1;
    await redisClient.hset(`unread:${groupChatId}`, userId, newCount);
    return newCount;
  } catch (error) {
    console.error(`Error incrementing unread count for user ${userId} in group ${groupChatId}:`, error);
    return 0;
  }
};

const getUserUnreadCount = async (groupChatId, userId) => {
  if (process.env.USE_REDIS !== 'true' || redisClient.status !== 'ready') {
    return 0;
  }
  try {
    const unreadCount = await redisClient.hget(`unread:${groupChatId}`, userId) || '0';
    return parseInt(unreadCount);
  } catch (error) {
    console.error(`Error getting unread count for user ${userId} in group ${groupChatId}:`, error);
    return 0;
  }
};

const resetUserUnreadCount = async (groupChatId, userId) => {
  if (process.env.USE_REDIS !== 'true' || redisClient.status !== 'ready') {
    return false;
  }
  try {
    await redisClient.hset(`unread:${groupChatId}`, userId, '0');
    return true;
  } catch (error) {
    console.error(`Error resetting unread count for user ${userId} in group ${groupChatId}:`, error);
    return false;
  }
};

const getTotalUnreadCount = async (userId, groupChats) => {
  if (process.env.USE_REDIS !== 'true' || redisClient.status !== 'ready') {
    return 0;
  }
  try {
    let totalUnread = 0;
    for (const chat of groupChats) {
      const unreadCount = await redisClient.hget(`unread:${chat._id}`, userId) || '0';
      totalUnread += parseInt(unreadCount);
    }
    return totalUnread;
  } catch (error) {
    console.error(`Error getting total unread count for user ${userId}:`, error);
    return 0;
  }
};

// Sync unread counts from database to Redis for a user
const syncUnreadCountsFromDB = async (userId, groupChats, recordedMessagesCollection) => {
  if (process.env.USE_REDIS !== 'true' || redisClient.status !== 'ready') {
    return;
  }
  
  try {
    // Only log if debug mode is enabled
    if (process.env.DEBUG_REDIS === 'true') {
      console.log(`[Redis] Syncing unread counts from DB for user ${userId} (${groupChats.length} chats)`);
    }
    
    let totalUnreadChats = 0;
    
    for (const chat of groupChats) {
      // Calculate unread count from database
      const query = {
        groupChatId: chat._id,
        senderId: { $ne: new ObjectId(userId) },
        [`readBy.${userId}`]: { $exists: false }
      };
      
      const unreadCount = await recordedMessagesCollection.countDocuments(query);
      
      // Update Redis with the calculated count
      await redisClient.hset(`unread:${chat._id}`, userId, unreadCount);
      
      // Only log individual chat counts if there are unread messages OR if debug mode is enabled
      if (unreadCount > 0) {
        totalUnreadChats++;
        if (process.env.DEBUG_REDIS === 'true') {
          console.log(`[Redis] Synced unread count for chat ${chat._id}: ${unreadCount}`);
        }
      }
    }
    
    // Only log completion if debug mode is enabled
    if (process.env.DEBUG_REDIS === 'true') {
      console.log(`[Redis] Completed unread count sync for user ${userId} (${totalUnreadChats} chats with unread messages)`);
    }
  } catch (error) {
    console.error(`Error syncing unread counts for user ${userId}:`, error);
  }
};

// Optimized voice message cache with streaming support
const voiceMessageCache = {
  // Cache message metadata
  async setMessageMetadata(messageId, metadata) {
    const key = `message:${messageId}:metadata`;
    try {
      await redisClient.setex(key, 3600, JSON.stringify(metadata)); // 1 hour TTL
      return true;
    } catch (error) {
      console.error('Error caching message metadata:', error);
      return false;
    }
  },

  async getMessageMetadata(messageId) {
    const key = `message:${messageId}:metadata`;
    console.log(`[getMessageMetadata] Starting lookup for message: ${messageId}`);
    
    return cacheWrap(key, async () => {
      console.log(`[getMessageMetadata] Cache miss for ${messageId}, querying MongoDB...`);
      
      try {
        const message = await recordedMessagesCollection.findOne(
          { _id: new ObjectId(messageId) },
          { projection: { audioUrl: 1, duration: 1, timestamp: 1, senderId: 1, groupChatId: 1, type: 1 } }
        );
        
        console.log(`[getMessageMetadata] MongoDB query result for ${messageId}:`, {
          found: !!message,
          audioUrl: message?.audioUrl,
          duration: message?.duration,
          senderId: message?.senderId,
          groupChatId: message?.groupChatId
        });
        
        if (!message) {
          console.log(`[getMessageMetadata] ❌ Message ${messageId} not found in MongoDB`);
          return null;
        }
        
        const metadata = {
          id: message._id,
          url: message.audioUrl,
          duration: message.duration,
          timestamp: message.timestamp,
          senderId: message.senderId,
          groupChatId: message.groupChatId,
          type: message.type
        };
        
        console.log(`[getMessageMetadata] ✅ Returning metadata for ${messageId}:`, metadata);
        return metadata;
      } catch (error) {
        console.error(`[getMessageMetadata] ❌ Error querying MongoDB for ${messageId}:`, error);
        throw error;
      }
    }, 3600); // 1 hour TTL
  },

  // Cache processing status
  async setProcessingStatus(messageId, status) {
    const key = `message:${messageId}:status`;
    try {
      await redisClient.setex(key, 300, status); // 5 minute TTL
      return true;
    } catch (error) {
      console.error('Error caching processing status:', error);
      return false;
    }
  },

  async getProcessingStatus(messageId) {
    const key = `message:${messageId}:status`;
    try {
      return await redisClient.get(key);
    } catch (error) {
      console.error('Error getting cached processing status:', error);
      return null;
    }
  },

  // Optimized transcription cache
  async setTranscription(messageId, transcription) {
    const key = `message:${messageId}:transcription`;
    try {
      await redisClient.setex(key, 86400, JSON.stringify(transcription)); // 24 hour TTL
      return true;
    } catch (error) {
      console.error('Error caching transcription:', error);
      return false;
    }
  },

  async getTranscription(messageId) {
    const key = `message:${messageId}:transcription`;
    return cacheWrap(key, async () => {
      const message = await recordedMessagesCollection.findOne(
        { _id: new ObjectId(messageId) },
        { projection: { transcription: 1 } }
      );
      return message?.transcription || null;
    }, 86400);
  },

  // Cache transcription by audio hash with longer TTL
  async setTranscriptionByHash(audioHash, transcription) {
    const key = `transcription:hash:${audioHash}`;
    try {
      await redisClient.setex(key, 604800, JSON.stringify(transcription)); // 7 day TTL
      return true;
    } catch (error) {
      console.error('Error caching transcription by hash:', error);
      return false;
    }
  },

  async getTranscriptionByHash(audioHash) {
    const key = `transcription:hash:${audioHash}`;
    try {
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting cached transcription by hash:', error);
      return null;
    }
  },

  // Group unread counter
  async incrementUnreadCount(groupChatId) {
    const key = `group:${groupChatId}:unread`;
    try {
      await redisClient.incr(key);
      await redisClient.expire(key, 3600); // 1 hour TTL
      return true;
    } catch (error) {
      console.error('Error incrementing unread count:', error);
      return false;
    }
  },

  async getUnreadCount(groupChatId) {
    // Validate ObjectId format before converting
    if (!require('mongodb').ObjectId.isValid(groupChatId)) {
      console.error('[redisClient] Invalid groupChatId format in getUnreadCount:', groupChatId);
      return 0;
    }

    const key = `group:${groupChatId}:unread`;
    return cacheWrap(key, async () => {
      const count = await recordedMessagesCollection.countDocuments({
        groupChatId: new ObjectId(groupChatId),
        isRead: false
      });
      return count;
    }, 3600);
  },

  // Cache invalidation
  async invalidateMessageCache(messageId) {
    const keys = [
      `message:${messageId}:metadata`,
      `message:${messageId}:transcription`
    ];
    try {
      await Promise.all(keys.map(key => redisClient.del(key)));
      return true;
    } catch (error) {
      console.error('Error invalidating message cache:', error);
      return false;
    }
  },

  // FIXED: Clean up user-specific Redis cache data on logout
  async cleanupUserCache(userId) {
    try {
      console.log(`[redisClient] Cleaning up Redis cache for user: ${userId}`);
      
      // Get all keys that might be related to this user
      const patterns = [
        `message:*:metadata`, // Message metadata
        `message:*:transcription`, // Message transcriptions
        `message:*:status`, // Processing status
        `group:*:unread`, // Group unread counts
        `groupChat:*:messages:*`, // Group chat messages
        `groupChat:*:stream`, // Group chat streams
        `voiceMeta:*`, // Voice message metadata
        `transcription:hash:*` // Transcription cache
      ];
      
      let totalCleaned = 0;
      
      for (const pattern of patterns) {
        try {
          const keys = await redisClient.keys(pattern);
          if (keys.length > 0) {
            // For message-related keys, check if they belong to the user
            if (pattern.includes('message:')) {
              const userMessageKeys = [];
              for (const key of keys) {
                try {
                  const data = await redisClient.get(key);
                  if (data) {
                    const parsed = JSON.parse(data);
                    if (parsed.senderId === userId) {
                      userMessageKeys.push(key);
                    }
                  }
                } catch (parseError) {
                  // Skip keys that can't be parsed
                  continue;
                }
              }
              if (userMessageKeys.length > 0) {
                await redisClient.del(userMessageKeys);
                totalCleaned += userMessageKeys.length;
                console.log(`[redisClient] Cleaned ${userMessageKeys.length} user message cache keys`);
              }
            } else {
              // For other patterns, clean all (they're group-specific, not user-specific)
              await redisClient.del(keys);
              totalCleaned += keys.length;
              console.log(`[redisClient] Cleaned ${keys.length} cache keys for pattern: ${pattern}`);
            }
          }
        } catch (patternError) {
          console.error(`[redisClient] Error cleaning pattern ${pattern}:`, patternError);
        }
      }
      
      console.log(`[redisClient] ✅ Redis cache cleanup completed for user ${userId}, cleaned ${totalCleaned} keys`);
      return totalCleaned;
    } catch (error) {
      console.error(`[redisClient] ❌ Error cleaning Redis cache for user ${userId}:`, error);
      return 0;
    }
  },

  // Optimized group chat message streaming
  async getGroupMessages(groupId, page = 1, limit = 20) {
    const key = `groupChat:${groupId}:messages:${page}:${limit}`;
    return cacheWrap(key, async () => {
      // Get message IDs from stream
      const streamKey = `groupChat:${groupId}:stream`;
      const streamMessages = await redisClient.xrevrange(streamKey, '+', '-', 'COUNT', limit);
      
      if (!streamMessages.length) {
        return [];
      }

      // Get message IDs
      const messageIds = streamMessages.map(msg => msg[1][1]);
      
      // Batch fetch message metadata
      const pipeline = redisClient.pipeline();
      messageIds.forEach(id => {
        pipeline.get(`voiceMeta:${id}`);
      });
      
      const results = await pipeline.exec();
      const messages = results
        .map(([err, data]) => data ? JSON.parse(data) : null)
        .filter(Boolean);

      return messages;
    }, 60);
  },

  // Optimized cache invalidation with batching
  async invalidateGroupChat(groupId) {
    const patterns = [
      `groupChat:${groupId}:*`,
      `voiceMeta:*:${groupId}`,
      `user:*:messages:${groupId}`
    ];
    
    try {
      // KEYS command is disabled in ElastiCache/Valkey for performance
      // Skip pattern-based invalidation and let TTL handle cleanup
      console.log('Group chat cache invalidation skipped (KEYS disabled):', patterns);
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
  },

  // Add message to group chat stream
  async addToGroupStream(groupId, messageId, metadata) {
    const streamKey = `groupChat:${groupId}:stream`;
    try {
      await redisClient.xadd(streamKey, '*', 
        'messageId', messageId,
        'type', 'voice',
        'metadata', JSON.stringify(metadata)
      );
      return true;
    } catch (error) {
      console.error('Error adding to group stream:', error);
      return false;
    }
  },

  // Get latest messages from group stream
  async getLatestGroupMessages(groupId, limit = 20) {
    const streamKey = `groupChat:${groupId}:stream`;
    try {
      const messages = await redisClient.xrevrange(streamKey, '+', '-', 'COUNT', limit);
      return messages.map(msg => ({
        id: msg[0],
        messageId: msg[1][1],
        type: msg[1][3],
        metadata: JSON.parse(msg[1][5])
      }));
    } catch (error) {
      console.error('Error getting group messages:', error);
      return [];
    }
  },

  // Subscribe to group chat updates
  async subscribeToGroup(groupId, callback) {
    const streamKey = `groupChat:${groupId}:stream`;
    try {
      const subscriber = redisClient.duplicate();
      await subscriber.subscribe(`groupChat:${groupId}:updates`);
      
      subscriber.on('message', (channel, message) => {
        callback(JSON.parse(message));
      });

      return subscriber;
    } catch (error) {
      console.error('Error subscribing to group:', error);
      return null;
    }
  },

  // Publish group chat update
  async publishGroupUpdate(groupId, update) {
    try {
      await redisClient.publish(
        `groupChat:${groupId}:updates`,
        JSON.stringify(update)
      );
      return true;
    } catch (error) {
      console.error('Error publishing group update:', error);
      return false;
    }
  },

  // Alias for compatibility
  getVoiceMetadata: async function(messageId) {
    return this.getMessageMetadata(messageId);
  },

  // Generate signed URL for S3 objects
  async getSignedUrl(s3Uri) {
    console.log(`[getSignedUrl] Generating signed URL for: ${s3Uri}`);
    
    try {
      const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      
      // Create S3 client
      const s3Client = new S3Client({ region: process.env.AWS_REGION });
      
      let bucket, key;
      
      // Handle different S3 URI formats
      if (s3Uri.startsWith('s3://')) {
        // Format: s3://bucket-name/key
        const s3UriMatch = s3Uri.match(/^s3:\/\/([^\/]+)\/(.+)$/);
        if (!s3UriMatch) {
          console.error(`[getSignedUrl] ❌ Invalid s3:// URI format: ${s3Uri}`);
          throw new Error(`Invalid s3:// URI format: ${s3Uri}`);
        }
        [, bucket, key] = s3UriMatch;
      } else if (s3Uri.includes('.s3.') && s3Uri.includes('.amazonaws.com')) {
        // Format: https://bucket-name.s3.region.amazonaws.com/key
        const url = new URL(s3Uri);
        const pathParts = url.pathname.split('/').filter(part => part);
        bucket = url.hostname.split('.')[0]; // Extract bucket name from hostname
        key = pathParts.join('/'); // Join remaining parts as key
      } else {
        console.error(`[getSignedUrl] ❌ Unsupported URI format: ${s3Uri}`);
        throw new Error(`Unsupported URI format: ${s3Uri}`);
      }
      
      console.log(`[getSignedUrl] Parsed URI - Bucket: ${bucket}, Key: ${key}`);
      
      // Create GetObject command
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: 'audio/mp4',
        ResponseContentDisposition: 'attachment; filename="audio.m4a"',
        ResponseCacheControl: 'public, max-age=3600'
      });
      
      // Generate signed URL
      const signedUrl = await getSignedUrl(s3Client, command, { 
        expiresIn: 3600 // 1 hour
      });
      
      console.log(`[getSignedUrl] ✅ Generated signed URL for ${s3Uri}: ${signedUrl.substring(0, 100)}...`);
      return signedUrl;
    } catch (error) {
      console.error(`[getSignedUrl] ❌ Error generating signed URL for ${s3Uri}:`, error);
      throw error;
    }
  }
};

// Optimized batch cache operations
const batchCache = {
  mget: async (keys) => {
    if (process.env.USE_REDIS !== 'true' || redisClient.status !== 'ready') {
      return keys.map(() => null);
    }
    try {
      const values = await redisClient.mget(keys);
      return values.map(v => v ? JSON.parse(v) : null);
    } catch (error) {
      console.error('Batch cache get error:', error);
      return keys.map(() => null);
    }
  },

  mset: async (keyValues, ttl = 300) => {
    if (process.env.USE_REDIS !== 'true' || redisClient.status !== 'ready') {
      return;
    }
    try {
      // Use individual operations instead of pipeline for better reliability
      const promises = Object.entries(keyValues).map(([key, value]) => 
        redisClient.setex(key, ttl, JSON.stringify(value))
      );
      await Promise.all(promises);
    } catch (error) {
      console.error('Batch cache set error:', error);
    }
  }
};

module.exports = {
  redisClient,
  cacheWrap,
  invalidateCache,
  voiceMessageCache,
  batchCache,
  setRecordedMessagesCollection,
  // Unread count utility functions
  incrementUserUnreadCount,
  getUserUnreadCount,
  resetUserUnreadCount,
  getTotalUnreadCount,
  syncUnreadCountsFromDB,
  // FIXED: Export cleanup function for logout
  cleanupUserCache: voiceMessageCache.cleanupUserCache
}; 