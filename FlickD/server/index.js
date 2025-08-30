const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
require('dotenv').config();
const API_URL = process.env.API_URL;
const summaryGenerator = require('./utils/summaryGenerator');
const { cacheWrap, invalidateCache, voiceMessageCache, batchCache, incrementUserUnreadCount, getUserUnreadCount, resetUserUnreadCount, getTotalUnreadCount } = require('./utils/redisClient');
const { performanceMiddleware, voiceMessageMetrics } = require('./utils/metrics');
const { startTranscription, handleTranscriptionEvent, handleTranscriptionComplete } = require('./utils/transcriptionHandler');
const { initializeSocket } = require('./socket');
const { getIO } = require('./socket');
const { publishMessageReady, publishTranscriptionReady } = require('./utils/redisPubSub');
const { initializePubSub } = require('./utils/redisPubSub');
const openAIService = require('./utils/openAIService');
const Redis = require('ioredis');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Initialize Socket.IO
initializeSocket(httpServer);

// Enable CORS for all routes
app.use(cors({
  origin: '*', // Allow all origins in development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());
// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));
// Increase payload size limit for file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || "flickd_jwt_secret_key_2024_secure_token_generation";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "flickd_refresh_token_secret_2024_secure_token_generation";
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '1h';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

const uri = process.env.MONGODB_URI || "mongodb+srv://test%5Fuser:mypassword1@cluster0.ddewxiq.mongodb.net/flickD?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri);

let usersCollection;
let groupChatsCollection;
let recordedMessagesCollection;
let messageReadStatusCollection;
let postsCollection;
let newspaperSummariesCollection;
let newspaperMediaCollection;

// S3 Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Initialize Redis client
let redisClient;
try {
  redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    }
  });

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  redisClient.on('connect', () => {
    console.log('Redis Client Connected');
  });
} catch (error) {
  console.error('Failed to initialize Redis client:', error);
  // Create a mock Redis client that does nothing
  redisClient = {
    hset: async () => 0,
    hget: async () => '0',
    hincrby: async () => 0,
    hgetall: async () => ({}),
    del: async () => 0
  };
}

// Helper function to safely use Redis
const safeRedisOperation = async (operation, ...args) => {
  try {
    return await operation(...args);
  } catch (error) {
    console.error('Redis operation failed:', error);
    return 0; // Return default value on error
  }
};

async function connectDB() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db('flickD');
    usersCollection = db.collection('users');
    groupChatsCollection = db.collection('groupChats');
    recordedMessagesCollection = db.collection('recordedMessages');
    messageReadStatusCollection = db.collection('messageReadStatus');
    postsCollection = db.collection('posts');
    newspaperSummariesCollection = db.collection('newspaperSummaries');
    newspaperMediaCollection = db.collection('newspaperMedia');
    
    // Create indexes for better performance
    await groupChatsCollection.createIndex({ 'members.userId': 1 });
    await recordedMessagesCollection.createIndex({ groupChatId: 1, timestamp: -1 });
    await messageReadStatusCollection.createIndex({ userId: 1, groupChatId: 1 });
    await postsCollection.createIndex({ userId: 1, createdAt: -1 });
    await postsCollection.createIndex({ tags: 1 });
    await newspaperMediaCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 86400 });
    
    // Set up collection references for other modules
    const { setRecordedMessagesCollection } = require('./utils/redisClient');
    setRecordedMessagesCollection(recordedMessagesCollection);
    
    console.log('Database collections initialized');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

// Test endpoint to verify database connection
app.get('/api/test', async (req, res) => {
  try {
    // Test database connection
    await client.db().admin().ping();
    
    // Test collections
    const collections = await client.db('flickD').listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    res.json({
      status: 'ok',
      message: 'Database connection successful',
      collections: collectionNames
    });
  } catch (error) {
    console.error('Database test failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      error: error.message
    });
  }
});

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  console.log('Signup endpoint hit');
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  const existingUser = await usersCollection.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ error: 'User already exists' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const result = await usersCollection.insertOne({ name, email, password: hashedPassword });
  console.log('User created with _id:', result.insertedId);

  // Generate access token and refresh token with proper expiration
  const accessToken = jwt.sign(
    {
      userId: result.insertedId,
      email: email,
      name: name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour from now
    },
    JWT_SECRET
  );

  const refreshToken = jwt.sign(
    {
      userId: result.insertedId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days from now
    },
    REFRESH_TOKEN_SECRET
  );

  // Store refresh token in database
  await usersCollection.updateOne(
    { _id: result.insertedId },
    { $set: { refreshToken } }
  );

  res.json({
    message: 'User created',
    userId: result.insertedId,
    accessToken,
    refreshToken,
    name,
    email
  });
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  console.log('Login request received:', {
    body: { ...req.body, password: '[REDACTED]' },
    headers: req.headers,
    ip: req.ip
  });

  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      console.log('Login failed: Missing credentials');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await usersCollection.findOne({ email });
    if (!user) {
      console.log('Login failed: User not found for email:', email);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('Login failed: Invalid password for email:', email);
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Generate access token and refresh token with proper expiration
    const accessToken = jwt.sign(
      { 
        userId: user._id, 
        email: user.email, 
        name: user.name,
        iat: Math.floor(Date.now() / 1000), // Current time in seconds
        exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour from now
      },
      JWT_SECRET
    );
    
    const refreshToken = jwt.sign(
      { 
        userId: user._id,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days from now
      },
      REFRESH_TOKEN_SECRET
    );

    // Store refresh token in database
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { refreshToken } }
    );

    console.log('Login successful for user:', {
      userId: user._id,
      email: user.email,
      name: user.name
    });

    res.json({
      accessToken,
      refreshToken,
      userId: user._id,
      name: user.name,
      email: user.email
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Refresh token endpoint
app.post('/api/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    console.log('Refresh token missing in request');
    return res.status(401).json({ error: 'Refresh token required' });
  }

  try {
    console.log('Attempting to verify refresh token...');
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);


    const user = await usersCollection.findOne({ _id: new ObjectId(decoded.userId) });

    if (!user) {
      console.log('User not found for refresh token');
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    if (user.refreshToken !== refreshToken) {
  
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Generate new access token with explicit expiration
    const accessToken = jwt.sign(
      { 
        userId: user._id, 
        email: user.email, 
        name: user.name,
        iat: Math.floor(Date.now() / 1000), // Current time in seconds
        exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour from now
      },
      JWT_SECRET
    );


    res.json({ accessToken });
  } catch (error) {
    console.error('Refresh token error:', error.message);
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout endpoint
app.post('/api/logout', async (req, res) => {
  const { userId } = req.body;
  const timestamp = new Date().toISOString();
  
  console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_REQUEST_RECEIVED:`, {
    userId,
    hasUserId: !!userId,
    requestHeaders: req.headers,
    requestBody: req.body,
    reason: 'logout_request_received'
  });
  
  try {
    if (!userId) {
      console.warn(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_NO_USER_ID:`, {
        requestBody: req.body,
        reason: 'missing_user_id_in_request'
      });
      return res.status(400).json({ error: 'User ID is required' });
    }

    console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_PROCESSING_USER:`, {
      userId,
      reason: 'processing_logout_for_user'
    });

    // Check if user exists before processing logout
    const existingUser = await usersCollection.findOne({ _id: new ObjectId(userId) });
    if (!existingUser) {
      console.warn(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_USER_NOT_FOUND:`, {
        userId,
        reason: 'user_not_found_in_database'
      });
      // Still return success to avoid client-side errors
      return res.json({ message: 'Logged out successfully' });
    }

    console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_USER_FOUND:`, {
      userId,
      userEmail: existingUser.email,
      userName: existingUser.name,
      hasRefreshToken: !!existingUser.refreshToken,
      isOnline: existingUser.isOnline,
      reason: 'user_found_processing_logout'
    });

    // Remove refresh token and update user status
    console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_UPDATING_USER_STATUS:`, {
      userId,
      reason: 'updating_user_logout_status'
    });

    const userUpdateResult = await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { 
        $unset: { 
          refreshToken: "",
          lastActive: ""
        },
        $set: {
          isOnline: false,
          lastLogout: new Date()
        }
      }
    );

    console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_USER_UPDATE_RESULT:`, {
      userId,
      matchedCount: userUpdateResult.matchedCount,
      modifiedCount: userUpdateResult.modifiedCount,
      acknowledged: userUpdateResult.acknowledged,
      reason: 'user_status_update_completed'
    });

    // Clean up any active sessions or temporary data
    console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_CLEANUP_START:`, {
      userId,
      reason: 'starting_user_data_cleanup'
    });

    const cleanupResults = await Promise.all([
      // Remove any pending notifications
      usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { notifications: [] } }
      ),
      // Update last active timestamp in group chats
      groupChatsCollection.updateMany(
        { 'members.userId': String(userId) },
        { $set: { 'members.$.lastActive': new Date() } }
      )
    ]);

    console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_CLEANUP_RESULTS:`, {
      userId,
      notificationCleanup: {
        matchedCount: cleanupResults[0].matchedCount,
        modifiedCount: cleanupResults[0].modifiedCount
      },
      groupChatCleanup: {
        matchedCount: cleanupResults[1].matchedCount,
        modifiedCount: cleanupResults[1].modifiedCount
      },
      reason: 'user_data_cleanup_completed'
    });

    // Clean up socket-related data
    console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_SOCKET_CLEANUP_START:`, {
      userId,
      reason: 'starting_socket_cleanup'
    });

    try {
      const { getIO, recordingStates, recordingQueues } = require('./socket');
      const io = getIO();
      
      if (io) {
        console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_SOCKET_AVAILABLE:`, {
          userId,
          reason: 'socket_io_instance_available'
        });

        // Clean up recording states
        let cleanedRecordingStates = [];
        recordingStates.forEach((users, groupId) => {
          if (users.has(String(userId))) {
            users.delete(String(userId));
            cleanedRecordingStates.push(groupId);
            
            console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_RECORDING_STATE_CLEANED:`, {
              userId,
              groupId,
              remainingUsers: Array.from(users),
              reason: 'removed_user_from_recording_state'
            });
            
            // Notify other users about the recording state change
            io.to(groupId).emit('recording_state_update', {
              groupId,
              recordingUsers: Array.from(users),
              isAnyoneRecording: users.size > 0,
              loggedOutUser: String(userId)
            });
            
            // Clean up empty recording state
            if (users.size === 0) {
              recordingStates.delete(groupId);
              console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_EMPTY_RECORDING_STATE_DELETED:`, {
                userId,
                groupId,
                reason: 'deleted_empty_recording_state'
              });
            }
          }
        });

        // Clean up recording queues
        let cleanedRecordingQueues = [];
        recordingQueues.forEach((queue, groupId) => {
          const userIndex = queue.findIndex(user => user.userId === String(userId));
          if (userIndex !== -1) {
            queue.splice(userIndex, 1);
            cleanedRecordingQueues.push(groupId);
            
            console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_RECORDING_QUEUE_CLEANED:`, {
              userId,
              groupId,
              removedFromPosition: userIndex + 1,
              remainingQueueLength: queue.length,
              reason: 'removed_user_from_recording_queue'
            });
            
            // Update positions for remaining users
            queue.forEach((user, index) => {
              user.position = index + 1;
            });
            
            // Notify other users about the queue change
            io.to(groupId).emit('recording_queue_updated', {
              groupId,
              queue: queue.slice()
            });
            
            // Clean up empty queue
            if (queue.length === 0) {
              recordingQueues.delete(groupId);
              console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_EMPTY_RECORDING_QUEUE_DELETED:`, {
                userId,
                groupId,
                reason: 'deleted_empty_recording_queue'
              });
            }
          }
        });

        console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_SOCKET_CLEANUP_COMPLETE:`, {
          userId,
          cleanedRecordingStates,
          cleanedRecordingQueues,
          reason: 'socket_cleanup_completed'
        });

        // Disconnect user's socket connections
        const userSockets = await io.in(String(userId)).fetchSockets();
        console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_USER_SOCKETS_FOUND:`, {
          userId,
          socketCount: userSockets.length,
          socketIds: userSockets.map(s => s.id),
          reason: 'found_user_socket_connections'
        });

        userSockets.forEach(socket => {
          console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_DISCONNECTING_SOCKET:`, {
            userId,
            socketId: socket.id,
            reason: 'disconnecting_user_socket'
          });
          
          socket.disconnect(true);
        });

      } else {
        console.warn(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_NO_SOCKET_IO:`, {
          userId,
          reason: 'socket_io_instance_not_available'
        });
      }
    } catch (socketError) {
      console.error(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_SOCKET_CLEANUP_ERROR:`, {
        userId,
        error: socketError.message,
        reason: 'socket_cleanup_failed'
      });
      // Continue with logout even if socket cleanup fails
    }

    // FIXED: Clean up Redis cache for user
    console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_REDIS_CLEANUP_START:`, {
      userId,
      reason: 'starting_redis_cache_cleanup'
    });

    try {
      const { cleanupUserCache } = require('./utils/redisClient');
      const cleanedCacheKeys = await cleanupUserCache(userId);
      
      console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_REDIS_CLEANUP_COMPLETE:`, {
        userId,
        cleanedCacheKeys,
        reason: 'redis_cache_cleanup_completed'
      });
    } catch (redisError) {
      console.error(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_REDIS_CLEANUP_ERROR:`, {
        userId,
        error: redisError.message,
        reason: 'redis_cache_cleanup_failed'
      });
      // Continue with logout even if Redis cleanup fails
    }

    console.log(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_SUCCESS:`, {
      userId,
      userEmail: existingUser.email,
      reason: 'logout_process_completed_successfully'
    });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error(`[LOGOUT-DEBUG][${timestamp}] LOGOUT_ERROR:`, {
      userId,
      error: error.message,
      stack: error.stack,
      reason: 'logout_process_failed'
    });
    
    // Still return success to client even if server cleanup fails
    res.json({ message: 'Logged out successfully' });
  }
});

// Middleware to verify access token
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('Received auth header:', authHeader ? 'Bearer [token]' : 'none');
  console.log('Request URL:', req.originalUrl);
  console.log('Request method:', req.method);
  console.log('All headers:', JSON.stringify(req.headers, null, 2));
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('Invalid auth header format');
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  console.log('Attempting to verify token...');
  console.log('Using JWT_SECRET:', JWT_SECRET ? 'Secret is set' : 'Secret is not set');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = decoded;
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    console.error('Token verification error details:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Group Chat endpoints
app.post('/api/groupchats', async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  
  console.log(`[Backend][CreateGroupChat][${requestId}] Request received:`, {
    method: req.method,
    url: req.url,
    body: req.body,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    },
    timestamp: new Date().toISOString()
  });

  try {
    const { name, createdBy, memberIds } = req.body;
    
    console.log(`[Backend][CreateGroupChat][${requestId}] Parsed request data:`, {
      name,
      createdBy,
      memberIds,
      hasMemberIds: !!memberIds,
      memberIdsType: Array.isArray(memberIds) ? 'array' : typeof memberIds,
      memberIdsLength: Array.isArray(memberIds) ? memberIds.length : 'N/A'
    });

    if (!name || !createdBy) {
      console.error(`[Backend][CreateGroupChat][${requestId}] Missing required fields:`, {
        hasName: !!name,
        hasCreatedBy: !!createdBy
      });
      return res.status(400).json({ error: 'Name and createdBy are required' });
    }

    const user = await usersCollection.findOne({ _id: new ObjectId(createdBy) });
    
    if (!user) {
      console.error(`[Backend][CreateGroupChat][${requestId}] User not found:`, createdBy);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`[Backend][CreateGroupChat][${requestId}] Creator user found:`, {
      userId: user._id.toString(),
      userName: user.name,
      userEmail: user.email
    });

    // Start with creator as the only member
    const initialMembers = [{
      userId: String(createdBy),
      name: user.name,
      joinedAt: new Date()
    }];

    console.log(`[Backend][CreateGroupChat][${requestId}] Initial members (creator only):`, {
      members: initialMembers.map(m => ({ userId: m.userId, name: m.name }))
    });

    const groupChat = {
      name,
      createdBy: new ObjectId(createdBy),
      members: initialMembers,
      createdAt: new Date(),
      lastMessageAt: new Date()
    };

    // Ensure no duplicate creator in members
    groupChat.members = groupChat.members.filter((member, idx, arr) =>
      arr.findIndex(m => String(m.userId) === String(member.userId)) === idx
    );

    console.log(`[Backend][CreateGroupChat][${requestId}] Creating group chat in database:`, {
      groupName: groupChat.name,
      creatorId: groupChat.createdBy.toString(),
      memberCount: groupChat.members.length,
      members: groupChat.members.map(m => ({ userId: m.userId, name: m.name }))
    });

    const result = await groupChatsCollection.insertOne(groupChat);
    
    console.log(`[Backend][CreateGroupChat][${requestId}] Group chat created successfully:`, {
      groupId: result.insertedId.toString(),
      groupName: groupChat.name,
      memberCount: groupChat.members.length
    });

    const endTime = Date.now();
    console.log(`[Backend][CreateGroupChat][${requestId}] Group chat creation completed:`, {
      duration: `${endTime - startTime}ms`,
      groupId: result.insertedId.toString()
    });

    res.json({ ...groupChat, _id: result.insertedId });
  } catch (error) {
    const endTime = Date.now();
    console.error(`[Backend][CreateGroupChat][${requestId}] Error creating group chat:`, {
      error: error.message,
      stack: error.stack,
      duration: `${endTime - startTime}ms`,
      body: req.body
    });
    res.status(500).json({ error: 'Failed to create group chat' });
  }
});

app.get('/api/groupchats', async (req, res) => {
  try {
    const { userId } = req.query;
    const startTime = Date.now();
    
    // Only log if debug mode is enabled
    if (process.env.DEBUG_GROUPCHATS === 'true') {
      console.log(`[groupchats] Fetching group chats for userId: ${userId}`);
    }
    
    // OPTIMIZATION: Use aggregation to get group chats with latest message in one query
    const groupChatsWithData = await groupChatsCollection.aggregate([
      // Match groups where user is a member
      { $match: { 'members.userId': String(userId) } },
      
      // Lookup latest message for each group
      {
        $lookup: {
          from: 'recordedMessages',
          let: { groupId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$groupChatId', '$$groupId'] } } },
            { $sort: { timestamp: -1 } },
            { $limit: 1 },
            { $project: { timestamp: 1, _id: 0 } }
          ],
          as: 'latestMessage'
        }
      },
      
      // Add computed fields
      {
        $addFields: {
          lastMessageAt: {
            $ifNull: [
              { $arrayElemAt: ['$latestMessage.timestamp', 0] },
              '$createdAt'
            ]
          }
        }
      },
      
      // Sort by last message timestamp
      { $sort: { lastMessageAt: -1 } }
    ]).toArray();

    const queryTime = Date.now() - startTime;
    
    // Only log if debug mode is enabled or if the query took too long
    if (process.env.DEBUG_GROUPCHATS === 'true' || queryTime > 1000) {
      console.log(`[groupchats] Found ${groupChatsWithData.length} group chats in ${queryTime}ms`);
    }

    // SYNC: Sync unread counts from database to Redis on first fetch
    // This ensures accurate counts when users first log in
    const { syncUnreadCountsFromDB } = require('./utils/redisClient');
    setImmediate(async () => {
      try {
        await syncUnreadCountsFromDB(userId, groupChatsWithData, recordedMessagesCollection);
      } catch (error) {
        console.warn('[groupchats] Failed to sync unread counts:', error.message);
      }
    });

    // OPTIMIZATION: Get unread counts in parallel with Redis fallback
    let totalUnreadChats = 0;
    const groupChatsWithUnread = await Promise.allSettled(
      groupChatsWithData.map(async (chat) => {
        try {
          // Try Redis first
          const unreadCount = await getUserUnreadCount(chat._id, userId);
          
          // If Redis returns 0 or fails, use database calculation as fallback
          // This ensures accurate counts on first login when Redis might not be synced
          if (unreadCount === 0) {
            // Use database calculation based on readBy field for more accurate results
            const query = {
              groupChatId: chat._id,
              senderId: { $ne: new ObjectId(userId) }, // Exclude user's own messages
              [`readBy.${userId}`]: { $exists: false } // Messages not read by this user
            };

            const dbUnreadCount = await recordedMessagesCollection.countDocuments(query);
            
            // Only log if there are unread messages AND debug mode is enabled
            if (dbUnreadCount > 0) {
              totalUnreadChats++;
              if (process.env.DEBUG_GROUPCHATS === 'true') {
                console.log(`[groupchats] Unread messages in ${chat.name}: ${dbUnreadCount} (from DB - Redis was 0)`);
              }
            }
            
            // Update Redis with the correct count if it differs
            if (dbUnreadCount > 0) {
              try {
                await redisClient.hset(`unread:${chat._id}`, userId, dbUnreadCount);
                if (process.env.DEBUG_GROUPCHATS === 'true') {
                  console.log(`[groupchats] Updated Redis unread count for ${chat.name}: ${dbUnreadCount}`);
                }
              } catch (redisError) {
                console.warn(`[groupchats] Failed to update Redis for ${chat.name}:`, redisError.message);
              }
            }
            
            return { 
              ...chat, 
              unreadCount: dbUnreadCount,
              lastMessageAt: chat.lastMessageAt
            };
          }
          
          // Only log if there are unread messages AND debug mode is enabled
          if (unreadCount > 0) {
            totalUnreadChats++;
            if (process.env.DEBUG_GROUPCHATS === 'true') {
              console.log(`[groupchats] Unread messages in ${chat.name}: ${unreadCount} (from Redis)`);
            }
          }
          
          return { 
            ...chat, 
            unreadCount,
            lastMessageAt: chat.lastMessageAt
          };
        } catch (error) {
          console.warn(`[groupchats] Redis failed for chat ${chat._id}, using DB fallback:`, error.message);
          
          // Fallback to database calculation if Redis fails
          const query = {
            groupChatId: chat._id,
            senderId: { $ne: new ObjectId(userId) }, // Exclude user's own messages
            [`readBy.${userId}`]: { $exists: false } // Messages not read by this user
          };

          const unreadCount = await recordedMessagesCollection.countDocuments(query);
          
          // Only log if there are unread messages AND debug mode is enabled
          if (unreadCount > 0) {
            totalUnreadChats++;
            if (process.env.DEBUG_GROUPCHATS === 'true') {
              console.log(`[groupchats] Unread messages in ${chat.name}: ${unreadCount} (fallback from DB)`);
            }
          }
          
          return { 
            ...chat, 
            unreadCount,
            lastMessageAt: chat.lastMessageAt
          };
        }
      })
    );

    // Process results and handle any failures
    const processedGroupChats = groupChatsWithUnread.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`[groupchats] Failed to get unread count for chat ${groupChatsWithData[index]._id}:`, result.reason);
        // Return chat with 0 unread count as fallback
        return {
          ...groupChatsWithData[index],
          unreadCount: 0,
          lastMessageAt: groupChatsWithData[index].lastMessageAt
        };
      }
    });

    const totalTime = Date.now() - startTime;
    
    // Only log if debug mode is enabled or the request took too long
    if (process.env.DEBUG_GROUPCHATS === 'true' || totalTime > 1000) {
      console.log(`[groupchats] Returning ${processedGroupChats.length} group chats in ${totalTime}ms (${totalUnreadChats} with unread messages)`);
    }

    res.json(processedGroupChats);
  } catch (error) {
    console.error('Error fetching group chats:', error);
    res.status(500).json({ error: 'Failed to fetch group chats' });
  }
});

// User search endpoint - NEW
app.get('/api/users', async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  
  console.log(`[Backend][UserSearch][${requestId}] Request received:`, {
    method: req.method,
    url: req.url,
    query: req.query,
    headers: {
      'user-agent': req.headers['user-agent']
    },
    timestamp: new Date().toISOString()
  });

  try {
    const { name } = req.query;
    
    let query = {};
    if (name && name.trim().length > 0) {
      query = { 
        name: { 
          $regex: name.trim(), 
          $options: 'i' 
        } 
      };
    }

    console.log(`[Backend][UserSearch][${requestId}] Database query:`, {
      query,
      searchTerm: name || 'all users',
      hasSearchTerm: !!name
    });
    
    // Search for users (all users if no name provided)
    const users = await usersCollection
      .find(query)
      .limit(20) // Limit results to prevent large responses
      .toArray();

    console.log(`[Backend][UserSearch][${requestId}] Database query result:`, {
      foundUsers: users.length,
      users: users.map(u => ({ _id: u._id.toString(), name: u.name, email: u.email }))
    });

    // Return user data without sensitive information
    const sanitizedUsers = users.map(user => ({
      _id: user._id,
      name: user.name,
      email: user.email.substring(0, 3) + '***', // Partially hide email for privacy
    }));

    console.log(`[Backend][UserSearch][${requestId}] Sending response:`, {
      sanitizedCount: sanitizedUsers.length,
      sanitizedUsers: sanitizedUsers.map(u => ({ _id: u._id.toString(), name: u.name, email: u.email }))
    });

    const endTime = Date.now();
    console.log(`[Backend][UserSearch][${requestId}] User search completed successfully:`, {
      duration: `${endTime - startTime}ms`,
      searchTerm: name || 'all users',
      resultCount: sanitizedUsers.length
    });

    res.json(sanitizedUsers);
  } catch (error) {
    const endTime = Date.now();
    console.error(`[Backend][UserSearch][${requestId}] Error in user search:`, {
      error: error.message,
      stack: error.stack,
      duration: `${endTime - startTime}ms`,
      query: req.query
    });
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Create new voice message (consolidated endpoint)
app.post('/api/messages', async (req, res) => {
  const startTime = Date.now();
  const { groupChatId, audioUrl, mediaUrl, duration, senderId, type, clientTempId } = req.body;
  
  try {
    // PHASE 3: Performance tracking
    const performanceMetrics = require('./utils/performanceMetrics').performanceMetrics;
    
    // Create the message object
    const message = {
      groupChatId: new ObjectId(groupChatId),
      audioUrl,
      mediaUrl,
      duration,
      senderId: new ObjectId(senderId),
      type,
      timestamp: new Date(),
      processingStatus: 'pending',
      clientTempId,
      isRead: false,
      isDelivered: true,
      readBy: { [senderId]: new Date() }, // Mark as read by sender immediately
      deliveredTo: [senderId] // Mark as delivered to sender
    };

    // Save to database
    const result = await recordedMessagesCollection.insertOne(message);
    const savedMessage = {
      ...message,
      _id: result.insertedId,
      groupChatId: groupChatId,
      senderId: senderId
    };

    // PHASE 3: Cache the new message for instant access
    setImmediate(async () => {
      try {
        const { advancedCacheService } = require('./utils/advancedCacheService');
        await advancedCacheService.cacheMessage(result.insertedId.toString(), savedMessage);
      } catch (error) {
        console.warn('[API][messages] Error caching message:', error);
      }
    });

    // Get the group to notify all members and handle unread counts
    const group = await groupChatsCollection.findOne({ _id: new ObjectId(groupChatId) });
    if (!group) {
      console.error('[API][messages] Group not found:', groupChatId);
      return res.status(404).json({ error: 'Group not found' });
    }

    // Get all members except the sender
    const receivers = group.members.filter(member => String(member.userId) !== String(senderId));
    console.log('[API][messages] Updating unread counts for receivers:', receivers.map(r => String(r.userId)));

    // OPTIMIZATION: Make unread count updates non-blocking for faster response
    const unreadCountPromise = Promise.allSettled(receivers.map(async receiver => {
      try {
        const newCount = await incrementUserUnreadCount(groupChatId, String(receiver.userId));
        
        // Emit unread count update to the specific receiver
        const io = require('./socket').getIO();
        if (io) {
          io.to(String(receiver.userId)).emit('unread_count_update', {
            chatId: groupChatId,
            userId: String(receiver.userId),
            unreadCount: newCount
          });
          console.log(`[API][messages] Emitted unread count update to ${String(receiver.userId)}:`, newCount);
        }
      } catch (error) {
        console.error(`[API][messages] Error updating unread count for ${String(receiver.userId)}:`, error);
      }
    }));

    // OPTIMIZATION: Emit socket events immediately without waiting for unread counts
    const io = require('./socket').getIO();
    if (io) {
      // Create the broadcast message object
      const broadcastMessage = {
        ...savedMessage,
        isRead: false,
        isDelivered: true,
        readBy: { [senderId]: new Date() },
        deliveredTo: group.members.map(m => String(m.userId))
      };

      // OPTIMIZATION: Emit to group room only for faster delivery
      io.to(groupChatId).emit('new_message', broadcastMessage);

      console.log('[API][messages] Broadcasting message to group:', groupChatId, {
        messageId: broadcastMessage._id,
        senderId: broadcastMessage.senderId,
        memberCount: group.members.length
      });

      // PHASE 2: Message acknowledgment tracking
      setImmediate(async () => {
        try {
          // Track message delivery status for all recipients
          const deliveryTracking = {
            messageId: broadcastMessage._id,
            groupChatId,
            senderId,
            recipients: group.members.map(m => String(m.userId)),
            sentAt: new Date(),
            deliveredTo: { [senderId]: new Date() }, // Sender is automatically delivered
            acknowledgedBy: { [senderId]: new Date() } // Sender is automatically acknowledged
          };

          // Store delivery tracking in database for monitoring
          await recordedMessagesCollection.updateOne(
            { _id: result.insertedId },
            { 
              $set: { 
                deliveryTracking,
                requiresAcknowledgment: true
              }
            }
          );

          console.log('[API][messages] Message acknowledgment tracking initialized:', {
            messageId: broadcastMessage._id,
            recipientCount: group.members.length
          });
        } catch (error) {
          console.warn('[API][messages] Error initializing acknowledgment tracking:', error);
        }
      });
    }

    // OPTIMIZATION: Move cache invalidation to background for faster response
    setImmediate(async () => {
      try {
        await Promise.all([
          invalidateCache(`groupChat:${groupChatId}:*`),
          invalidateCache(`user:${senderId}:messages:*`),
          voiceMessageCache.invalidateGroupChat(groupChatId),
          voiceMessageCache.invalidateMessageCache(groupChatId)
        ]);
        console.log('[API][messages] Background cache invalidation completed');
      } catch (error) {
        console.warn('[API][messages] Background cache invalidation error:', error);
      }
    });

    // OPTIMIZATION: Wait for unread count updates in background
    unreadCountPromise.then(() => {
      console.log('[API][messages] Background unread count updates completed');
    }).catch(error => {
      console.warn('[API][messages] Background unread count updates error:', error);
    });

    res.status(201).json(savedMessage);
    
    // PHASE 3: Track successful message send
    performanceMetrics.trackMessageSend('/api/messages', type || 'text', startTime, true);
    
  } catch (error) {
    console.error('Error saving message:', error);
    
    // PHASE 3: Track failed message send
    const performanceMetrics = require('./utils/performanceMetrics').performanceMetrics;
    performanceMetrics.trackMessageSend('/api/messages', type || 'text', startTime, false, error);
    
    res.status(500).json({ 
      error: 'Failed to save message',
      details: error.message
    });
  }
});

// Get group chat messages with proper caching and error handling
app.get('/api/messages/:groupChatId', async (req, res) => {
  try {
    const { groupChatId } = req.params;
    const { page = 1, limit = 20, userId } = req.query;

    // Only log if debug mode is enabled
    if (process.env.DEBUG_MESSAGES === 'true') {
      console.log('[API][messages] Fetching messages:', {
        groupChatId,
        page,
        limit,
        userId
      });
    }

    // Try to get from cache first (only for first page)
    const cacheKey = `messages:${groupChatId}:${page}:${limit}:${userId}`;
    if (page == 1 && redisClient.status === 'ready') {
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          console.log('[API][messages] Returning cached data for:', cacheKey);
          return res.json(JSON.parse(cachedData));
        }
      } catch (cacheError) {
        console.warn('[API][messages] Cache error, proceeding with DB query:', cacheError.message);
      }
    }

    // Validate groupChatId format before converting to ObjectId
    if (!ObjectId.isValid(groupChatId)) {
      console.error('[API][messages] Invalid groupChatId format:', groupChatId);
      return res.status(400).json({ error: 'Invalid group chat ID format' });
    }

    // Convert groupChatId to ObjectId
    const groupId = new ObjectId(groupChatId);

    // Get messages with proper sorting and pagination
    const messages = await recordedMessagesCollection
      .find({ groupChatId: groupId })
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .toArray();
    
    // Only log if debug mode is enabled
    if (process.env.DEBUG_MESSAGES === 'true') {
      console.log('[API][messages] Raw messages retrieved from DB:', {
        groupChatId,
        count: messages.length,
        messageIds: messages.map(msg => msg._id.toString()).slice(0, 5) // Log first 5 for debugging
      });
    }
    
    // Process messages with read status in a single pass
    const messagesWithStatus = messages.map(message => {
      const isReadByUser = userId && message.readBy && message.readBy[userId];
      const computedIsRead = message.senderId.toString() === userId ? true : (isReadByUser ? true : false);
      
      return {
        ...message,
        _id: message._id.toString(),
        senderId: message.senderId.toString(),
        groupChatId: message.groupChatId.toString(),
        type: message.type || (message.audioUrl ? 'voice' : 'text'),  // Preserve original type, fallback to voice/text
        isRead: computedIsRead,
        isDelivered: message.isDelivered !== undefined ? message.isDelivered : true,
        readBy: message.readBy || {},
        timestamp: message.timestamp || new Date(),
        content: message.content !== undefined ? message.content : (message.text !== undefined ? message.text : ''),
      };
    });
    
    // Only log if debug mode is enabled
    if (process.env.DEBUG_MESSAGES === 'true') {
      console.log('[API][messages] Messages processed and ready to send:', {
        groupChatId,
        count: messagesWithStatus.length,
        page,
        limit,
        userId
      });
    }

    // Cache the result for 5 minutes (only for first page)
    if (page == 1 && redisClient.status === 'ready') {
      try {
        await redisClient.setex(cacheKey, 300, JSON.stringify(messagesWithStatus));
      } catch (cacheError) {
        console.warn('[API][messages] Error caching result:', cacheError.message);
      }
    }

    res.json(messagesWithStatus);
  } catch (error) {
    console.error('[API][messages] Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Add endpoint to update message with transcription
app.put('/api/messages/:messageId/transcription', async (req, res) => {
  const { messageId } = req.params;
  const { transcription, processingStatus } = req.body;

  try {
    // Validate messageId format before converting to ObjectId
    if (!ObjectId.isValid(messageId)) {
      console.error('[API][transcription] Invalid messageId format:', messageId);
      return res.status(400).json({ error: 'Invalid message ID format' });
    }

    const result = await recordedMessagesCollection.updateOne(
      { _id: new ObjectId(messageId) },
      { $set: { transcription, processingStatus } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Invalidate transcription cache
    await invalidateCache(`voiceText:${messageId}`);

    // Get the message to find the groupChatId for socket emission
    const message = await recordedMessagesCollection.findOne({ _id: new ObjectId(messageId) });
    if (message && message.groupChatId) {
      // Emit socket event for real-time transcription updates
      const io = getIO();
      if (io) {
        io.to(message.groupChatId.toString()).emit('transcription:ready', {
          messageId,
          transcription
        });
        console.log('[Transcription] Socket event emitted for message:', messageId);
      }
    }

    res.json({ message: 'Transcription updated successfully' });
  } catch (error) {
    console.error('Error updating transcription:', error);
    res.status(500).json({ error: 'Failed to update transcription' });
  }
});

// Add member to group chat - UPDATED
app.post('/api/groupchats/:groupId/members', async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  
  console.log(`[Backend][AddMember][${requestId}] Request received:`, {
    method: req.method,
    url: req.url,
    params: req.params,
    body: req.body,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    },
    timestamp: new Date().toISOString()
  });

  try {
    const { groupId } = req.params;
    const { email, username, memberIds } = req.body; // Accept email, username, or memberIds

    console.log(`[Backend][AddMember][${requestId}] Parsed request data:`, { 
      groupId, 
      email, 
      username, 
      memberIds,
      hasEmail: !!email,
      hasUsername: !!username,
      hasMemberIds: !!memberIds
    });

    // Validate required parameters
    if (!groupId) {
      console.error(`[Backend][AddMember][${requestId}] Missing groupId`);
      return res.status(400).json({ error: 'Missing group ID' });
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(groupId)) {
      console.error(`[Backend][AddMember][${requestId}] Invalid groupId format:`, groupId);
      return res.status(400).json({ error: 'Invalid group ID format' });
    }

    // Find the user by email, username, or memberIds
    let user = null;
    let userIdToAdd = null;

    if (memberIds && Array.isArray(memberIds) && memberIds.length > 0) {
      // Handle memberIds array (new format)
      userIdToAdd = memberIds[0]; // For now, just take the first one
      console.log(`[Backend][AddMember][${requestId}] Using memberIds format, userId:`, userIdToAdd);
      
      if (!ObjectId.isValid(userIdToAdd)) {
        console.error(`[Backend][AddMember][${requestId}] Invalid userId format in memberIds:`, userIdToAdd);
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      
      user = await usersCollection.findOne({ _id: new ObjectId(userIdToAdd) });
    } else if (email) {
      console.log(`[Backend][AddMember][${requestId}] Looking up user by email:`, email);
      user = await usersCollection.findOne({ email });
    } else if (username) {
      console.log(`[Backend][AddMember][${requestId}] Looking up user by username:`, username);
      user = await usersCollection.findOne({ name: username });
    }
    
    if (!user) {
      console.error(`[Backend][AddMember][${requestId}] User not found:`, {
        email,
        username,
        memberIds,
        userIdToAdd
      });
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`[Backend][AddMember][${requestId}] User found:`, {
      userId: user._id.toString(),
      name: user.name,
      email: user.email
    });

    // Clean up any lingering data from previous membership
    console.log(`[Backend][AddMember][${requestId}] Cleaning up any stale data for user...`);
    try {
      // Clean up any old message read status entries for this user/group combo
      await messageReadStatusCollection.deleteMany({
        userId: new ObjectId(user._id),
        groupChatId: new ObjectId(groupId)
      });
      console.log(`[Backend][AddMember][${requestId}] Cleaned up old message read status entries`);
    } catch (cleanupError) {
      console.warn(`[Backend][AddMember][${requestId}] Error during cleanup (non-critical):`, cleanupError.message);
    }

    // Check if user is already a member (check both string and ObjectId)
    console.log(`[Backend][AddMember][${requestId}] Looking up group:`, groupId);
    const group = await groupChatsCollection.findOne({ _id: new ObjectId(groupId) });
    if (!group) {
      console.error(`[Backend][AddMember][${requestId}] Group chat not found:`, groupId);
      return res.status(404).json({ error: 'Group chat not found' });
    }

    console.log(`[Backend][AddMember][${requestId}] Group found:`, {
      groupId: group._id.toString(),
      groupName: group.name,
      memberCount: group.members.length,
      members: group.members.map(m => ({ userId: m.userId, name: m.name }))
    });

    const userIdStr = String(user._id);
    const alreadyMember = group.members.some(m => String(m.userId) === userIdStr);
    
    console.log(`[Backend][AddMember][${requestId}] Membership check:`, {
      userIdStr,
      alreadyMember,
      existingMemberIds: group.members.map(m => String(m.userId)),
      checkingUserId: userIdStr,
      exactMatches: group.members.filter(m => String(m.userId) === userIdStr)
    });

    if (alreadyMember) {
      console.log(`[Backend][AddMember][${requestId}] User is already a member - returning success:`, {
        userId: userIdStr,
        userName: user.name,
        groupName: group.name
      });
      // Return success instead of error to allow re-adding (idempotent operation)
      return res.json({ 
        message: 'User is already a member of this group',
        userId: userIdStr,
        userName: user.name,
        groupId: groupId,
        alreadyMember: true
      });
    }

    // Add the member - use $addToSet to ensure no duplicates
    console.log(`[Backend][AddMember][${requestId}] Adding member to group...`);
    const memberToAdd = {
      userId: String(user._id), // Ensure it's always a string
      name: user.name,
      joinedAt: new Date()
    };
    
    console.log(`[Backend][AddMember][${requestId}] Member object to add:`, memberToAdd);
    
    const addResult = await groupChatsCollection.updateOne(
      { _id: new ObjectId(groupId) },
      {
        $addToSet: {
          members: memberToAdd
        }
      }
    );

    console.log(`[Backend][AddMember][${requestId}] Add operation result:`, {
      matchedCount: addResult.matchedCount,
      modifiedCount: addResult.modifiedCount,
      upsertedCount: addResult.upsertedCount
    });

    // Safety check: Ensure all members have string userIds
    console.log(`[Backend][AddMember][${requestId}] Running safety check...`);
    const safetyCheckGroup = await groupChatsCollection.findOne({ _id: new ObjectId(groupId) });
    if (safetyCheckGroup) {
      let needsSafetyUpdate = false;
      const safetyUpdatedMembers = safetyCheckGroup.members.map(member => {
        if (typeof member.userId !== 'string') {
          needsSafetyUpdate = true;
          console.warn(`[Backend][AddMember][${requestId}] Found ObjectID in member, converting to string:`, {
            groupId: groupId,
            memberName: member.name,
            oldUserId: member.userId,
            newUserId: String(member.userId)
          });
          return { ...member, userId: String(member.userId) };
        }
        return member;
      });
      
      if (needsSafetyUpdate) {
        console.log(`[Backend][AddMember][${requestId}] Applying safety update...`);
        await groupChatsCollection.updateOne(
          { _id: new ObjectId(groupId) },
          { $set: { members: safetyUpdatedMembers } }
        );
        console.log(`[Backend][AddMember][${requestId}] Safety update completed`);
      }
    }

    // Deduplicate members array by userId
    console.log(`[Backend][AddMember][${requestId}] Checking for duplicates...`);
    const updatedGroup = await groupChatsCollection.findOne({ _id: new ObjectId(groupId) });
    if (updatedGroup) {
      const dedupedMembers = updatedGroup.members.filter((member, idx, arr) =>
        arr.findIndex(m => String(m.userId) === String(member.userId)) === idx
      );
      if (dedupedMembers.length !== updatedGroup.members.length) {
        console.log(`[Backend][AddMember][${requestId}] Removing duplicates:`, {
          before: updatedGroup.members.length,
          after: dedupedMembers.length
        });
        await groupChatsCollection.updateOne(
          { _id: new ObjectId(groupId) },
          { $set: { members: dedupedMembers } }
        );
      }
    }

    // Emit socket event for live updates
    console.log(`[Backend][AddMember][${requestId}] Emitting socket events...`);
    const io = require('./socket').getIO();
    if (io) {
      // Emit to all existing members of the group
      updatedGroup.members.forEach(member => {
        io.to(String(member.userId)).emit('group_member_added', {
          groupId: groupId,
          newMember: {
            userId: String(user._id),
            name: user.name,
            joinedAt: new Date()
          }
        });
      });
      
      // Also emit to the new member
      io.to(String(user._id)).emit('group_member_added', {
        groupId: groupId,
        newMember: {
          userId: String(user._id),
          name: user.name,
          joinedAt: new Date()
        }
      });
      
      console.log(`[Backend][AddMember][${requestId}] Socket events emitted to ${updatedGroup.members.length + 1} users`);
    }

    const endTime = Date.now();
    console.log(`[Backend][AddMember][${requestId}] Member addition completed successfully:`, {
      duration: `${endTime - startTime}ms`,
      groupId,
      addedUserId: String(user._id),
      addedUserName: user.name,
      finalMemberCount: updatedGroup.members.length
    });

    res.json({ message: 'Member added successfully' });
  } catch (error) {
    const endTime = Date.now();
    console.error(`[Backend][AddMember][${requestId}] Error in member addition process:`, {
      error: error.message,
      stack: error.stack,
      duration: `${endTime - startTime}ms`,
      params: req.params,
      body: req.body
    });
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// OPTIMIZED: Batch add multiple members to group chat - NEW FAST ENDPOINT
app.post('/api/groupchats/:groupId/members/batch', async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  
  console.log(`[Backend][BatchAddMembers][${requestId}] ⚡ FAST batch request received:`, {
    method: req.method,
    url: req.url,
    params: req.params,
    body: req.body,
    timestamp: new Date().toISOString()
  });

  try {
    const { groupId } = req.params;
    const { memberIds } = req.body; // Array of user IDs to add

    console.log(`[Backend][BatchAddMembers][${requestId}] Parsed batch request:`, { 
      groupId, 
      memberIds,
      memberCount: Array.isArray(memberIds) ? memberIds.length : 0
    });

    // Validate required parameters
    if (!groupId) {
      console.error(`[Backend][BatchAddMembers][${requestId}] Missing groupId`);
      return res.status(400).json({ error: 'Missing group ID' });
    }

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      console.error(`[Backend][BatchAddMembers][${requestId}] Invalid memberIds:`, memberIds);
      return res.status(400).json({ error: 'memberIds must be a non-empty array' });
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(groupId)) {
      console.error(`[Backend][BatchAddMembers][${requestId}] Invalid groupId format:`, groupId);
      return res.status(400).json({ error: 'Invalid group ID format' });
    }

    // Validate all member IDs
    const invalidIds = memberIds.filter(id => !ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      console.error(`[Backend][BatchAddMembers][${requestId}] Invalid member IDs:`, invalidIds);
      return res.status(400).json({ error: 'Invalid user ID format in memberIds' });
    }

    console.log(`[Backend][BatchAddMembers][${requestId}] ⚡ Bulk lookup - finding all users...`);
    
    // OPTIMIZATION: Bulk find all users in a single query
    const users = await usersCollection.find({ 
      _id: { $in: memberIds.map(id => new ObjectId(id)) } 
    }).toArray();

    console.log(`[Backend][BatchAddMembers][${requestId}] ⚡ Found ${users.length}/${memberIds.length} users`);

    if (users.length === 0) {
      console.error(`[Backend][BatchAddMembers][${requestId}] No valid users found`);
      return res.status(404).json({ error: 'No valid users found' });
    }

    // OPTIMIZATION: Single query to get group
    console.log(`[Backend][BatchAddMembers][${requestId}] ⚡ Looking up group...`);
    const group = await groupChatsCollection.findOne({ _id: new ObjectId(groupId) });
    if (!group) {
      console.error(`[Backend][BatchAddMembers][${requestId}] Group chat not found:`, groupId);
      return res.status(404).json({ error: 'Group chat not found' });
    }

    console.log(`[Backend][BatchAddMembers][${requestId}] Group found:`, {
      groupId: group._id.toString(),
      groupName: group.name,
      currentMemberCount: group.members.length
    });

    // OPTIMIZATION: Filter out existing members and prepare new members in memory
    const existingMemberIds = new Set(group.members.map(m => String(m.userId)));
    const newMembers = users
      .filter(user => !existingMemberIds.has(String(user._id)))
      .map(user => ({
        userId: String(user._id),
        name: user.name,
        joinedAt: new Date()
      }));

    console.log(`[Backend][BatchAddMembers][${requestId}] ⚡ Prepared batch operation:`, {
      totalUsers: users.length,
      existingMembers: users.length - newMembers.length,
      newMembersToAdd: newMembers.length,
      newMemberNames: newMembers.map(m => m.name)
    });

    if (newMembers.length === 0) {
      console.log(`[Backend][BatchAddMembers][${requestId}] All users are already members - returning success`);
      return res.json({ 
        message: 'All users are already members',
        addedCount: 0,
        skippedCount: users.length,
        finalMemberCount: group.members.length,
        allUsersAlreadyMembers: true
      });
    }

    // OPTIMIZATION: Single atomic bulk operation to add all members
    console.log(`[Backend][BatchAddMembers][${requestId}] ⚡ Executing bulk add operation...`);
    const bulkAddResult = await groupChatsCollection.updateOne(
      { _id: new ObjectId(groupId) },
      {
        $addToSet: {
          members: { $each: newMembers }
        }
      }
    );

    console.log(`[Backend][BatchAddMembers][${requestId}] ⚡ Bulk add completed:`, {
      matchedCount: bulkAddResult.matchedCount,
      modifiedCount: bulkAddResult.modifiedCount,
      addedMembers: newMembers.length
    });

    // OPTIMIZATION: Single query to get final group state
    const finalGroup = await groupChatsCollection.findOne({ _id: new ObjectId(groupId) });

    // OPTIMIZATION: Batch emit socket events
    console.log(`[Backend][BatchAddMembers][${requestId}] ⚡ Emitting batch socket events...`);
    const io = require('./socket').getIO();
    if (io && finalGroup) {
      // Emit single event to all existing members about all new members
      finalGroup.members.forEach(member => {
        io.to(String(member.userId)).emit('group_members_batch_added', {
          groupId: groupId,
          newMembers: newMembers,
          totalMembers: finalGroup.members.length
        });
      });
      
      console.log(`[Backend][BatchAddMembers][${requestId}] ⚡ Batch socket events emitted to ${finalGroup.members.length} users`);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`[Backend][BatchAddMembers][${requestId}] ⚡ FAST batch addition completed:`, {
      duration: `${duration}ms`,
      averagePerMember: `${Math.round(duration / newMembers.length)}ms`,
      groupId,
      addedMembers: newMembers.length,
      finalMemberCount: finalGroup?.members.length || 'unknown',
      performance: duration < 500 ? 'EXCELLENT' : duration < 1000 ? 'GOOD' : 'NEEDS_OPTIMIZATION'
    });

    res.json({ 
      message: 'Members added successfully',
      addedCount: newMembers.length,
      addedMembers: newMembers.map(m => ({ userId: m.userId, name: m.name })),
      finalMemberCount: finalGroup?.members.length || group.members.length + newMembers.length
    });

  } catch (error) {
    const endTime = Date.now();
    console.error(`[Backend][BatchAddMembers][${requestId}] ❌ Error in batch member addition:`, {
      error: error.message,
      stack: error.stack,
      duration: `${endTime - startTime}ms`,
      params: req.params,
      body: req.body
    });
    res.status(500).json({ error: 'Failed to add members in batch' });
  }
});

// Remove member from group chat - NEW
app.delete('/api/groupchats/:groupId/members/:userId', async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  
  console.log(`[Backend][RemoveMember][${requestId}] Request received:`, {
    method: req.method,
    url: req.url,
    params: req.params,
    body: req.body,
    headers: {
      'content-type': req.headers['content-type'],
      'authorization': req.headers.authorization ? 'Bearer [REDACTED]' : 'None',
      'user-agent': req.headers['user-agent']
    },
    timestamp: new Date().toISOString()
  });

  try {
    const { groupId, userId } = req.params;
    const { requesterId } = req.body; // ID of the user making the request

    console.log(`[Backend][RemoveMember][${requestId}] Parsed request data:`, { 
      groupId, 
      userId, 
      requesterId,
      hasRequesterId: !!requesterId 
    });

    // Validate required parameters
    if (!groupId || !userId || !requesterId) {
      console.error(`[Backend][RemoveMember][${requestId}] Missing required parameters:`, {
        hasGroupId: !!groupId,
        hasUserId: !!userId,
        hasRequesterId: !!requesterId
      });
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(groupId)) {
      console.error(`[Backend][RemoveMember][${requestId}] Invalid groupId format:`, groupId);
      return res.status(400).json({ error: 'Invalid group ID format' });
    }

    if (!ObjectId.isValid(userId)) {
      console.error(`[Backend][RemoveMember][${requestId}] Invalid userId format:`, userId);
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    if (!ObjectId.isValid(requesterId)) {
      console.error(`[Backend][RemoveMember][${requestId}] Invalid requesterId format:`, requesterId);
      return res.status(400).json({ error: 'Invalid requester ID format' });
    }

    console.log(`[Backend][RemoveMember][${requestId}] Looking up group in database:`, groupId);

    // Validate that the group exists and get group info
    const group = await groupChatsCollection.findOne({ _id: new ObjectId(groupId) });
    if (!group) {
      console.error(`[Backend][RemoveMember][${requestId}] Group not found:`, groupId);
      return res.status(404).json({ error: 'Group chat not found' });
    }

    console.log(`[Backend][RemoveMember][${requestId}] Group found:`, {
      groupId: group._id.toString(),
      groupName: group.name,
      createdBy: group.createdBy.toString(),
      memberCount: group.members.length,
      members: group.members.map(m => ({ userId: m.userId, name: m.name }))
    });

    console.log(`[Backend][RemoveMember][${requestId}] Type validation:`, {
      userId: typeof userId, 
      valueUserId: userId,
      requesterId: typeof requesterId, 
      valueRequesterId: requesterId,
      createdBy: typeof group.createdBy, 
      valueCreatedBy: group.createdBy.toString()
    });

    // Allow any user to remove themselves, but only the creator can remove others
    const isSelfRemoval = requesterId === userId;
    const isCreator = group.createdBy.toString() === requesterId;
    const canRemove = isSelfRemoval || isCreator;

    console.log(`[Backend][RemoveMember][${requestId}] Permission check:`, {
      isSelfRemoval,
      isCreator,
      canRemove,
      requesterId,
      userId,
      groupCreator: group.createdBy.toString()
    });

    if (!canRemove) {
      console.error(`[Backend][RemoveMember][${requestId}] Permission denied:`, {
        requesterId,
        userId,
        groupCreator: group.createdBy.toString()
      });
      return res.status(403).json({ error: 'Only the group creator can remove other members' });
    }

    // Prevent removing the group creator
    if (group.createdBy.toString() === userId) {
      console.error(`[Backend][RemoveMember][${requestId}] Attempted to remove group creator:`, {
        userId,
        groupCreator: group.createdBy.toString()
      });
      return res.status(400).json({ error: 'Cannot remove the group creator' });
    }

    // Check if the user is actually a member of the group
    const memberExists = group.members.some(member => String(member.userId) === String(userId));
    console.log(`[Backend][RemoveMember][${requestId}] Member existence check:`, {
      userId,
      memberExists,
      groupMemberIds: group.members.map(m => m.userId)
    });

    if (!memberExists) {
      console.error(`[Backend][RemoveMember][${requestId}] User is not a member of the group:`, {
        userId,
        groupMemberIds: group.members.map(m => m.userId)
      });
      return res.status(404).json({ error: 'User is not a member of this group' });
    }

    console.log(`[Backend][RemoveMember][${requestId}] Removing member from database:`, {
      groupId,
      userId,
      memberToRemove: group.members.find(m => String(m.userId) === String(userId))
    });

    // Remove the member from the group
    const result = await groupChatsCollection.updateOne(
      { _id: new ObjectId(groupId) },
      {
        $pull: {
          members: { userId: String(userId) }
        }
      }
    );

    console.log(`[Backend][RemoveMember][${requestId}] Database update result:`, {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount
    });

    if (result.modifiedCount === 0) {
      console.error(`[Backend][RemoveMember][${requestId}] Database update failed - no documents modified`);
      return res.status(500).json({ error: 'Failed to remove member' });
    }

    // Emit socket event for live updates
    console.log(`[Backend][RemoveMember][${requestId}] Emitting socket events`);
    const io = require('./socket').getIO();
    if (io) {
      // Emit to remaining members of the group
      const remainingMembers = group.members.filter(member => String(member.userId) !== String(userId));
      console.log(`[Backend][RemoveMember][${requestId}] Emitting to remaining members:`, {
        remainingCount: remainingMembers.length,
        remainingMemberIds: remainingMembers.map(m => m.userId)
      });
      
      remainingMembers.forEach(member => {
        io.to(String(member.userId)).emit('group_member_removed', {
          groupId: groupId,
          removedUserId: String(userId)
        });
      });
      
      // Also emit to the removed member
      console.log(`[Backend][RemoveMember][${requestId}] Emitting to removed member:`, userId);
      io.to(String(userId)).emit('group_member_removed', {
        groupId: groupId,
        removedUserId: String(userId)
      });
    } else {
      console.warn(`[Backend][RemoveMember][${requestId}] Socket.io not available`);
    }

    // Clean up related data for the removed user
    console.log(`[Backend][RemoveMember][${requestId}] Cleaning up related data`);
    await Promise.all([
      // Remove message read status for this user in this group
      messageReadStatusCollection.deleteMany({
        userId: new ObjectId(userId),
        groupChatId: new ObjectId(groupId)
      }),
      // Note: We're leaving messages intact as they're part of the chat history
    ]);

    // Clean up recording queue and recording state for the removed user
    try {
      const { getIO, recordingStates, recordingQueues, pendingRecordingGrants } = require('./socket');
      const io = getIO();
      if (io) {
        // Clean up recording state
        if (recordingStates && recordingStates.has(groupId)) {
          const users = recordingStates.get(groupId);
          if (users.has(String(userId))) {
            users.delete(String(userId));
            console.log(`[Backend][RemoveMember][${requestId}] Removed user from recording state:`, {
              userId: String(userId),
              groupId: groupId
            });
            
            // Clean up empty recording state or notify remaining users
            if (users.size === 0) {
              recordingStates.delete(groupId);
              console.log(`[Backend][RemoveMember][${requestId}] Cleaned up empty recording state for group:`, groupId);
            } else {
              // Notify remaining users about the recording state change
              io.to(groupId).emit('recording_state_update', {
                groupId,
                recordingUsers: Array.from(users),
                isAnyoneRecording: users.size > 0,
                removedUser: String(userId)
              });
              console.log(`[Backend][RemoveMember][${requestId}] Notified remaining users of recording state change:`, {
                groupId,
                remainingUsers: Array.from(users)
              });
            }
          }
        }

        // Clean up recording queue and transfer recording if needed
        if (recordingQueues && recordingQueues.has(groupId)) {
          const queue = recordingQueues.get(groupId);
          const userIndex = queue.findIndex(user => user.userId === String(userId));
          if (userIndex !== -1) {
            queue.splice(userIndex, 1);
            console.log(`[Backend][RemoveMember][${requestId}] Removed user from recording queue:`, {
              userId: String(userId),
              groupId: groupId
            });

            // Update positions for remaining users
            queue.forEach((user, index) => {
              user.position = index + 1;
            });

            // If user was currently recording, transfer to next in queue
            if (recordingStates && recordingStates.has(groupId)) {
              const recordingUsers = recordingStates.get(groupId);
              if (recordingUsers && recordingUsers.has(String(userId))) {
                // User was recording, remove them and transfer to next in queue
                recordingUsers.delete(String(userId));
                console.log(`[Backend][RemoveMember][${requestId}] User was recording, transferring to next in queue:`, {
                  userId: String(userId),
                  groupId: groupId,
                  queueLength: queue.length
                });

                // If there's someone next in queue, grant them recording
                if (queue.length > 0) {
                  const nextUser = queue[0]; // First user in queue
                  console.log(`[Backend][RemoveMember][${requestId}] Checking next user in queue:`, {
                    nextUserId: nextUser.userId,
                    nextUserName: nextUser.userName,
                    isAutoRecording: nextUser.isAutoRecording,
                    groupId: groupId
                  });

                  // CRITICAL FIX: Check if next user has auto-recording enabled
                  if (nextUser.isAutoRecording) {
                    // Get group member count to determine queue processing behavior
                    const group = await groupChatsCollection.findOne({ 
                      _id: new ObjectId(groupId)
                    }, { 
                      projection: { members: 1 } 
                    });

                    const memberCount = group?.members?.length || 0;
                    const is3PlusPersonChat = memberCount >= 3;
                    
                    if (!is3PlusPersonChat) {
                      // For 2-person chats, grant recording immediately
                      // CRITICAL FIX: Add the new user to recording state
                      recordingUsers.add(nextUser.userId);

                      // Grant recording permission to next user
                      io.to(groupId).emit('recording_granted', {
                        groupId,
                        userId: nextUser.userId
                      });
                      
                      console.log(`[Backend][RemoveMember][${requestId}] Granted recording to next auto-recording user in 2-person chat:`, {
                        nextUserId: nextUser.userId,
                        nextUserName: nextUser.userName,
                        memberCount: memberCount,
                        groupId: groupId
                      });
                    } else {
                      // For 3+ person chats, store pending grant and wait for playback to finish
                      console.log(`[Backend][RemoveMember][${requestId}] 3+ person chat - storing pending grant until playback finishes:`, {
                        nextUserId: nextUser.userId,
                        nextUserName: nextUser.userName,
                        memberCount: memberCount,
                        groupId: groupId
                      });
                      
                      // Store pending grant instead of emitting immediately
                      if (!pendingRecordingGrants.has(groupId)) {
                        pendingRecordingGrants.set(groupId, []);
                      }
                      pendingRecordingGrants.get(groupId).push({
                        userId: nextUser.userId,
                        userName: nextUser.userName,
                        timestamp: Date.now()
                      });
                      
                      console.log(`[Backend][RemoveMember][${requestId}] Stored pending recording grant for 3+ person chat (waiting for playback):`, {
                        groupId: groupId,
                        pendingUserId: nextUser.userId,
                        pendingUserName: nextUser.userName,
                        memberCount: memberCount,
                        pendingGrantsCount: pendingRecordingGrants.get(groupId).length
                      });
                    }
                  } else {
                    console.log(`[Backend][RemoveMember][${requestId}] Next user is not auto-recording, no automatic transfer:`, {
                      nextUserId: nextUser.userId,
                      nextUserName: nextUser.userName,
                      groupId: groupId
                    });
                  }

                  // Remove the user from queue since they're now recording
                  queue.shift();
                  
                  // Update positions for remaining users again
                  queue.forEach((user, index) => {
                    user.position = index + 1;
                  });
                }

                // Clean up empty recording state
                if (recordingUsers.size === 0) {
                  recordingStates.delete(groupId);
                }

                // Broadcast recording state update
                io.to(groupId).emit('recording_state_update', {
                  groupId,
                  recordingUsers: Array.from(recordingUsers),
                  isAnyoneRecording: recordingUsers.size > 0,
                  transferredFrom: String(userId)
                });
              }
            }

            // Clean up empty queue or notify remaining users
            if (queue.length === 0) {
              recordingQueues.delete(groupId);
              console.log(`[Backend][RemoveMember][${requestId}] Cleaned up empty recording queue for group:`, groupId);
            } else {
              // Broadcast queue update to remaining users
              io.to(groupId).emit('recording_queue_updated', {
                groupId,
                queue: queue.slice()
              });
              console.log(`[Backend][RemoveMember][${requestId}] Notified remaining users of queue change:`, {
                groupId,
                remainingQueueLength: queue.length
              });
            }
          }
        }
      }
    } catch (socketError) {
      console.warn(`[Backend][RemoveMember][${requestId}] Error cleaning up recording states:`, socketError);
      // Don't fail the entire operation if socket cleanup fails
    }

    const duration = Date.now() - startTime;
    console.log(`[Backend][RemoveMember][${requestId}] Member removal completed successfully:`, {
      duration: `${duration}ms`,
      groupId,
      removedUserId: userId,
      requesterId
    });

    res.json({ 
      message: 'Member removed successfully',
      removedUserId: userId,
      groupId: groupId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Backend][RemoveMember][${requestId}] Error in member removal process:`, {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Delete group chat endpoint
app.delete('/api/groupchats/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await groupChatsCollection.deleteOne({ _id: new ObjectId(groupId) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Group chat not found' });
    }
    res.json({ message: 'Group chat deleted successfully' });
  } catch (error) {
    console.error('Error deleting group chat:', error);
    res.status(500).json({ error: 'Failed to delete group chat' });
  }
});

// Endpoint to get latest recorded message for a user (for textSpeech)
app.get('/api/messages/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const messages = await recordedMessagesCollection
      .find({ senderId: new ObjectId(userId) })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();
    res.json(messages);
  } catch (error) {
    console.error('Error fetching user messages:', error);
    res.status(500).json({ error: 'Failed to fetch user messages' });
  }
});

// Add new endpoints for message read status
app.post('/api/groupchats/:groupId/read', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId, lastReadMessageId } = req.body;

    // Update the member's lastReadAt in the group chat
    await groupChatsCollection.updateOne(
      { 
        _id: new ObjectId(groupId),
        'members.userId': String(userId)
      },
      {
        $set: {
          'members.$.lastReadAt': new Date()
        }
      }
    );

    // Update or create message read status
    await messageReadStatusCollection.updateOne(
      {
        userId: new ObjectId(userId),
        groupChatId: new ObjectId(groupId)
      },
      {
        $set: {
          lastReadMessageId: new ObjectId(lastReadMessageId),
          lastReadAt: new Date()
        }
      },
      { upsert: true }
    );

    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

app.get('/api/groupchats/:groupId/unread', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.query;

    try {
      // Get unread count from Redis
      const unreadCount = await getUserUnreadCount(groupId, userId);
      res.json({ unreadCount });
    } catch (error) {
      console.error(`[groupchats-unread] Error getting unread count from Redis for group ${groupId}:`, error);
      // Fallback to database calculation if Redis fails
      const readStatus = await messageReadStatusCollection.findOne({
        userId: new ObjectId(userId),
        groupChatId: new ObjectId(groupId)
      });

      const query = {
        groupChatId: new ObjectId(groupId),
        timestamp: { $gt: readStatus?.lastReadAt || new Date(0) }
      };

      const unreadCount = await recordedMessagesCollection.countDocuments(query);
      res.json({ unreadCount });
    }
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// API Endpoints
app.get('/api/group-chats', async (req, res) => {
  try {
    const db = client.db('flickd');
    const groupChats = await db.collection('groupChats').find({}).toArray();
    res.json(groupChats);
  } catch (error) {
    console.error('Error fetching group chats:', error);
    res.status(500).json({ error: 'Failed to fetch group chats' });
  }
});

// Add new OpenAI-based summary endpoint
app.post('/api/summarize', async (req, res) => {
  try {
    const { transcripts, groupName } = req.body;
    
    if (!transcripts || !Array.isArray(transcripts) || transcripts.length === 0) {
      return res.status(400).json({ error: 'Valid transcripts array is required' });
    }

    if (!groupName) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const summary = await openAIService.generateSummary(transcripts, groupName);
    res.json(summary);
  } catch (error) {
    console.error('Error in summarize endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to generate summary',
      details: error.message
    });
  }
});

// Create a new post
app.post('/api/posts', async (req, res) => {
  try {
    const { userId, content, media = [], tags = [], isPublic = true } = req.body;
    console.log('Received post creation request:', { userId, content, media, tags, isPublic });
    
    if (!userId || (!content && (!media || media.length === 0))) {
      console.log('Validation failed:', { userId, hasContent: !!content, mediaLength: media.length });
      return res.status(400).json({ error: 'User ID and either content or media are required' });
    }

    const post = {
      userId: new ObjectId(userId),
      content: content || '',
      media,
      createdAt: new Date(),
      updatedAt: new Date(),
      likes: 0,
      comments: [],
      tags,
      isPublic
    };

    console.log('Attempting to create post:', post);
    const result = await postsCollection.insertOne(post);
    console.log('Post created successfully:', result);
    
    res.status(201).json({ 
      message: 'Post created successfully',
      postId: result.insertedId
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: 'Failed to create post', details: error.message });
  }
});

// Get posts (with pagination)
app.get('/api/posts', async (req, res) => {
  try {
    const { page = 1, limit = 10, userId } = req.query;
    const skip = (page - 1) * limit;

    const query = userId ? { userId: new ObjectId(userId) } : {};
    console.log('Fetching posts with query:', query);
    
    const posts = await postsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();
    
    console.log('Found posts:', posts.length);

    // Get user information for each post
    const postsWithUsers = await Promise.all(posts.map(async (post) => {
      try {
        // Convert userId to ObjectId for querying users collection
        const user = await usersCollection.findOne({ _id: post.userId });
        console.log('Found user for post:', post._id, 'user:', user ? user.name : 'Not found');
        
        return {
          ...post,
          userId: post.userId.toString(), // Convert ObjectId to string for client
          userName: user ? user.name : 'Unknown User'
        };
      } catch (error) {
        console.error('Error fetching user for post:', error);
        return {
          ...post,
          userId: post.userId.toString(), // Convert ObjectId to string for client
          userName: 'Unknown User'
        };
      }
    }));

    const total = await postsCollection.countDocuments(query);
    console.log('Returning posts with users:', postsWithUsers.length);

    res.json({
      posts: postsWithUsers,
      total,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Like a post
app.post('/api/posts/:postId/like', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const result = await postsCollection.updateOne(
      { _id: new ObjectId(postId) },
      { $inc: { likes: 1 } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ message: 'Post liked successfully' });
  } catch (error) {
    console.error('Error liking post:', error);
    res.status(500).json({ error: 'Failed to like post' });
  }
});

// Add a comment to a post
app.post('/api/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, content, media = [] } = req.body;

    if (!userId || !content) {
      return res.status(400).json({ error: 'User ID and content are required' });
    }

    const comment = {
      _id: new ObjectId(),
      userId: new ObjectId(userId),
      content,
      media,
      createdAt: new Date(),
      updatedAt: new Date(),
      likes: 0
    };

    console.log('Adding comment to post:', postId, 'comment:', comment);

    const result = await postsCollection.updateOne(
      { _id: new ObjectId(postId) },
      { 
        $push: { comments: comment },
        $set: { updatedAt: new Date() }
      }
    );

    if (result.matchedCount === 0) {
      console.log('Post not found:', postId);
      return res.status(404).json({ error: 'Post not found' });
    }

    console.log('Comment added successfully:', comment._id);

    res.json({ 
      message: 'Comment added successfully',
      comment: {
        ...comment,
        userId: comment.userId.toString()
      }
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Get comments for a post
app.get('/api/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    console.log('Fetching comments for post:', postId, 'page:', page, 'limit:', limit);

    const post = await postsCollection.findOne(
      { _id: new ObjectId(postId) },
      { projection: { comments: { $slice: [skip, parseInt(limit)] } } }
    );

    if (!post) {
      console.log('Post not found:', postId);
      return res.json({
        comments: [],
        total: 0,
        currentPage: parseInt(page),
        totalPages: 0
      });
    }

    // Get user information for each comment
    const commentsWithUsers = await Promise.all(
      post.comments.map(async (comment) => {
        const user = await usersCollection.findOne({ _id: comment.userId });
        return {
          ...comment,
          userId: comment.userId.toString(),
          userName: user ? user.name : 'Unknown User'
        };
      })
    );

    const totalComments = post.comments.length;

    console.log('Returning comments:', {
      count: commentsWithUsers.length,
      total: totalComments,
      page: parseInt(page),
      totalPages: Math.ceil(totalComments / limit)
    });

    res.json({
      comments: commentsWithUsers,
      total: totalComments,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalComments / limit)
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Get group chat messages with caching
app.get('/api/group-chat/:groupId/messages', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const messages = await voiceMessageCache.getGroupMessages(groupId, page, limit);
    res.json(messages);
  } catch (error) {
    console.error('Error fetching group chat messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get voice message metadata
app.get('/api/messages/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const metadata = await voiceMessageCache.getVoiceMetadata(messageId);
    
    if (!metadata) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(metadata);
  } catch (error) {
    console.error('Error fetching message metadata:', error);
    res.status(500).json({ error: 'Failed to fetch message metadata' });
  }
});

// Get single message from database (for transcription updates)
app.get('/api/messages/db/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    
    // Validate messageId format before converting to ObjectId
    if (!ObjectId.isValid(messageId)) {
      console.error('[API][messages] Invalid messageId format:', messageId);
      return res.status(400).json({ error: 'Invalid message ID format' });
    }
    
    const message = await recordedMessagesCollection.findOne(
      { _id: new ObjectId(messageId) }
    );
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Format the message to match the frontend expectations
    const formattedMessage = {
      _id: message._id.toString(),
      audioUrl: message.audioUrl || null,
      mediaUrl: message.mediaUrl || null,
      duration: message.duration || 0,
      senderId: message.senderId,
      groupChatId: message.groupChatId,
      type: message.type || (message.audioUrl ? 'voice' : 'text'),
      timestamp: message.timestamp || new Date().toISOString(),
      processingStatus: message.processingStatus || 'ready',
      isRead: message.isRead || false,
      isDelivered: message.isDelivered || true,
      transcription: message.transcription || null,
      clientTempId: message.clientTempId,
      readBy: message.readBy || {},
    };

    res.json(formattedMessage);
  } catch (error) {
    console.error('Error fetching message from database:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// Get message transcription
app.get('/api/messages/:messageId/transcription', async (req, res) => {
  try {
    const { messageId } = req.params;
    const transcription = await voiceMessageCache.getTranscription(messageId);
    
    if (!transcription) {
      return res.status(404).json({ error: 'Transcription not found' });
    }

    res.json({ transcription });
  } catch (error) {
    console.error('Error fetching transcription:', error);
    res.status(500).json({ error: 'Failed to fetch transcription' });
  }
});

// Get signed URL for audio playback
app.get('/api/messages/:messageId/audio-url', async (req, res) => {
  const { messageId } = req.params;
  console.log(`[audio-url] 🔍 Request for message: ${messageId}`);
  
  try {
    console.log(`[audio-url] 📞 Calling voiceMessageCache.getVoiceMetadata(${messageId})`);
    const metadata = await voiceMessageCache.getVoiceMetadata(messageId);
    
    console.log(`[audio-url] 📋 Metadata result:`, {
      found: !!metadata,
      audioUrl: metadata?.url,
      messageId: metadata?.id
    });
    
    if (!metadata) {
      console.log(`[audio-url] ❌ Message not found: ${messageId}`);
      return res.status(404).json({ error: 'Message not found' });
    }

    if (!metadata.url) {
      console.log(`[audio-url] ❌ No audio URL in metadata: ${messageId}`);
      return res.status(404).json({ error: 'Audio URL not found' });
    }

    console.log(`[audio-url] 📞 Calling voiceMessageCache.getSignedUrl(${metadata.url})`);
    const signedUrl = await voiceMessageCache.getSignedUrl(metadata.url);
    
    console.log(`[audio-url] ✅ Successfully generated signed URL for ${messageId}`);
    res.json({ url: signedUrl });
  } catch (error) {
    console.error(`[audio-url] ❌ Error generating signed URL for ${messageId}:`, error);
    res.status(500).json({ error: 'Failed to generate signed URL' });
  }
});

// Get user profile with caching
app.get('/api/users/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const cacheKey = `userProfile:${userId}`;
    
    const userData = await cacheWrap(cacheKey, async () => {
      const user = await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { password: 0, refreshToken: 0 } }
      );
      
      if (!user) {
        return null;
      }
      
      return {
        id: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture,
        createdAt: user.createdAt
      };
    }, 600); // Cache for 10 minutes

    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(userData);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Update cache invalidation for write operations
app.post('/api/group-chat/:groupId/messages', async (req, res) => {
  const { groupId } = req.params;
  const { audioUrl, duration, senderId } = req.body;

  try {
    const result = await recordedMessagesCollection.insertOne({
      groupChatId: groupId,
      audioUrl,
      duration,
      senderId,
      timestamp: new Date(),
      isRead: false,
      isDelivered: true,
      readBy: { [senderId]: new Date() }, // Mark as read by sender immediately
      deliveredTo: [senderId] // Mark as delivered to sender
    });

    // Get the group to notify all members and handle unread counts
    const group = await groupChatsCollection.findOne({ _id: new ObjectId(groupId) });
    if (!group) {
      console.error('[API][group-chat-messages] Group not found:', groupId);
      return res.status(404).json({ error: 'Group not found' });
    }

    // Get all members except the sender
    const receivers = group.members.filter(member => String(member.userId) !== String(senderId));
    console.log('[API][group-chat-messages] Updating unread counts for receivers:', receivers.map(r => String(r.userId)));

    // OPTIMIZATION: Make unread count updates non-blocking for faster response
    const unreadCountPromise = Promise.allSettled(receivers.map(async receiver => {
      try {
        const newCount = await incrementUserUnreadCount(groupId, String(receiver.userId));
        
        // Emit unread count update to the specific receiver
        const io = require('./socket').getIO();
        if (io) {
          io.to(String(receiver.userId)).emit('unread_count_update', {
            chatId: groupId,
            userId: String(receiver.userId),
            unreadCount: newCount
          });
          console.log(`[API][group-chat-messages] Emitted unread count update to ${String(receiver.userId)}:`, newCount);
        }
      } catch (error) {
        console.error(`[API][group-chat-messages] Error updating unread count for ${String(receiver.userId)}:`, error);
      }
    }));

    // OPTIMIZATION: Emit socket events immediately without waiting for unread counts
    const io = require('./socket').getIO();
    if (io) {
      // Create the broadcast message object
      const broadcastMessage = {
        _id: result.insertedId,
        groupChatId: groupId,
        audioUrl,
        duration,
        senderId,
        timestamp: new Date(),
        isRead: false,
        isDelivered: true,
        readBy: { [senderId]: new Date() },
        deliveredTo: group.members.map(m => String(m.userId))
      };

      // OPTIMIZATION: Emit to group room only for faster delivery
      io.to(groupId).emit('new_message', broadcastMessage);

      console.log('[API][group-chat-messages] Broadcasting message to group:', groupId, {
        messageId: broadcastMessage._id,
        senderId: broadcastMessage.senderId,
        memberCount: group.members.length
      });

      // PHASE 2: Message acknowledgment tracking
      setImmediate(async () => {
        try {
          // Track message delivery status for all recipients
          const deliveryTracking = {
            messageId: broadcastMessage._id,
            groupChatId: groupId,
            senderId,
            recipients: group.members.map(m => String(m.userId)),
            sentAt: new Date(),
            deliveredTo: { [senderId]: new Date() }, // Sender is automatically delivered
            acknowledgedBy: { [senderId]: new Date() } // Sender is automatically acknowledged
          };

          // Store delivery tracking in database for monitoring
          await recordedMessagesCollection.updateOne(
            { _id: result.insertedId },
            { 
              $set: { 
                deliveryTracking,
                requiresAcknowledgment: true
              }
            }
          );

          console.log('[API][group-chat-messages] Message acknowledgment tracking initialized:', {
            messageId: broadcastMessage._id,
            recipientCount: group.members.length
          });
        } catch (error) {
          console.warn('[API][group-chat-messages] Error initializing acknowledgment tracking:', error);
        }
      });
    }

    // OPTIMIZATION: Move cache invalidation to background for faster response
    setImmediate(async () => {
      try {
        await Promise.all([
          invalidateCache(`groupChat:${groupId}:*`),
          voiceMessageCache.invalidateMessageCache(groupId)
        ]);
        console.log('[API][group-chat-messages] Background cache invalidation completed');
      } catch (error) {
        console.warn('[API][group-chat-messages] Background cache invalidation error:', error);
      }
    });

    // OPTIMIZATION: Wait for unread count updates in background
    unreadCountPromise.then(() => {
      console.log('[API][group-chat-messages] Background unread count updates completed');
    }).catch(error => {
      console.warn('[API][group-chat-messages] Background unread count updates error:', error);
    });

    res.json({ messageId: result.insertedId });
  } catch (error) {
    console.error('Error saving voice message:', error);
    res.status(500).json({ error: 'Failed to save message' });
  }
});

// Update user profile with cache invalidation
app.put('/api/users/:userId', async (req, res) => {
  const { userId } = req.params;
  const updates = req.body;

  try {
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Invalidate user profile cache
    await invalidateCache(`userProfile:${userId}`);

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Batch fetch messages with caching
app.post('/api/messages/batch', async (req, res) => {
  const { messageIds } = req.body;

  try {
    // Try to get from cache first
    const cacheKeys = messageIds.map(id => `voiceMeta:${id}`);
    const cachedMessages = await batchCache.mget(cacheKeys);

    // Find which messages need to be fetched from DB
    const missingIndices = cachedMessages
      .map((msg, index) => msg === null ? index : -1)
      .filter(index => index !== -1);

    if (missingIndices.length > 0) {
      // Fetch missing messages from DB
      const missingIds = missingIndices.map(index => messageIds[index]);
      const messages = await recordedMessagesCollection
        .find({ _id: { $in: missingIds.map(id => new ObjectId(id)) } })
        .toArray();

      // Cache the new messages
      const newCacheEntries = {};
      messages.forEach(msg => {
        newCacheEntries[`voiceMeta:${msg._id}`] = {
          id: msg._id,
          url: msg.audioUrl,
          duration: msg.duration,
          timestamp: msg.timestamp,
          senderId: msg.senderId,
          groupChatId: msg.groupChatId
        };
      });
      await batchCache.mset(newCacheEntries, 300);

      // Merge cached and new messages
      missingIndices.forEach((index, i) => {
        cachedMessages[index] = newCacheEntries[`voiceMeta:${messageIds[index]}`];
      });
    }

    res.json(cachedMessages);
  } catch (error) {
    console.error('Error batch fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Generate pre-signed URL for direct S3 upload
app.post('/api/generate-upload-url', async (req, res) => {
  try {
    const { fileName, contentType } = req.body;
    const fileKey = `voice-messages/${Date.now()}-${fileName}`;
    
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      ContentType: contentType
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    
    res.json({
      uploadUrl,
      fileKey,
      expiresIn: 3600
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// Add performance middleware
app.use(performanceMiddleware);

// Optimized voice message creation endpoint
app.post('/api/voice-message', async (req, res) => {
  const startTime = Date.now();
  const { audioUrl, duration, senderId, groupChatId } = req.body;
  
  try {
    // PHASE 3: Performance tracking
    const performanceMetrics = require('./utils/performanceMetrics').performanceMetrics;
    
    // Create message immediately with pending status
    const message = {
      audioUrl,
      duration,
      senderId,
      groupChatId,
      type: 'voice',
      timestamp: new Date(),
      processingStatus: 'uploading',
      isRead: false,
      isDelivered: true,
      readBy: { [senderId]: new Date() }, // Mark as read by sender immediately
      deliveredTo: [senderId] // Mark as delivered to sender
    };

    // Insert message and get ID
    const result = await recordedMessagesCollection.insertOne(message);
    const messageId = result.insertedId;

    // PHASE 3: Cache the new voice message for instant access
    setImmediate(async () => {
      try {
        const { advancedCacheService } = require('./utils/advancedCacheService');
        const savedMessage = { ...message, _id: messageId };
        await advancedCacheService.cacheMessage(messageId.toString(), savedMessage);
      } catch (error) {
        console.warn('[API][voice-message] Error caching message:', error);
      }
    });

    // Start metrics after we have the messageId
    voiceMessageMetrics.startUpload(messageId);
    
    // Get the group to notify all members and handle unread counts
    const group = await groupChatsCollection.findOne({ _id: new ObjectId(groupChatId) });
    if (!group) {
      console.error('[API][voice-message] Group not found:', groupChatId);
      return res.status(404).json({ error: 'Group not found' });
    }

    // Get all members except the sender
    const receivers = group.members.filter(member => String(member.userId) !== String(senderId));
    console.log('[API][voice-message] Updating unread counts for receivers:', receivers.map(r => String(r.userId)));

    // OPTIMIZATION: Make unread count updates non-blocking for faster response
    const unreadCountPromise = Promise.allSettled(receivers.map(async receiver => {
      try {
        const newCount = await incrementUserUnreadCount(groupChatId, String(receiver.userId));
        
        // Emit unread count update to the specific receiver
        const io = require('./socket').getIO();
        if (io) {
          io.to(String(receiver.userId)).emit('unread_count_update', {
            chatId: groupChatId,
            userId: String(receiver.userId),
            unreadCount: newCount
          });
          console.log(`[API][voice-message] Emitted unread count update to ${String(receiver.userId)}:`, newCount);
        }
      } catch (error) {
        console.error(`[API][voice-message] Error updating unread count for ${String(receiver.userId)}:`, error);
      }
    }));

    // OPTIMIZATION: Emit socket events immediately without waiting for unread counts
    const io = require('./socket').getIO();
    if (io) {
      // Create the broadcast message object
      const broadcastMessage = {
        ...message,
        _id: messageId,
        isRead: false,
        isDelivered: true,
        readBy: { [senderId]: new Date() },
        deliveredTo: group.members.map(m => String(m.userId))
      };

      // OPTIMIZATION: Emit to group room only for faster delivery
      io.to(groupChatId).emit('new_message', broadcastMessage);

      console.log('[API][voice-message] Broadcasting message to group:', groupChatId, {
        messageId: broadcastMessage._id,
        senderId: broadcastMessage.senderId,
        memberCount: group.members.length
      });

      // PHASE 2: Message acknowledgment tracking
      setImmediate(async () => {
        try {
          // Track message delivery status for all recipients
          const deliveryTracking = {
            messageId: broadcastMessage._id,
            groupChatId,
            senderId,
            recipients: group.members.map(m => String(m.userId)),
            sentAt: new Date(),
            deliveredTo: { [senderId]: new Date() }, // Sender is automatically delivered
            acknowledgedBy: { [senderId]: new Date() } // Sender is automatically acknowledged
          };

          // Store delivery tracking in database for monitoring
          await recordedMessagesCollection.updateOne(
            { _id: messageId },
            { 
              $set: { 
                deliveryTracking,
                requiresAcknowledgment: true
              }
            }
          );

          console.log('[API][voice-message] Message acknowledgment tracking initialized:', {
            messageId: broadcastMessage._id,
            recipientCount: group.members.length
          });
        } catch (error) {
          console.warn('[API][voice-message] Error initializing acknowledgment tracking:', error);
        }
      });
    }

    // OPTIMIZATION: Move cache invalidation to background for faster response
    setImmediate(async () => {
      try {
        await Promise.all([
          invalidateCache(`groupChat:${groupChatId}:*`),
          invalidateCache(`user:${senderId}:messages:*`),
          voiceMessageCache.invalidateGroupChat(groupChatId),
          voiceMessageCache.invalidateMessageCache(groupChatId)
        ]);
        console.log('[API][voice-message] Background cache invalidation completed');
      } catch (error) {
        console.warn('[API][voice-message] Background cache invalidation error:', error);
      }
    });

    // OPTIMIZATION: Wait for unread count updates in background
    unreadCountPromise.then(() => {
      console.log('[API][voice-message] Background unread count updates completed');
    }).catch(error => {
      console.warn('[API][voice-message] Background unread count updates error:', error);
    });

    // Start parallel operations in background
    setImmediate(async () => {
      try {
        await Promise.all([
          // Update message status
          recordedMessagesCollection.updateOne(
            { _id: messageId },
            { 
              $set: { 
                processingStatus: 'ready',
                completedAt: new Date()
              }
            }
          ),
          // Start transcription in background
          (async () => {
            try {
              const jobName = await startTranscription(messageId, audioUrl, groupChatId);
              
              // Update message with job name
              await recordedMessagesCollection.updateOne(
                { _id: messageId },
                { $set: { jobName } }
              );
            } catch (error) {
              console.error('Transcription start error:', error);
              await recordedMessagesCollection.updateOne(
                { _id: messageId },
                { $set: { processingStatus: 'failed' } }
              );
            }
          })()
        ]);

        // End upload metrics
        voiceMessageMetrics.endUpload(messageId, {
          uploadTime: Date.now() - startTime
        });

        console.log('[API][voice-message] Background operations completed');
      } catch (error) {
        console.error('[API][voice-message] Background operations error:', error);
      }
    });

    res.json({ messageId: result.insertedId });
    
    // PHASE 3: Track successful voice message send
    performanceMetrics.trackMessageSend('/api/voice-message', 'voice', startTime, true);
    
  } catch (error) {
    console.error('Error saving voice message:', error);
    
    // PHASE 3: Track failed voice message send
    const performanceMetrics = require('./utils/performanceMetrics').performanceMetrics;
    performanceMetrics.trackMessageSend('/api/voice-message', 'voice', startTime, false, error);
    
    res.status(500).json({ error: 'Failed to save message' });
  }
});

// Lambda handler endpoint for transcription events
app.post('/api/transcription-webhook', async (req, res) => {
  try {
    await handleTranscriptionEvent(req.body);
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Transcription webhook error:', error);
    res.status(500).json({ error: 'Failed to process transcription event' });
  }
});

// Test endpoint for voice message pipeline
app.post('/api/test/voice-message', async (req, res) => {
  const startTime = Date.now();
  const { audioUrl, duration, senderId, groupChatId } = req.body;
  
  try {
    // Log pipeline start
    console.log('Starting voice message pipeline test:', {
      timestamp: new Date().toISOString(),
      audioUrl,
      duration,
      senderId,
      groupChatId,
      bucketName: process.env.S3_BUCKET_NAME
    });

    // Validate S3 URL
    const expectedPrefix = `s3://${process.env.S3_BUCKET_NAME}/`;
    if (!audioUrl.startsWith(expectedPrefix)) {
      throw new Error(`Invalid S3 URL. Must start with ${expectedPrefix}`);
    }

    // Create message
    const message = {
      audioUrl,
      duration,
      senderId,
      groupChatId,
      type: 'voice',
      timestamp: new Date(),
      processingStatus: 'uploading',
      isRead: false,
      isDelivered: true
    };

    // Insert and get ID
    const result = await recordedMessagesCollection.insertOne(message);
    const messageId = result.insertedId;

    // Log message creation
    console.log('Message created:', {
      messageId,
      timestamp: new Date().toISOString(),
      timeElapsed: Date.now() - startTime
    });

    // Update status and broadcast
    await recordedMessagesCollection.updateOne(
      { _id: messageId },
      { 
        $set: { 
          processingStatus: 'ready',
          completedAt: new Date()
        }
      }
    );

    // Log message ready
    console.log('Message ready:', {
      messageId,
      timestamp: new Date().toISOString(),
      timeElapsed: Date.now() - startTime
    });

    // Publish event
    await publishMessageReady(groupChatId, messageId);

    // Start transcription
    const jobName = await startTranscription(messageId, audioUrl, groupChatId);
    
    // Log transcription start
    console.log('Transcription started:', {
      messageId,
      jobName,
      timestamp: new Date().toISOString(),
      timeElapsed: Date.now() - startTime
    });

    res.json({
      messageId,
      jobName,
      status: 'success',
      metrics: {
        totalTime: Date.now() - startTime,
        messageCreationTime: Date.now() - startTime,
        transcriptionStartTime: Date.now() - startTime
      }
    });
  } catch (error) {
    console.error('Test pipeline error:', error);
    res.status(500).json({ error: error.message || 'Test pipeline failed' });
  }
});

// Update message processing status and audio URL
app.put('/api/messages/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { audioUrl, processingStatus } = req.body;

    if (!messageId) {
      return res.status(400).json({ error: 'Message ID is required' });
    }

    const updateData = {};
    if (audioUrl !== undefined) updateData.audioUrl = audioUrl;
    if (processingStatus !== undefined) updateData.processingStatus = processingStatus;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No update data provided' });
    }

    const result = await recordedMessagesCollection.updateOne(
      { _id: new ObjectId(messageId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Invalidate relevant caches
    await Promise.all([
      invalidateCache(`message:${messageId}`),
      invalidateCache(`groupChat:*:messages`)
    ]).catch(error => {
      console.warn('Cache invalidation error:', error);
    });

    res.json({ message: 'Message updated successfully' });
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// Add this after other group chat endpoints
app.get('/api/group-chats/unread-count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('[group-chats-unread-count] Received request for userId:', userId);
    
    if (!userId) {
      console.error('[group-chats-unread-count] User ID is required');
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Find all group chats where the user is a member
    console.log('[group-chats-unread-count] Finding group chats for user:', userId);
    const groupChats = await groupChatsCollection.find({ 'members.userId': String(userId) }).toArray();
    console.log('[group-chats-unread-count] Found group chats:', {
      count: groupChats.length,
      chatIds: groupChats.map(chat => chat._id.toString())
    });
    
    let totalUnread = 0;

    try {
      // Get unread counts from Redis
      console.log('[group-chats-unread-count] Getting unread counts from Redis...');
      totalUnread = await getTotalUnreadCount(userId, groupChats);
      console.log('[group-chats-unread-count] Redis unread count:', totalUnread);
      
      // If Redis returns 0, double-check with database to ensure accuracy
      if (totalUnread === 0) {
        console.log('[group-chats-unread-count] Redis returned 0, verifying with database...');
        let dbTotalUnread = 0;
        for (const chat of groupChats) {
          const query = {
            groupChatId: chat._id,
            senderId: { $ne: new ObjectId(userId) },
            [`readBy.${userId}`]: { $exists: false }
          };
          const unreadCount = await recordedMessagesCollection.countDocuments(query);
          if (unreadCount > 0) {
            console.log('[group-chats-unread-count] Found unread messages in chat', chat._id.toString(), ':', unreadCount);
            dbTotalUnread += unreadCount;
            
            // Update Redis with the correct count
            try {
              await redisClient.hset(`unread:${chat._id}`, userId, unreadCount);
              console.log('[group-chats-unread-count] Updated Redis for chat', chat._id.toString(), ':', unreadCount);
            } catch (redisError) {
              console.warn('[group-chats-unread-count] Failed to update Redis for chat', chat._id.toString(), ':', redisError.message);
            }
          }
        }
        
        if (dbTotalUnread > 0) {
          console.log('[group-chats-unread-count] Database found unread messages, updating total:', dbTotalUnread);
          totalUnread = dbTotalUnread;
        }
      }
    } catch (error) {
      console.error(`[group-chats-unread-count] Error getting unread counts from Redis:`, error);
      // Fallback to database calculation using readBy field
      console.log('[group-chats-unread-count] Falling back to database calculation using readBy...');
      for (const chat of groupChats) {
        console.log('[group-chats-unread-count] Checking unread for chat:', chat._id.toString());
        const query = {
          groupChatId: chat._id,
          senderId: { $ne: new ObjectId(userId) },
          [`readBy.${userId}`]: { $exists: false }
        };
        const unreadCount = await recordedMessagesCollection.countDocuments(query);
        console.log('[group-chats-unread-count] Unread count for chat', chat._id.toString(), ':', unreadCount);
        totalUnread += unreadCount;
      }
      console.log('[group-chats-unread-count] Database fallback total unread count (readBy):', totalUnread);
    }

    console.log('[group-chats-unread-count] Returning total unread count:', totalUnread);
    res.json({ totalUnread });
  } catch (error) {
    console.error('[group-chats-unread-count] Error getting total unread count:', error);
    res.status(500).json({ error: 'Failed to get total unread count' });
  }
});

// Newspaper endpoint: Summarize last 24 hours of group chat transcripts
app.get('/api/newspaper', async (req, res) => {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // 1. Find all groupChatIds with messages in the last 24 hours
    const recentMessages = await recordedMessagesCollection.aggregate([
      { $match: { timestamp: { $gte: yesterday } } },
      { $group: { _id: "$groupChatId" } }
    ]).toArray();
    const groupChatIds = recentMessages.map(g => g._id);
    console.log(`[Newspaper API] Found ${groupChatIds.length} group(s) with messages in the last 24 hours.`);

    // 2. For each groupChatId, fetch messages and extract transcripts
    const results = [];
    for (const groupChatId of groupChatIds) {
      // Fetch group chat info
      const group = await groupChatsCollection.findOne({ _id: groupChatId });
      if (!group) continue;
      const groupName = group.name || "Unnamed Group";

      // Fetch all messages for this group in the last 24 hours
      const messages = await recordedMessagesCollection.find({
        groupChatId,
        timestamp: { $gte: yesterday }
      }).toArray();
      console.log(`[Newspaper API] Group '${groupName}' (${groupChatId}): found ${messages.length} message(s).`);

      // Extract and combine all transcript text
      let transcripts = [];
      let transcriptCount = 0;
      let lastActiveAt = null;
      for (const msg of messages) {
        if (
          msg.type === 'voice' &&
          msg.transcription &&
          msg.transcription.results &&
          Array.isArray(msg.transcription.results.transcripts)
        ) {
          for (const transcriptObj of msg.transcription.results.transcripts) {
            let transcriptText = '';
            if (typeof transcriptObj.transcript === 'string') {
              transcriptText = transcriptObj.transcript;
            } else if (Array.isArray(transcriptObj.items)) {
              transcriptText = transcriptObj.items.map(item => item.alternatives?.[0]?.content || "").join(" ");
            }
            if (transcriptText && transcriptText.trim().length > 0) {
              const sender = msg.senderName || "Unknown";
              transcripts.push(`${sender}: ${transcriptText.trim()}`);
              transcriptCount++;
              if (!lastActiveAt || msg.timestamp > lastActiveAt) lastActiveAt = msg.timestamp;
            }
          }
        }
      }
      transcripts = transcripts.filter(Boolean);
      if (!lastActiveAt && messages.length > 0) {
        lastActiveAt = messages[messages.length - 1].timestamp;
      }
      console.log(`[Newspaper API] Group '${groupName}': extracted ${transcriptCount} transcript(s). Last active at: ${lastActiveAt}`);

      // Find the last summary for this group
      const existing = await newspaperSummariesCollection.findOne({ groupChatId: groupChatId.toString() });
      let shouldCallOpenAI = false;
      if (!existing) {
        // No summary exists yet, always call OpenAI
        shouldCallOpenAI = true;
      } else {
        // Only call OpenAI if there are 10 or more new transcripts since the last summary
        const lastSummaryTime = existing.updatedAt || new Date(0);
        const newTranscripts = messages.filter(msg =>
          msg.type === 'voice' &&
          msg.transcription &&
          msg.timestamp > lastSummaryTime
        );
        if (newTranscripts.length >= 10) {
          shouldCallOpenAI = true;
        }
      }

      if (!shouldCallOpenAI) {
        // Not enough new transcripts, return the last saved summary for this group (if any)
        if (existing) {
          // Include all existing summaries regardless of age
          results.push(existing);
          console.log(`[Newspaper API] Returning existing summary for group '${groupName}'.`);
        }
        continue;
      }

      // Combine all transcript text for the group
      const combinedTranscript = transcripts.join("\n");

      // Log the prompt for debugging
      const debugPrompt = `You are a skilled journalist creating a newspaper headline and summary for a group chat conversation.\nGroup Name: ${groupName}\nConversation: ${combinedTranscript}\nPlease provide: 1. A catchy, engaging headline (max 10 words) 2. A concise summary (max 3 sentences) Format the response as JSON: { \"headline\": \"your headline here\", \"summary\": \"your summary here\" }`;
  

      // Generate summary and headline using OpenAI
      let summaryResult = { headline: "", summary: "" };
      try {
        summaryResult = await openAIService.generateSummary(transcripts, groupName);
      } catch (err) {
        console.error("OpenAI summary error for group", groupName, err);
      }

      // Fetch media for this group from the last 24 hours (restore timestamp filter)
      const media = await newspaperMediaCollection.find({
        groupChatId: groupChatId.toString(),
        timestamp: { $gte: yesterday }
      }).toArray();
      console.log('Processing groupChatId:', groupChatId.toString());
      console.log('Media found:', media);
      const mediaArray = media.map(m => ({ type: m.type, uri: m.url }));

      // Upsert the summary in the database
      const existingSummary = await newspaperSummariesCollection.findOne({ groupChatId: groupChatId.toString() });
      let combinedSummary = summaryResult.summary;
      let combinedHeadline = summaryResult.headline;
      
      if (existingSummary && existingSummary.summary) {
        // Append new summary to existing one
        combinedSummary = `${existingSummary.summary}\n\n${summaryResult.summary}`;
        // Keep the original headline for now, could be enhanced later
        combinedHeadline = existingSummary.headline;
      }
      
      const summaryDoc = {
        groupName,
        groupChatId: groupChatId.toString(),
        headline: combinedHeadline,
        summary: combinedSummary,
        updatedAt: new Date(),
        lastActiveAt: lastActiveAt || new Date(),
        messageCount: transcriptCount,
        media: mediaArray
      };
      await newspaperSummariesCollection.updateOne(
        { groupChatId: groupChatId.toString() },
        { $set: summaryDoc },
        { upsert: true }
      );
      results.push(summaryDoc);
      console.log(`[Newspaper API] Added new summary for group '${groupName}'.`);
    }

    res.json(results);
  } catch (error) {
    console.error("Error generating newspaper summaries:", error);
    res.status(500).json({ error: "Failed to generate newspaper summaries" });
  }
});

// Endpoint to upload media to a group chat
app.post('/api/group-chat/:groupId/media', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { url, type } = req.body; // type: 'image' or 'video'
    if (!url || !type) {
      return res.status(400).json({ error: 'url and type are required' });
    }
    const mediaDoc = {
      groupChatId: groupId,
      url,
      type,
      timestamp: new Date()
    };
    await newspaperMediaCollection.insertOne(mediaDoc);
    res.status(201).json({ message: 'Media uploaded successfully' });
  } catch (error) {
    console.error('Error uploading media:', error);
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

// Get user-specific newspaper summaries
app.get('/api/newspaper/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;


    // Get all group chats the user is a member of
    const userGroups = await groupChatsCollection.find({
      'members.userId': userId
    }).toArray();

    if (!userGroups.length) {
  
      return res.json([]);
    }

    const groupChatIds = userGroups.map(group => group._id.toString());
    console.log(`[Newspaper API] Found ${groupChatIds.length} groups for user`);

    // Get summaries for all user's groups
    const summaries = await newspaperSummariesCollection.find({
      groupChatId: { $in: groupChatIds }
    }).sort({ updatedAt: -1 }).toArray();

    // Use all summaries instead of filtering by expiration
    const activeSummaries = summaries;

    // If no summaries exist, try to generate them
    if (activeSummaries.length === 0) {
  
      for (const group of userGroups) {
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        // Get messages from the last 24 hours
        const messages = await recordedMessagesCollection.find({
          groupChatId: group._id,
          timestamp: { $gte: oneDayAgo }
        }).toArray();
        console.log(`[Newspaper API] Group '${group.name}': found ${messages.length} message(s) in last 24 hours.`);
        // Extract transcripts using the same robust logic as the main newspaper endpoint
        let transcripts = [];
        let transcriptCount = 0;
        let lastActiveAt = null;
        
        for (const msg of messages) {
          if (
            msg.type === 'voice' &&
            msg.transcription &&
            msg.transcription.results &&
            Array.isArray(msg.transcription.results.transcripts)
          ) {
            for (const transcriptObj of msg.transcription.results.transcripts) {
              let transcriptText = '';
              if (typeof transcriptObj.transcript === 'string') {
                transcriptText = transcriptObj.transcript;
              } else if (Array.isArray(transcriptObj.items)) {
                transcriptText = transcriptObj.items.map(item => item.alternatives?.[0]?.content || "").join(" ");
              }
              if (transcriptText && transcriptText.trim().length > 0) {
                const sender = msg.senderName || "Unknown";
                transcripts.push(`${sender}: ${transcriptText.trim()}`);
                transcriptCount++;
                if (!lastActiveAt || msg.timestamp > lastActiveAt) lastActiveAt = msg.timestamp;
              }
            }
          }
        }
        
        transcripts = transcripts.filter(Boolean);
        if (!lastActiveAt && messages.length > 0) {
          lastActiveAt = messages[messages.length - 1].timestamp;
        }
        
        console.log(`[Newspaper API] Group '${group.name}': extracted ${transcriptCount} transcript(s). Last active at: ${lastActiveAt}`);
        
        if (transcriptCount >= 10) {
          try {
              // Generate summary using OpenAI
              let summaryResult;
              try {
                summaryResult = await openAIService.generateSummary(transcripts, group.name);
              } catch (openAIError) {
                console.error(`[Newspaper API] OpenAI error for group ${group.name}:`, openAIError.message);
                // Fallback summary if OpenAI fails
                summaryResult = {
                  headline: `${group.name} Group Activity`,
                  summary: `Recent activity in ${group.name} with ${transcripts.length} messages. Check the group for latest updates.`
                };
              }
              // Get media for this group
              const media = await newspaperMediaCollection.find({
                groupChatId: group._id.toString(),
                timestamp: { $gte: oneDayAgo }
              }).toArray();
              const mediaArray = media.map(m => ({ type: m.type, uri: m.url }));
              
              // Use the new summary directly (don't append to old summaries)
              let combinedSummary = summaryResult.summary;
              let combinedHeadline = summaryResult.headline;
              
              // Store the summary
              const summaryDoc = {
                groupName: group.name,
                groupChatId: group._id.toString(),
                headline: combinedHeadline,
                summary: combinedSummary,
                updatedAt: new Date(),
                lastActiveAt: lastActiveAt || new Date(),
                messageCount: transcriptCount,
                media: mediaArray
              };
              await newspaperSummariesCollection.updateOne(
                { groupChatId: group._id.toString() },
                { $set: summaryDoc },
                { upsert: true }
              );
              console.log(`[Newspaper API] Generated and stored summary for group: ${group.name}`);
            } catch (error) {
              console.error(`[Newspaper API] Error generating summary for group ${group.name}:`, error);
            }
                      } else {
            console.log(`[Newspaper API] Not enough transcripts to generate summary for group: ${group.name} (${transcriptCount} < 10)`);
          }
      }
      // Fetch the newly generated summaries
      const updatedSummaries = await newspaperSummariesCollection.find({
        groupChatId: { $in: groupChatIds }
      }).sort({ updatedAt: -1 }).toArray();
      
      // Use all summaries instead of filtering by expiration
      const refreshedActiveSummaries = updatedSummaries;
      // Enrich summaries with group names
      const enrichedSummaries = refreshedActiveSummaries.map(summary => {
        const group = userGroups.find(g => g._id.toString() === summary.groupChatId);
        return {
          ...summary,
          groupName: group ? group.name : 'Unknown Group',
          groupIcon: group ? group.groupIcon : undefined
        };
      });
      console.log(`[Newspaper API] Found ${enrichedSummaries.length} active summaries after generation`);
      return res.json(enrichedSummaries);
    }
    // Enrich existing summaries with group names
    const enrichedSummaries = activeSummaries.map(summary => {
      const group = userGroups.find(g => g._id.toString() === summary.groupChatId);
      return {
        ...summary,
        groupName: group ? group.name : 'Unknown Group',
        groupIcon: group ? group.groupIcon : undefined
      };
    });
    console.log(`[Newspaper API] Found ${enrichedSummaries.length} active summaries for user`);
    res.json(enrichedSummaries);
  } catch (error) {
    console.error("[Newspaper API] Error fetching user summaries:", error);
    res.status(500).json({ error: "Failed to fetch user newspaper summaries" });
  }
});

// Update group icon endpoint
app.post('/api/groupchats/:groupId/icon', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { iconUrl } = req.body;

    if (!iconUrl) {
      return res.status(400).json({ error: 'No icon URL provided' });
    }

    // Update group chat with new icon URL
    const result = await groupChatsCollection.updateOne(
      { _id: new ObjectId(groupId) },
      { 
        $set: { 
          groupIcon: iconUrl,
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Group chat not found' });
    }

    // Get the updated group chat
    const updatedGroup = await groupChatsCollection.findOne({ _id: new ObjectId(groupId) });
    
    if (!updatedGroup) {
      return res.status(500).json({ error: 'Failed to retrieve updated group' });
    }

    // Convert ObjectId to string for JSON serialization
    const serializedGroup = {
      ...updatedGroup,
      _id: updatedGroup._id.toString(),
      createdBy: updatedGroup.createdBy.toString(),
      members: updatedGroup.members.map(member => ({
        ...member,
        userId: member.userId.toString()
      }))
    };
    
    // Invalidate cache for this group chat
    await invalidateCache(`groupChat:${groupId}:*`);
    
    res.json(serializedGroup);
  } catch (error) {
    console.error('Error updating group icon:', error);
    res.status(500).json({ error: 'Failed to update group icon' });
  }
});

// Mark all messages in a group as read for a user
app.post('/api/groupchats/:groupId/mark-all-read', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;
    console.log('[mark-all-read] Received request for groupId:', groupId, 'userId:', userId, 'from IP:', req.ip);
    
    if (!userId) {
      console.error('[mark-all-read] User ID is required');
      return res.status(400).json({ error: 'User ID is required' });
    }

    // OPTIMIZATION: Use bulk operations instead of individual updates
    const startTime = Date.now();
    
    // Get the group to understand member structure
    const group = await groupChatsCollection.findOne({ _id: new ObjectId(groupId) });
    if (!group) {
      console.error('[mark-all-read] Group not found:', groupId);
      return res.status(404).json({ error: 'Group not found' });
    }

    // OPTIMIZATION: Bulk update all messages at once
    const bulkUpdateResult = await recordedMessagesCollection.updateMany(
      {
        groupChatId: new ObjectId(groupId),
        senderId: { $ne: new ObjectId(userId) }
      },
      {
        $set: {
          [`readBy.${userId}`]: new Date()
        }
      }
    );

    console.log(`[mark-all-read] Bulk updated ${bulkUpdateResult.modifiedCount} messages in ${Date.now() - startTime}ms`);

    // OPTIMIZATION: Get the latest message timestamp for read status update
    const latestMessage = await recordedMessagesCollection
      .find({ groupChatId: new ObjectId(groupId) })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    const lastReadAt = latestMessage.length > 0 ? latestMessage[0].timestamp : new Date();

    // Update messageReadStatusCollection for this user and group
    await messageReadStatusCollection.updateOne(
      {
        userId: new ObjectId(userId),
        groupChatId: new ObjectId(groupId)
      },
      {
        $set: {
          lastReadMessageId: latestMessage.length > 0 ? latestMessage[0]._id : null,
          lastReadAt
        }
      },
      { upsert: true }
    );

    // Reset unread count in Redis using safe operation
    await resetUserUnreadCount(groupId, userId);
    console.log(`[mark-all-read] Reset Redis unread count for userId: ${userId}, groupId: ${groupId}`);

    // Emit real-time unread count update
    const io = require('./socket').getIO();
    if (io) {
      io.to(groupId).emit('unread_count_update', {
        chatId: groupId,
        userId: userId,
        unreadCount: 0
      });
    }

    const totalTime = Date.now() - startTime;
    console.log(`[mark-all-read] Completed in ${totalTime}ms - Updated ${bulkUpdateResult.modifiedCount} messages`);

    res.json({ 
      message: 'All messages marked as read', 
      updatedCount: bulkUpdateResult.modifiedCount,
      processingTime: `${totalTime}ms`
    });
  } catch (error) {
    console.error('[mark-all-read] Error marking all messages as read:', error);
    res.status(500).json({ error: 'Failed to mark all messages as read' });
  }
});

// Get unread message summary for a group chat
app.get('/api/groupchats/:groupId/summary', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.query;
    
    console.log('[groupchats-summary] Received request for groupId:', groupId, 'userId:', userId);
    
    if (!userId) {
      console.error('[groupchats-summary] User ID is required');
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get read status
    const readStatus = await messageReadStatusCollection.findOne({
      userId: new ObjectId(userId),
      groupChatId: new ObjectId(groupId)
    });
    
    const lastReadAt = readStatus?.lastReadAt || new Date(0);
    console.log('[groupchats-summary] Last read at:', lastReadAt);
    
    // Get unread messages
    const unreadMessages = await recordedMessagesCollection.find({
      groupChatId: new ObjectId(groupId),
      timestamp: { $gt: lastReadAt },
      senderId: { $ne: new ObjectId(userId) }
    }).limit(50).toArray();
    
    console.log('[groupchats-summary] Found unread messages:', unreadMessages.length);
    
    if (unreadMessages.length === 0) {
      console.log('[groupchats-summary] No unread messages found');
      return res.json({
        summary: null,
        messageCount: 0,
        lastUpdated: null
      });
    }
    
    // Extract transcripts
    const transcripts = unreadMessages
      .filter(msg => msg.transcription)
      .map(msg => {
        // Handle different transcript formats
        if (typeof msg.transcription === 'string') {
          console.log('[groupchats-summary] String transcript found');
          return msg.transcription;
        }
        if (msg.transcription.results?.transcripts?.[0]?.transcript) {
          console.log('[groupchats-summary] Nested transcript found');
          return msg.transcription.results.transcripts[0].transcript;
        }
        if (msg.transcription.results?.items) {
          console.log('[groupchats-summary] Items transcript found');
          return msg.transcription.results.items
            .map((item) => item.alternatives?.[0]?.content || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
        console.log('[groupchats-summary] No valid transcript format found for message:', msg._id);
        return '';
      })
      .filter(t => t.length > 0);
    
    console.log('[groupchats-summary] Extracted transcripts:', transcripts.length);
    
    if (transcripts.length === 0) {
      console.log('[groupchats-summary] No valid transcripts found');
      return res.json({
        summary: null,
        messageCount: unreadMessages.length,
        lastUpdated: unreadMessages[0]?.timestamp || null
      });
    }
    
    // Generate summary using the same logic as the frontend
    const text = transcripts.join('. ');
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    
    let summary = '';
    if (sentences.length === 0) {
      summary = '';
    } else if (sentences.length <= 3) {
      summary = text;
    } else {
      const firstSentence = sentences[0];
      const middleSentence = sentences[Math.floor(sentences.length / 2)];
      const lastSentence = sentences[sentences.length - 1];
      summary = [firstSentence, middleSentence, lastSentence]
        .filter(s => s && s.length > 0)
        .join('. ');
      summary = summary.endsWith('.') ? summary : summary + '.';
    }
    
    console.log('[groupchats-summary] Generated summary:', summary);
    
    res.json({
      summary: summary,
      messageCount: unreadMessages.length,
      lastUpdated: unreadMessages[0]?.timestamp || null
    });
    
  } catch (error) {
    console.error('[groupchats-summary] Error generating unread summary:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Leave group chat endpoint
app.post('/api/groupchats/:groupId/leave', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    // Validate that the group exists and get group info
    const group = await groupChatsCollection.findOne({ _id: new ObjectId(groupId) });
    if (!group) {
      return res.status(404).json({ error: 'Group chat not found' });
    }

    // Check if the user is actually a member of the group
    const memberExists = group.members.some(member => String(member.userId) === String(userId));
    if (!memberExists) {
      return res.status(404).json({ error: 'User is not a member of this group' });
    }

    // If the user is the creator, transfer ownership to the next oldest member
    if (String(group.createdBy) === String(userId)) {
      // Sort members by join date (excluding the creator)
      const otherMembers = group.members
        .filter(member => String(member.userId) !== String(userId))
        .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());

      if (otherMembers.length === 0) {
        // If no other members, delete the group
        await groupChatsCollection.deleteOne({ _id: new ObjectId(groupId) });
        
        // Emit socket event for group deletion
        const io = require('./socket').getIO();
        if (io) {
          io.to(groupId).emit('group_deleted', { groupId: groupId });
        }
        
        return res.json({ message: 'Group chat deleted as no members remain' });
      }

      // Transfer ownership to the next oldest member and remove the creator robustly
      const newCreator = otherMembers[0];
      await groupChatsCollection.updateOne(
        { _id: new ObjectId(groupId) },
        {
          $set: { createdBy: new ObjectId(newCreator.userId) },
          $pull: {
            members: { userId: String(userId) }
          }
        }
      );
      
      // Emit socket event for ownership transfer and member removal
      const io = require('./socket').getIO();
      if (io) {
        const remainingMembers = otherMembers;
        remainingMembers.forEach(member => {
          io.to(String(member.userId)).emit('group_ownership_transferred', {
            groupId: groupId,
            newCreatorId: String(newCreator.userId),
            newCreatorName: newCreator.name
          });
          io.to(String(member.userId)).emit('group_member_left', {
            groupId: groupId,
            leftUserId: String(userId)
          });
        });
        
        // Emit to the leaving user
        io.to(String(userId)).emit('group_member_left', {
          groupId: groupId,
          leftUserId: String(userId)
        });
      }
    } else {
      // Regular member leaving - just remove them from the group robustly
      await groupChatsCollection.updateOne(
        { _id: new ObjectId(groupId) },
        {
          $pull: {
            members: { userId: String(userId) }
          }
        }
      );
      
      // Emit socket event for member leaving
      const io = require('./socket').getIO();
      if (io) {
        const remainingMembers = group.members.filter(member => String(member.userId) !== String(userId));
        remainingMembers.forEach(member => {
          io.to(String(member.userId)).emit('group_member_left', {
            groupId: groupId,
            leftUserId: String(userId)
          });
        });
        
        // Emit to the leaving user
        io.to(String(userId)).emit('group_member_left', {
          groupId: groupId,
          leftUserId: String(userId)
        });
      }
    }

    // Clean up related data for the leaving user
    await Promise.all([
      // Remove message read status for this user in this group
      messageReadStatusCollection.deleteMany({
        userId: new ObjectId(userId),
        groupChatId: new ObjectId(groupId)
      })
    ]);

    // Clean up recording queue and recording state for the leaving user
    const { getIO, recordingStates, recordingQueues, pendingRecordingGrants } = require('./socket');
    const io = getIO();
    if (io) {
      // Clean up recording queue and transfer recording if needed
      if (recordingQueues && recordingQueues.has(groupId)) {
        const queue = recordingQueues.get(groupId);
        const userIndex = queue.findIndex(user => user.userId === String(userId));
        if (userIndex !== -1) {
          queue.splice(userIndex, 1);
          console.log('[LeaveGroup] Removed user from recording queue:', {
            userId: String(userId),
            groupId: groupId
          });

          // Update positions for remaining users
          queue.forEach((user, index) => {
            user.position = index + 1;
          });

          // If user was currently recording, transfer to next in queue
          if (recordingStates && recordingStates.has(groupId)) {
            const recordingUsers = recordingStates.get(groupId);
            if (recordingUsers && recordingUsers.has(String(userId))) {
              // User was recording, remove them and transfer to next in queue
              recordingUsers.delete(String(userId));
              console.log('[LeaveGroup] User was recording, transferring to next in queue:', {
                userId: String(userId),
                groupId: groupId,
                queueLength: queue.length
              });

              // If there's someone next in queue, grant them recording
              if (queue.length > 0) {
                const nextUser = queue[0]; // First user in queue
                console.log('[LeaveGroup] Checking next user in queue:', {
                  nextUserId: nextUser.userId,
                  nextUserName: nextUser.userName,
                  isAutoRecording: nextUser.isAutoRecording,
                  groupId: groupId
                });

                // CRITICAL FIX: Grant recording to next user regardless of auto-recording status
                // Get group member count to determine queue processing behavior
                const group = await groupChatsCollection.findOne({ 
                  _id: new ObjectId(groupId)
                }, { 
                  projection: { members: 1 } 
                });

                const memberCount = group?.members?.length || 0;
                const is3PlusPersonChat = memberCount >= 3;
                
                if (!is3PlusPersonChat) {
                  // For 2-person chats, grant recording immediately
                  // CRITICAL FIX: Add the new user to recording state
                  recordingUsers.add(nextUser.userId);

                  // Grant recording permission to next user
                  io.to(groupId).emit('recording_granted', {
                    groupId,
                    userId: nextUser.userId
                  });
                  
                  console.log('[LeaveGroup] Granted recording to next user in 2-person chat:', {
                    nextUserId: nextUser.userId,
                    nextUserName: nextUser.userName,
                    memberCount: memberCount,
                    groupId: groupId
                  });
                } else {
                  // For 3+ person chats, grant recording immediately (no waiting for playback)
                  // CRITICAL FIX: Add the new user to recording state
                  recordingUsers.add(nextUser.userId);

                  // Grant recording permission to next user
                  io.to(groupId).emit('recording_granted', {
                    groupId,
                    userId: nextUser.userId
                  });
                  
                  console.log('[LeaveGroup] Granted recording to next user in 3+ person chat:', {
                    nextUserId: nextUser.userId,
                    nextUserName: nextUser.userName,
                    memberCount: memberCount,
                    groupId: groupId
                  });
                }

                // Remove the user from queue since they're now recording
                queue.shift();
                
                // Update positions for remaining users again
                queue.forEach((user, index) => {
                  user.position = index + 1;
                });
              }

              // Clean up empty recording state
              if (recordingUsers.size === 0) {
                recordingStates.delete(groupId);
              }

              // Broadcast recording state update
              io.to(groupId).emit('recording_state_update', {
                groupId,
                recordingUsers: Array.from(recordingUsers),
                isAnyoneRecording: recordingUsers.size > 0,
                transferredFrom: String(userId)
              });
            }
          }

          // Clean up empty queue or notify remaining users
          if (queue.length === 0) {
            recordingQueues.delete(groupId);
            console.log('[LeaveGroup] Cleaned up empty recording queue for group:', groupId);
          } else {
            // Broadcast queue update to remaining users
            io.to(groupId).emit('recording_queue_updated', {
              groupId,
              queue: queue.slice()
            });
            console.log('[LeaveGroup] Notified remaining users of queue change:', {
              groupId,
              remainingQueueLength: queue.length
            });
          }
        }
              } else {
          // User wasn't in queue, but might still be recording - clean up recording state
          if (recordingStates && recordingStates.has(groupId)) {
            const users = recordingStates.get(groupId);
            if (users.has(String(userId))) {
              users.delete(String(userId));
              console.log('[LeaveGroup] Removed user from recording state (not in queue):', {
                userId: String(userId),
                groupId: groupId
              });
              
              // CRITICAL FIX: Check if there are other users in queue who can take over recording
              if (recordingQueues && recordingQueues.has(groupId)) {
                const queue = recordingQueues.get(groupId);
                if (queue.length > 0) {
                  const nextUser = queue[0];
                  console.log('[LeaveGroup] Granting recording to next user in queue (not in queue case):', {
                    nextUserId: nextUser.userId,
                    nextUserName: nextUser.userName,
                    groupId: groupId
                  });

                  // Add next user to recording state
                  users.add(nextUser.userId);

                  // Remove next user from queue since they're now recording
                  queue.shift();

                  // Update positions for remaining users
                  queue.forEach((user, index) => {
                    user.position = index + 1;
                  });

                  // Grant recording permission to next user
                  io.to(groupId).emit('recording_granted', {
                    groupId,
                    userId: nextUser.userId
                  });

                  // Broadcast queue update to remaining users
                  if (queue.length === 0) {
                    recordingQueues.delete(groupId);
                    console.log('[LeaveGroup] Cleaned up empty recording queue for group:', groupId);
                  } else {
                    io.to(groupId).emit('recording_queue_updated', {
                      groupId,
                      queue: queue.slice()
                    });
                    console.log('[LeaveGroup] Notified remaining users of queue change (not in queue case):', {
                      groupId,
                      remainingQueueLength: queue.length
                    });
                  }

                  console.log('[LeaveGroup] Recording transferred successfully (not in queue case):', {
                    fromUserId: String(userId),
                    toUserId: nextUser.userId,
                    groupId: groupId
                  });
                }
              }
              
              // Clean up empty recording state or notify remaining users
              if (users.size === 0) {
                recordingStates.delete(groupId);
                console.log('[LeaveGroup] Cleaned up empty recording state for group:', groupId);
              } else {
                // Notify remaining users about the recording state change
                io.to(groupId).emit('recording_state_update', {
                  groupId,
                  recordingUsers: Array.from(users),
                  isAnyoneRecording: users.size > 0,
                  leftUser: String(userId)
                });
                console.log('[LeaveGroup] Notified remaining users of recording state change:', {
                  groupId,
                  remainingUsers: Array.from(users)
                });
              }
            }
          }
        }
    }

    res.json({ message: 'Successfully left the group chat' });
  } catch (error) {
    console.error('Error leaving group chat:', error);
    res.status(500).json({ error: 'Failed to leave group chat' });
  }
});

<<<<<<< Updated upstream
=======
// Push Notification Routes
app.post('/api/push/register', async (req, res) => {
  try {
    const { userId, deviceToken, platform = 'ios' } = req.body;
    
    if (!userId || !deviceToken) {
      return res.status(400).json({ error: 'userId and deviceToken are required' });
    }
    
    const result = await storeDeviceToken(userId, deviceToken, platform);
    
    if (result.success) {
      res.json({ message: 'Device token registered successfully' });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error registering device token:', error);
    res.status(500).json({ error: 'Failed to register device token' });
  }
});

app.post('/api/push/send', async (req, res) => {
  try {
    const { userId, title, body, data = {} } = req.body;
    
    if (!userId || !title || !body) {
      return res.status(400).json({ error: 'userId, title, and body are required' });
    }
    
    const result = await sendPushNotificationToUser(userId, title, body, data);
    
    if (result.success) {
      res.json({ message: 'Push notification sent successfully' });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error sending push notification:', error);
    res.status(500).json({ error: 'Failed to send push notification' });
  }
});

// Send a friend request
app.post('/api/friends/request', async (req, res) => {
  console.log('[API][friends/request] Request body:', req.body);
  const { from, to } = req.body;
  if (!from || !to || from === to) {
    console.log('[API][friends/request] Invalid from/to:', { from, to });
    return res.status(400).json({ error: 'Invalid from/to' });
  }
  try {
    // Check if already friends using users collection
    const fromUser = await usersCollection.findOne({ _id: new ObjectId(from) });
    if (fromUser && Array.isArray(fromUser.friends) && fromUser.friends.includes(to)) {
      console.log('[API][friends/request] Already friends:', { from, to });
      return res.status(400).json({ error: 'Already friends' });
    }
    // Check if request already exists
    const existingRequest = await FriendRequest.findOne({ from, to, status: 'pending' });
    if (existingRequest) {
      console.log('[API][friends/request] Request already sent:', { from, to });
      return res.status(400).json({ error: 'Request already sent' });
    }
    // Create request
    await FriendRequest.create({ from, to });
    console.log('[API][friends/request] Friend request created:', { from, to });
    res.json({ message: 'Friend request sent' });
  } catch (err) {
    console.error('[API][friends/request] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get incoming friend requests for a user
app.get('/api/friends/requests', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const requests = await FriendRequest.find({ to: userId, status: 'pending' });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept a friend request (update both users' friends arrays)
app.post('/api/friends/accept', async (req, res) => {
  const { requestId } = req.body;
  if (!requestId) {
    return res.status(400).json({ error: 'Missing requestId' });
  }
  try {
    const request = await FriendRequest.findById(requestId);
    if (!request || request.status !== 'pending') {
      return res.status(404).json({ error: 'Friend request not found or already handled' });
    }
    // Update both users' friends arrays in users collection
    const fromId = request.from;
    const toId = request.to;
    await usersCollection.updateOne(
      { _id: new ObjectId(fromId) },
      { $addToSet: { friends: toId } }
    );
    await usersCollection.updateOne(
      { _id: new ObjectId(toId) },
      { $addToSet: { friends: fromId } }
    );
    request.status = 'accepted';
    await request.save();
    res.json({ message: 'Friend request accepted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

// Reject a friend request
app.post('/api/friends/reject', async (req, res) => {
  const { requestId } = req.body;
  if (!requestId) return res.status(400).json({ error: 'Missing requestId' });
  try {
    const request = await FriendRequest.findById(requestId);
    if (!request || request.status !== 'pending') {
      return res.status(400).json({ error: 'Invalid or already handled request' });
    }
    request.status = 'rejected';
    await request.save();
    res.json({ message: 'Friend request rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get friends list for a user (from users collection)
app.get('/api/friends/list', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.friends || []);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch friends list' });
  }
});

// Twilio Video Calling Routes
app.use(`${API_URL}/twilio`, twilioRoutes);

>>>>>>> Stashed changes
const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0'; // Listen on all network interfaces

// Initialize everything before starting the server
async function startServer() {
  try {
    // First connect to the database
    await connectDB();
    // --- RUNNING MIGRATION: Remove or comment out after first successful run ---
    await migrateGroupChatMemberUserIdsToString();
    // Then initialize Redis Pub/Sub
    await initializePubSub();
    console.log('[Startup] Redis Pub/Sub initialized');
    
    // PHASE 3: Initialize advanced cache service
    const { advancedCacheService } = require('./utils/advancedCacheService');
    await advancedCacheService.initialize();
    console.log('[Startup] Advanced cache service initialized');
    
    // Finally start the HTTP server
    httpServer.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
      console.log('Server is accessible at:');
      console.log(`- Local: http://localhost:${PORT}`);
      console.log(`- Network: http://192.168.5.160:${PORT}`);
    });
  } catch (error) {
    console.error('[Startup] Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

// --- One-time migration script: Convert all members.userId to string ---
async function migrateGroupChatMemberUserIdsToString() {
  console.log('[Migration] Starting migration to convert ObjectIDs to strings...');
  const groupChats = await groupChatsCollection.find({}).toArray();
  let updatedCount = 0;
  let totalMembersUpdated = 0;
  
  for (const chat of groupChats) {
    let needsUpdate = false;
    const updatedMembers = (chat.members || []).map(member => {
      if (typeof member.userId !== 'string') {
        needsUpdate = true;
        totalMembersUpdated++;
        console.log(`[Migration] Converting member userId from ${typeof member.userId} to string:`, {
          chatId: chat._id,
          chatName: chat.name,
          oldUserId: member.userId,
          newUserId: String(member.userId),
          memberName: member.name
        });
        return { ...member, userId: String(member.userId) };
      }
      return member;
    });
    
    if (needsUpdate) {
      await groupChatsCollection.updateOne(
        { _id: chat._id },
        { $set: { members: updatedMembers } }
      );
      updatedCount++;
      console.log(`[Migration] Updated group chat: ${chat.name} (${chat._id})`);
    }
  }
  
  console.log(`[Migration] Completed! Updated ${updatedCount} group chats with ${totalMembersUpdated} total members converted to string userIds.`);
  
  // Verify migration by checking for any remaining ObjectIDs
  const verificationChats = await groupChatsCollection.find({}).toArray();
  let objectIdCount = 0;
  for (const chat of verificationChats) {
    for (const member of chat.members || []) {
      if (typeof member.userId !== 'string') {
        objectIdCount++;
        console.error(`[Migration][VERIFICATION FAILED] Found ObjectID in chat ${chat.name}:`, member.userId);
      }
    }
  }
  
  if (objectIdCount === 0) {
    console.log('[Migration][VERIFICATION PASSED] All member userIds are now strings!');
  } else {
    console.error(`[Migration][VERIFICATION FAILED] Found ${objectIdCount} ObjectIDs remaining!`);
  }
}