const { Server } = require('socket.io');
const { redisClient, incrementUserUnreadCount, resetUserUnreadCount } = require('./utils/redisClient');
const { 
  getCollection,
  ObjectId,
  connectDB 
} = require('./database/collections');
const { performanceMetrics } = require('./utils/performanceMetrics');

let io = null;
let isDBConnected = false;

// Recording state management
const recordingStates = new Map(); // groupId -> Set of userIds currently recording

// Recording queue management
const recordingQueues = new Map(); // groupId -> Array of queued users

const initializeSocket = async (server) => {
  try {
    // Connect to database
    await connectDB();
    isDBConnected = true;
    console.log('[Socket] Database connected successfully');

    // Initialize Socket.IO server
    io = new Server(server, {
      cors: {
        origin: process.env.CLIENT_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    // Middleware to authenticate socket connections
    io.use(async (socket, next) => {
      try {
        const userId = socket.handshake.auth.userId || socket.handshake.query.userId;
        if (!userId) {
          console.error('[Socket][Auth] No userId provided in handshake');
          return next(new Error('Authentication error: No userId provided'));
        }
        
        // Validate that the user exists in the database
        const user = await getCollection('users').findOne({ _id: new ObjectId(userId) });
        if (!user) {
          console.error('[Socket][Auth] User not found in database:', userId);
          return next(new Error('Authentication error: User not found'));
        }
        
        socket.userId = userId;
        next();
      } catch (error) {
        console.error('[Socket][Auth] Authentication error:', error);
        next(new Error('Authentication error: ' + error.message));
      }
    });

    io.on('connection', (socket) => {
      // Join user's personal room for direct messages
      socket.join(socket.userId);

      // CRITICAL FIX: Clean up any stale recording states for this user on connection
      console.log('[Socket][Connect] User connected, cleaning up stale recording states:', {
        userId: socket.userId
      });
      
      let cleanedUpGroups = [];
      recordingStates.forEach((users, groupId) => {
        if (users.has(socket.userId)) {
          users.delete(socket.userId);
          cleanedUpGroups.push(groupId);
          console.log('[Socket][Connect] Removed user from stale recording state:', {
            userId: socket.userId,
            groupId: groupId
          });
          
          // Broadcast recording state update to notify other users
          io.to(groupId).emit('recording_state_update', {
            groupId,
            recordingUsers: Array.from(users),
            isAnyoneRecording: users.size > 0,
            cleanedUpUser: socket.userId
          });
          
          // Clean up empty recording state
          if (users.size === 0) {
            recordingStates.delete(groupId);
            console.log('[Socket][Connect] Cleaned up empty recording state for group:', groupId);
          }
        }
      });

      // Also clean up any stale recording queues for this user
      recordingQueues.forEach((queue, groupId) => {
        const userIndex = queue.findIndex(user => user.userId === socket.userId);
        if (userIndex !== -1) {
          queue.splice(userIndex, 1);
          console.log('[Socket][Connect] Removed user from stale recording queue:', {
            userId: socket.userId,
            groupId: groupId
          });
          
          // Update positions for remaining users
          queue.forEach((user, index) => {
            user.position = index + 1;
          });
          
          // Broadcast queue update to notify other users
          io.to(groupId).emit('recording_queue_updated', {
            groupId,
            queue: queue.slice()
          });
          
          // Clean up empty queue
          if (queue.length === 0) {
            recordingQueues.delete(groupId);
            console.log('[Socket][Connect] Cleaned up empty recording queue for group:', groupId);
          }
        }
      });

      if (cleanedUpGroups.length > 0) {
        console.log('[Socket][Connect] 🧹 RECORDING STATE RESET: Connection cleanup - Cleaned up stale recording states for user:', {
          userId: socket.userId,
          cleanedUpGroups: cleanedUpGroups,
          reason: 'user_connection_cleanup'
        });
      } else {
        console.log('[Socket][Connect] ℹ️ No stale recording states to clean up for user:', {
          userId: socket.userId,
          reason: 'no_stale_states'
        });
      }

      // Join a group chat
      socket.on('join_chat', async (groupId) => {
        try {
          // Validate that the user is a member of this group
          const group = await getCollection('groupChats').findOne({ 
            _id: new ObjectId(groupId),
            'members.userId': String(socket.userId)
          });

          if (!group) {
            console.error('[Socket][Join] User not a member of group:', {
              userId: socket.userId,
              groupId: groupId
            });
            return;
          }

          // Join the group chat room
          socket.join(groupId);
          console.log('[Socket][Join] User joined chat:', {
            userId: socket.userId,
            groupId: groupId
          });

          // CRITICAL FIX: Remove user from recording state when they join (fresh start)
          if (recordingStates.has(groupId)) {
            const recordingUsers = recordingStates.get(groupId);
            if (recordingUsers.has(socket.userId)) {
              recordingUsers.delete(socket.userId);
              console.log('[Socket][Join] 🧹 RECORDING STATE RESET: Removed user from recording state for fresh start:', {
                userId: socket.userId,
                groupId: groupId,
                remainingUsers: Array.from(recordingUsers),
                reason: 'user_joined_chat'
              });
              
              // Clean up empty recording state
              if (recordingUsers.size === 0) {
                recordingStates.delete(groupId);
                console.log('[Socket][Join] 🧹 RECORDING STATE RESET: Cleaned up empty recording state:', {
                  groupId,
                  reason: 'no_users_remaining'
                });
              }
            } else {
              console.log('[Socket][Join] ℹ️ User not in recording state, no cleanup needed:', {
                userId: socket.userId,
                groupId: groupId,
                currentRecordingUsers: Array.from(recordingUsers)
              });
            }
          } else {
            console.log('[Socket][Join] ℹ️ No recording state exists for group:', {
              userId: socket.userId,
              groupId: groupId
            });
          }

          // CRITICAL FIX: Send current recording state to the user who just joined
          if (recordingStates.has(groupId)) {
            const currentRecordingUsers = Array.from(recordingStates.get(groupId));
            
            // CRITICAL FIX: Validate that recording users are actually connected
            const connectedSockets = await io.in(groupId).fetchSockets();
            const connectedUserIds = connectedSockets.map(s => s.userId);
            // FIXED: Don't treat joining user as special - they should start recording fresh
            const validRecordingUsers = currentRecordingUsers.filter(userId => 
              connectedUserIds.includes(userId) && userId !== socket.userId
            );
            
            // Clean up stale recording states
            if (validRecordingUsers.length !== currentRecordingUsers.length) {
              console.log('[Socket][Join] 🧹 RECORDING STATE RESET: Cleaning up stale recording states:', {
                groupId,
                staleUsers: currentRecordingUsers.filter(userId => !connectedUserIds.includes(userId)),
                validUsers: validRecordingUsers,
                connectedUserIds,
                reason: 'stale_users_cleanup'
              });
              
              if (validRecordingUsers.length === 0) {
                recordingStates.delete(groupId);
                console.log('[Socket][Join] 🧹 RECORDING STATE RESET: Deleted entire recording state (no valid users):', {
                  groupId,
                  reason: 'no_valid_users'
                });
              } else {
                recordingStates.set(groupId, new Set(validRecordingUsers));
                console.log('[Socket][Join] 🧹 RECORDING STATE RESET: Updated recording state with valid users:', {
                  groupId,
                  validUsers: validRecordingUsers,
                  reason: 'filtered_valid_users'
                });
              }
            }
            
            const isAnyoneRecording = validRecordingUsers.length > 0;
            
            console.log('[Socket][Join] Sending current recording state to user:', {
              userId: socket.userId,
              groupId: groupId,
              recordingUsers: validRecordingUsers,
              isAnyoneRecording: isAnyoneRecording
            });

            // Send recording state to the user who just joined
            socket.emit('recording_state_update', {
              groupId,
              recordingUsers: validRecordingUsers,
              isAnyoneRecording: isAnyoneRecording
            });
          } else {
            // No recording state exists, send empty state to ensure client is initialized
            console.log('[Socket][Join] Sending empty recording state to user:', {
              userId: socket.userId,
              groupId: groupId
            });

            socket.emit('recording_state_update', {
              groupId,
              recordingUsers: [],
              isAnyoneRecording: false
            });
          }

          // Also send current recording queue state if it exists
          if (recordingQueues.has(groupId)) {
            const queue = recordingQueues.get(groupId);
            console.log('[Socket][Join] Sending current queue state to user:', {
              userId: socket.userId,
              groupId: groupId,
              queueLength: queue.length
            });
            
            socket.emit('recording_queue_updated', {
              groupId,
              queue: queue.slice() // Send a copy
            });
          }

        } catch (error) {
          console.error('[Socket][Join] Error joining chat:', error);
        }
      });

      // Leave a group chat
      socket.on('leave_chat', (groupId) => {
        socket.leave(groupId);
        console.log('[Socket][Leave] User left chat:', {
          userId: socket.userId,
          groupId: groupId
        });
      });

      // Handle recording start events
      socket.on('recording_start', async (data) => {
        try {
          const { groupId } = data;
          console.log('[Socket][Recording] User started recording:', {
            userId: socket.userId,
            groupId: groupId
          });

          // CRITICAL FIX: Ensure user is in the room before starting recording
          socket.join(groupId);

          // Initialize recording state for this group if it doesn't exist
          if (!recordingStates.has(groupId)) {
            recordingStates.set(groupId, new Set());
          }

          const currentRecordingUsers = recordingStates.get(groupId);
          
          // CRITICAL FIX: Check if user is already recording to prevent duplicates
          if (currentRecordingUsers.has(socket.userId)) {
            console.log('[Socket][Recording] 🚫 User already recording, ignoring duplicate request:', {
              userId: socket.userId,
              groupId: groupId,
              currentRecordingUsers: Array.from(currentRecordingUsers)
            });
            return;
          }
          
          console.log('[Socket][Recording] ℹ️ User not currently recording, proceeding with start:', {
            userId: socket.userId,
            groupId: groupId,
            currentRecordingUsers: Array.from(currentRecordingUsers)
          });
          
          // CRITICAL FIX: Validate that recording users are actually connected before checking conflicts
          const connectedSockets = await io.in(groupId).fetchSockets();
          const connectedUserIds = connectedSockets.map(s => s.userId);
          
          console.log('[Socket][Recording] Connection validation:', {
            groupId,
            requestingUser: socket.userId,
            connectedUserIds,
            currentRecordingUsers: Array.from(currentRecordingUsers)
          });
          
          // FIXED: Don't treat requesting user as special - clean validation
          const validRecordingUsers = Array.from(currentRecordingUsers).filter(userId => 
            connectedUserIds.includes(userId) && userId !== socket.userId
          );
          
          // Clean up stale recording states
          if (validRecordingUsers.length !== currentRecordingUsers.size) {
            console.log('[Socket][Recording] 🧹 RECORDING STATE RESET: Cleaning up stale recording states before validation:', {
              groupId,
              staleUsers: Array.from(currentRecordingUsers).filter(userId => !connectedUserIds.includes(userId)),
              validUsers: validRecordingUsers,
              connectedUserIds,
              reason: 'pre_validation_cleanup'
            });
            
            if (validRecordingUsers.length === 0) {
              recordingStates.delete(groupId);
              console.log('[Socket][Recording] 🧹 RECORDING STATE RESET: Deleted entire recording state (no valid users):', {
                groupId,
                reason: 'no_valid_users_pre_validation'
              });
            } else {
              recordingStates.set(groupId, new Set(validRecordingUsers));
              console.log('[Socket][Recording] 🧹 RECORDING STATE RESET: Updated recording state with valid users:', {
                groupId,
                validUsers: validRecordingUsers,
                reason: 'filtered_valid_users_pre_validation'
              });
            }
          }
          
          // CRITICAL FIX: Check if user is already recording to prevent duplicates
          if (validRecordingUsers.includes(socket.userId)) {
            console.log('[Socket][Recording] User already recording, ignoring duplicate request:', {
              userId: socket.userId,
              groupId: groupId
            });
            return;
          }

          // Check if anyone else is recording in this group (using validated users)
          const otherRecordingUsers = validRecordingUsers.filter(userId => userId !== socket.userId);

          if (otherRecordingUsers.length > 0) {
            console.log('[Socket][Recording] Another user is already recording:', {
              userId: socket.userId,
              groupId: groupId,
              otherRecordingUsers: otherRecordingUsers
            });

            // Reject the recording request
            socket.emit('recording_rejected', {
              groupId,
              reason: 'Another user is already recording',
              currentRecordingUsers: otherRecordingUsers
            });
            
            return;
          }

          // Add user to recording state (ensure we have a clean state)
          if (!recordingStates.has(groupId)) {
            recordingStates.set(groupId, new Set());
          }
          recordingStates.get(groupId).add(socket.userId);

          // CRITICAL FIX: Remove user from queue when they start recording
          if (recordingQueues.has(groupId)) {
            const queue = recordingQueues.get(groupId);
            const userIndex = queue.findIndex(user => user.userId === socket.userId);
            if (userIndex !== -1) {
              queue.splice(userIndex, 1);
              console.log('[Socket][Recording] Removed user from queue after starting recording:', {
                userId: socket.userId,
                groupId: groupId,
                removedFromPosition: userIndex + 1,
                newQueueLength: queue.length
              });

              // Update positions for remaining users
              queue.forEach((user, index) => {
                user.position = index + 1;
              });

              // Broadcast queue update to all users in the group
              io.to(groupId).emit('recording_queue_updated', {
                groupId,
                queue: queue.slice() // Send a copy
              });
            }
          }

          console.log('[Socket][Recording] Updated recording state:', {
            groupId,
            recordingUsers: Array.from(recordingStates.get(groupId)),
            totalRecording: recordingStates.get(groupId).size
          });

          // Broadcast recording state update to all users in the group
          io.to(groupId).emit('recording_state_update', {
            groupId,
            recordingUsers: Array.from(recordingStates.get(groupId)),
            isAnyoneRecording: recordingStates.get(groupId).size > 0,
            startedBy: socket.userId
          });

        } catch (error) {
          console.error('[Socket][Recording] Error handling recording start:', error);
        }
      });

      // Handle recording stop events
      socket.on('recording_stop', async (data) => {
        try {
          const { groupId, reason } = data;
          const userId = socket.userId;

          console.log('[Socket][RecordingStop] Received stop request:', { userId, groupId, reason });

          // CRITICAL FIX: Only process stop event if user was actually recording
          const groupRecordingState = recordingStates.get(groupId);
          if (!groupRecordingState || !groupRecordingState.has(userId)) {
            console.warn('[Socket][RecordingStop] ⚠️ Ignored stop event because user was not in recording state:', { userId, groupId });
            return;
          }

          // User was recording, so remove them
          groupRecordingState.delete(userId);
          console.log('[Socket][RecordingStop] ✅ User removed from recording state:', { userId, groupId, remaining: Array.from(groupRecordingState) });

          // Clean up the group state if no one is left recording
          if (groupRecordingState.size === 0) {
            recordingStates.delete(groupId);
            console.log('[Socket][RecordingStop] 🧹 No users left recording, deleted state for group:', { groupId });
          }

          // Broadcast the definitive new state to all clients in the room
          const finalRecordingUsers = recordingStates.has(groupId) ? Array.from(recordingStates.get(groupId)) : [];
          const isAnyoneRecording = finalRecordingUsers.length > 0;

          console.log('[Socket][RecordingStop] 📡 Broadcasting final state update:', { groupId, finalRecordingUsers, isAnyoneRecording, stoppedBy: userId });

          io.to(groupId).emit('recording_state_update', {
            groupId,
            recordingUsers: finalRecordingUsers,
            isAnyoneRecording,
            stoppedBy: userId
          });

        } catch (error) {
          console.error('[Socket][RecordingStop] 🚨 Error handling recording stop:', error);
        }
      });

      // Handle recording queue join
      socket.on('join_recording_queue', async (data) => {
        try {
          const { groupId, userId, userName, timestamp, isAutoRecording } = data;
          console.log('[Socket][Queue] User joining recording queue:', {
            userId: socket.userId,
            requestedUserId: userId,
            groupId: groupId,
            isAutoRecording: isAutoRecording || false
          });

          // Validate that the user is a member of this group
          const group = await getCollection('groupChats').findOne({ 
            _id: new ObjectId(groupId),
            'members.userId': String(socket.userId)
          });

          if (!group) {
            console.error('[Socket][Queue] User not a member of group:', {
              userId: socket.userId,
              groupId: groupId
            });
            return;
          }

          // Initialize queue for this group if it doesn't exist
          if (!recordingQueues.has(groupId)) {
            recordingQueues.set(groupId, []);
          }

          const queue = recordingQueues.get(groupId);
          
          // Check if user is already in queue
          const existingIndex = queue.findIndex(user => user.userId === socket.userId);
          if (existingIndex !== -1) {
            console.log('[Socket][Queue] User already in queue:', {
              userId: socket.userId,
              groupId: groupId,
              position: existingIndex + 1
            });
            return;
          }

          // Add user to queue
          const queuedUser = {
            userId: socket.userId,
            userName: userName || `User ${socket.userId}`,
            timestamp: timestamp || Date.now(),
            isAutoRecording: isAutoRecording || false
          };

          queue.push(queuedUser);

          // Update positions for all users in queue
          queue.forEach((user, index) => {
            user.position = index + 1;
          });

          console.log('[Socket][Queue] User added to queue:', {
            userId: socket.userId,
            groupId: groupId,
            position: queuedUser.position,
            queueLength: queue.length,
            finalPositions: queue.map(u => ({ userId: u.userId, position: u.position }))
          });

          // Broadcast queue update to all users in the group
          io.to(groupId).emit('recording_queue_updated', {
            groupId,
            queue: queue.slice() // Send a copy
          });

          // After updating positions for all users in queue
          console.log('[Socket][Queue][ENHANCED] Queue state:', {
            groupId,
            queue: queue.map(u => ({ userId: u.userId, position: u.position })),
            queueLength: queue.length
          });

          // If user is first in queue and no one is recording, grant recording immediately
          if (queuedUser.position === 1) {
            const currentRecordingUsers = recordingStates.get(groupId) || new Set();
            if (currentRecordingUsers.size === 0) {
          
              
              // Grant recording permission
              socket.emit('recording_granted', {
                groupId,
                userId: socket.userId
              });
            }
          }

        } catch (error) {
          console.error('[Socket][Queue] Error handling join recording queue:', error);
        }
      });

      // Handle recording queue leave
      socket.on('leave_recording_queue', async (data) => {
        try {
          const { groupId, userId } = data;
          console.log('[Socket][Queue] User leaving recording queue:', {
            userId: socket.userId,
            requestedUserId: userId,
            groupId: groupId
          });

          // Validate that the user is a member of this group
          const group = await getCollection('groupChats').findOne({ 
            _id: new ObjectId(groupId),
            'members.userId': String(socket.userId)
          });

          if (!group) {
            console.error('[Socket][Queue] User not a member of group:', {
              userId: socket.userId,
              groupId: groupId
            });
            return;
          }

          if (!recordingQueues.has(groupId)) {
            console.log('[Socket][Queue] No queue exists for group:', groupId);
            return;
          }

          const queue = recordingQueues.get(groupId);
          const userIndex = queue.findIndex(user => user.userId === socket.userId);
          
          if (userIndex === -1) {
            console.log('[Socket][Queue] User not in queue:', {
              userId: socket.userId,
              groupId: groupId
            });
            return;
          }

          // Remove user from queue
          queue.splice(userIndex, 1);

          // Update positions for remaining users
          queue.forEach((user, index) => {
            user.position = index + 1;
          });

          console.log('[Socket][Queue] User removed from queue:', {
            userId: socket.userId,
            groupId: groupId,
            newQueueLength: queue.length,
            updatedPositions: queue.map(u => ({ userId: u.userId, position: u.position }))
          });

          // If user was currently recording, transfer to next in queue
          if (recordingStates.has(groupId)) {
            const recordingUsers = recordingStates.get(groupId);
            if (recordingUsers && recordingUsers.has(socket.userId)) {
              console.log('[Socket][Queue] User was recording, but not auto-granting to next in queue (client will handle after playback):', {
                userId: socket.userId,
                groupId: groupId,
                queueLength: queue.length
              });

              // Remove the leaving user from recording state
              recordingUsers.delete(socket.userId);

              // DO NOT auto-grant recording to next user - let client handle after playback
              // The client-side queue manager will handle progression after playback finishes

              // Clean up empty recording state
              if (recordingUsers.size === 0) {
                recordingStates.delete(groupId);
              }

              // Broadcast recording state update
              io.to(groupId).emit('recording_state_update', {
                groupId,
                recordingUsers: Array.from(recordingUsers),
                isAnyoneRecording: recordingUsers.size > 0,
                transferredFrom: socket.userId
              });
            }
          }

          // Clean up empty queue
          if (queue.length === 0) {
            recordingQueues.delete(groupId);
          }

          // Broadcast queue update to all users in the group
          io.to(groupId).emit('recording_queue_updated', {
            groupId,
            queue: queue.slice() // Send a copy
          });

          // After updating positions for all users in queue
          console.log('[Socket][Queue][ENHANCED] Queue state:', {
            groupId,
            queue: queue.map(u => ({ userId: u.userId, position: u.position })),
            queueLength: queue.length
          });

        } catch (error) {
          console.error('[Socket][Queue] Error handling leave recording queue:', error);
        }
      });

      // NOTE: recording_ended handler removed - queue processing is now handled directly in recording_stop handler
      // This prevents duplicate queue processing and ensures proper queue progression

      // OPTIMIZATION: Remove duplicate new_message handler - API endpoints handle message creation
      // This eliminates duplicate DB operations and improves performance

      // Handle message read events
      socket.on('message_read', async (data) => {
        const startTime = Date.now();
        try {
          const { messageId, userId, chatId } = data;
          console.log('[Socket][Backend] Received message_read event:', {
            messageId,
            userId,
            chatId
          });

          // Don't process read status for message sender
          const message = await getCollection('recordedMessages').findOne({ _id: new ObjectId(messageId) });
          if (!message) {
            console.error('[Socket][Backend] Message not found:', messageId);
            return;
          }

          if (message.senderId === userId) {
        
            return;
          }

          // STABILITY FIX: Check if message is already read by this user with proper validation
          const isAlreadyRead = message.readBy && message.readBy[userId];
          if (isAlreadyRead) {
        
            return;
          }

          // STABILITY FIX: Additional check to prevent rapid-fire read updates
          const currentTime = new Date();
          const existingReadTime = message.readBy?.[userId];
          if (existingReadTime) {
            const timeDiff = Math.abs(currentTime.getTime() - new Date(existingReadTime).getTime());
            if (timeDiff < 1000) { // Less than 1 second apart
          
              return;
            }
          }

          console.log('[Socket][Backend] Updating message read status:', {
            messageId,
            userId,
            chatId,
            currentReadBy: Object.keys(message.readBy || {})
          });

          // Update message read status
          const readTimestamp = currentTime;
          await getCollection('recordedMessages').updateOne(
            { _id: new ObjectId(messageId) },
            { 
              $set: { 
                [`readBy.${userId}`]: readTimestamp
              }
            }
          );

          // Get the group to determine total member count and calculate isFullyRead
          const group = await getCollection('groupChats').findOne({ _id: new ObjectId(chatId) });
          if (!group) {
            console.error('[Socket][Backend] Group not found for isFullyRead calculation:', chatId);
            return;
          }

          // Get updated message to check read status
          const updatedMessage = await getCollection('recordedMessages').findOne({ _id: new ObjectId(messageId) });
          
          // Calculate if message is fully read:
          // A message is fully read when ALL RECIPIENTS (excluding sender) have read it
          // The sender is automatically in readBy, so we need to check if all OTHER members have read it
          const totalMembers = group.members.length;
          const readByCount = Object.keys(updatedMessage?.readBy || {}).length;
          
          // For a message to be fully read, ALL members (sender + recipients) must have read it
          // Since sender is automatically added to readBy when message is created,
          // we need readByCount to equal totalMembers
          const isFullyRead = readByCount >= totalMembers;
          
          // Additional validation: ensure we're not marking as fully read prematurely
          // Check that all group members (except sender) are actually in readBy
          const senderId = updatedMessage.senderId.toString();
          const recipientIds = group.members
            .filter(member => member.userId.toString() !== senderId)
            .map(member => member.userId.toString());
          
          const recipientsWhoRead = recipientIds.filter(recipientId => 
            updatedMessage.readBy && updatedMessage.readBy[recipientId]
          );
          
          // Override isFullyRead if not all recipients have actually read it
          const allRecipientsRead = recipientsWhoRead.length === recipientIds.length;
          const finalIsFullyRead = isFullyRead && allRecipientsRead;

          // Update the isRead field based on whether all recipients have read it
          await getCollection('recordedMessages').updateOne(
            { _id: new ObjectId(messageId) },
            { 
              $set: { 
                isRead: finalIsFullyRead
              }
            }
          );

          console.log('[Socket][Backend] Read status calculation:', {
            messageId,
            totalMembers,
            readByCount,
            recipientIds,
            recipientsWhoRead: recipientsWhoRead.length,
            allRecipientsRead,
            isFullyRead,
            finalIsFullyRead,
            readBy: Object.keys(updatedMessage?.readBy || {})
          });

          // Update messageReadStatus collection for tracking
          const existingStatus = await getCollection('messageReadStatus').findOne({
            userId: new ObjectId(userId),
            groupChatId: new ObjectId(chatId),
            messageId: new ObjectId(messageId)
          });

          if (!existingStatus) {
            await getCollection('messageReadStatus').insertOne({
              userId: new ObjectId(userId),
              groupChatId: new ObjectId(chatId),
              messageId: new ObjectId(messageId),
              readAt: readTimestamp
            });
        
          } else {
        
          }

          // Emit read update to all users in the chat
          io.to(chatId).emit('message_read_update', {
            messageId,
            userId,
            timestamp: readTimestamp,
            isFullyRead: finalIsFullyRead
          });

          console.log('[Socket][Backend] Emitting message_read_update to chatId:', chatId, {
            messageId,
            userId,
            isFullyRead: finalIsFullyRead,
            readByCount: Object.keys(updatedMessage?.readBy || {}).length
          });

          // Update unread count for the user
          try {
            const newCount = await resetUserUnreadCount(chatId, userId);
            io.to(userId).emit('unread_count_update', {
              chatId,
              userId,
              unreadCount: newCount
            });
          } catch (error) {
            console.error('[Socket][Backend] Error updating unread count:', error);
          }

          console.log('[Socket][Backend] Successfully processed read receipt for message:', messageId);
          
          // PHASE 3: Track socket event performance
          const latency = Date.now() - startTime;
          performanceMetrics.trackSocketEvent('message_read', latency);
          
        } catch (error) {
          console.error('[Socket][Backend] Error processing message read:', error);
        }
      });

      // Handle message viewed events (real-time read receipts)
      socket.on('message_viewed', async (data) => {
        const startTime = Date.now();
        try {
          const { messageId, userId, chatId } = data;
          console.log('[Socket][Backend] Received message_viewed event:', {
            messageId,
            userId,
            chatId
          });

          // Don't process view status for message sender
          const message = await getCollection('recordedMessages').findOne({ _id: new ObjectId(messageId) });
          if (!message) {
            console.error('[Socket][Backend] Message not found for viewing:', messageId);
            return;
          }

          if (message.senderId === userId) {
        
            return;
          }

          // STABILITY FIX: Check if message is already read by this user with proper validation
          const isAlreadyRead = message.readBy && message.readBy[userId];
          if (isAlreadyRead) {
        
            return;
          }

          // STABILITY FIX: Additional check to prevent rapid-fire view updates
          const currentViewTime = new Date();
          const existingReadTime = message.readBy?.[userId];
          if (existingReadTime) {
            const timeDiff = Math.abs(currentViewTime.getTime() - new Date(existingReadTime).getTime());
            if (timeDiff < 1000) { // Less than 1 second apart
          
              return;
            }
          }

          console.log('[Socket][Backend] Processing message view for real-time read receipt:', {
            messageId,
            userId,
            chatId
          });

          // Update message read status immediately for real-time viewing
          const readTimestamp = currentViewTime;
          await getCollection('recordedMessages').updateOne(
            { _id: new ObjectId(messageId) },
            { 
              $set: { 
                [`readBy.${userId}`]: readTimestamp
              }
            }
          );

          // Get the group to determine total member count
          const group = await getCollection('groupChats').findOne({ _id: new ObjectId(chatId) });
          if (!group) {
            console.error('[Socket][Backend] Group not found for message_viewed:', chatId);
            return;
          }

          // Get updated message to check read status
          const updatedMessage = await getCollection('recordedMessages').findOne({ _id: new ObjectId(messageId) });
          
          // Calculate if message is fully read (same logic as message_read event)
          const totalMembers = group.members.length;
          const readByCount = Object.keys(updatedMessage?.readBy || {}).length;
          
          // For a message to be fully read, ALL members (sender + recipients) must have read it
          // Since sender is automatically added to readBy when message is created,
          // we need readByCount to equal totalMembers
          const isFullyRead = readByCount >= totalMembers;
          
          // Additional validation: ensure we're not marking as fully read prematurely
          // Check that all group members (except sender) are actually in readBy
          const senderId = updatedMessage.senderId.toString();
          const recipientIds = group.members
            .filter(member => member.userId.toString() !== senderId)
            .map(member => member.userId.toString());
          
          const recipientsWhoRead = recipientIds.filter(recipientId => 
            updatedMessage.readBy && updatedMessage.readBy[recipientId]
          );
          
          // Override isFullyRead if not all recipients have actually read it
          const allRecipientsRead = recipientsWhoRead.length === recipientIds.length;
          const finalIsFullyRead = isFullyRead && allRecipientsRead;

          // Update the isRead field
          await getCollection('recordedMessages').updateOne(
            { _id: new ObjectId(messageId) },
            { 
              $set: { 
                isRead: finalIsFullyRead
              }
            }
          );

          console.log('[Socket][Backend] Real-time view processed:', {
            messageId,
            totalMembers,
            readByCount,
            recipientIds,
            recipientsWhoRead: recipientsWhoRead.length,
            allRecipientsRead,
            isFullyRead,
            finalIsFullyRead
          });

          // Update messageReadStatus collection
          const existingStatus = await getCollection('messageReadStatus').findOne({
            userId: new ObjectId(userId),
            groupChatId: new ObjectId(chatId),
            messageId: new ObjectId(messageId)
          });

          if (!existingStatus) {
            await getCollection('messageReadStatus').insertOne({
              userId: new ObjectId(userId),
              groupChatId: new ObjectId(chatId),
              messageId: new ObjectId(messageId),
              readAt: readTimestamp
            });
        
          }

          // Emit read update to all users in the chat for immediate UI update
          io.to(chatId).emit('message_read_update', {
            messageId,
            userId,
            timestamp: readTimestamp,
            isFullyRead: finalIsFullyRead
          });

          console.log('[Socket][Backend] Emitted real-time message_read_update:', {
            messageId,
            userId,
            isFullyRead: finalIsFullyRead
          });

          // Update unread count
          try {
            const newCount = await resetUserUnreadCount(chatId, userId);
            io.to(userId).emit('unread_count_update', {
              chatId,
              userId,
              unreadCount: newCount
            });
          } catch (error) {
            console.error('[Socket][Backend] Error updating unread count for message_viewed:', error);
          }

          // Note: Cache invalidation removed for better read receipt performance
          
          // PHASE 3: Track socket event performance
          const latency = Date.now() - startTime;
          performanceMetrics.trackSocketEvent('message_viewed', latency);

        } catch (error) {
          console.error('[Socket][Backend] Error processing message_viewed:', error);
        }
      });

      // Handle message acknowledgment events
      socket.on('message_acknowledged', async (data) => {
        try {
          const { messageId, userId, groupChatId, timestamp } = data;
          console.log('[Socket][Ack] Message acknowledgment received:', {
            messageId,
            userId,
            groupChatId,
            timestamp,
            socketUserId: socket.userId
          });

          // Validate that the acknowledgment is from the correct user
          if (userId !== socket.userId) {
            console.warn('[Socket][Ack] User ID mismatch in acknowledgment:', {
              expected: socket.userId,
              received: userId,
              messageId
            });
            return;
          }

          // Update message delivery status in database
          const recordedMessagesCollection = getCollection('recordedMessages');
          
          await recordedMessagesCollection.updateOne(
            { _id: new ObjectId(messageId) },
            { 
              $set: { 
                [`deliveredTo.${userId}`]: timestamp || new Date()
              }
            }
          );

          console.log('[Socket][Ack] Message delivery status updated:', {
            messageId,
            userId,
            groupChatId
          });

          // Emit acknowledgment confirmation to the group
          io.to(groupChatId).emit('message_delivery_confirmed', {
            messageId,
            userId,
            groupChatId,
            timestamp: timestamp || new Date()
          });

        } catch (error) {
          console.error('[Socket][Ack] Error handling message acknowledgment:', error);
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        const userRooms = Array.from(socket.rooms).filter(room => room !== socket.id);

        console.log(`[Socket][Disconnect] User ${socket.userId} disconnected. Cleaning up rooms:`, userRooms);

        for (const groupId of userRooms) {
            let wasRecording = false;

            // Clean up recording state
            if (recordingStates.has(groupId)) {
                const users = recordingStates.get(groupId);
                if (users.has(socket.userId)) {
                    wasRecording = true;
                    users.delete(socket.userId);
                    console.log(`[Socket][Disconnect] Removed user ${socket.userId} from recording state of group ${groupId}.`);

                    if (users.size === 0) {
                        recordingStates.delete(groupId);
                        console.log(`[Socket][Disconnect] Cleaned up empty recording state for group ${groupId}.`);
                    }
                }
            }

            // Clean up recording queue
            let userWasInQueue = false;
            if (recordingQueues.has(groupId)) {
                const queue = recordingQueues.get(groupId);
                const userIndexInQueue = queue.findIndex(user => user.userId === socket.userId);

                if (userIndexInQueue !== -1) {
                    userWasInQueue = true;
                    queue.splice(userIndexInQueue, 1);
                    console.log(`[Socket][Disconnect] Removed user ${socket.userId} from recording queue of group ${groupId}.`);
                    
                    if (queue.length === 0) {
                        recordingQueues.delete(groupId);
                        console.log(`[Socket][Disconnect] Cleaned up empty recording queue for group ${groupId}.`);
                    } else {
                        // Update positions for remaining users
                        queue.forEach((user, index) => {
                            user.position = index + 1;
                        });
                    }
                }
            }
            
            // If the user was recording, try to transfer ownership to the next person in the queue
            if (wasRecording) {
                const queue = recordingQueues.get(groupId);
                if (queue && queue.length > 0) {
                    const nextUser = queue.shift(); // Get and remove the next user from the queue
                    const recordingUsers = recordingStates.get(groupId) || new Set();
                    recordingUsers.add(nextUser.userId);
                    recordingStates.set(groupId, recordingUsers);
                    
                    console.log(`[Socket][Disconnect] Transferring recording to next user in queue: ${nextUser.userId} in group ${groupId}`);

                    io.to(groupId).emit('recording_granted', {
                        groupId,
                        userId: nextUser.userId
                    });

                    // Update remaining queue positions
                    queue.forEach((user, index) => {
                        user.position = index + 1;
                    });
                }
            }

            // Always broadcast updates if the user was either recording or in the queue
            if (wasRecording || userWasInQueue) {
                 const currentRecordingUsers = recordingStates.get(groupId) || new Set();
                 io.to(groupId).emit('recording_state_update', {
                    groupId,
                    recordingUsers: Array.from(currentRecordingUsers),
                    isAnyoneRecording: currentRecordingUsers.size > 0,
                    disconnectedUser: socket.userId
                });

                const currentQueue = recordingQueues.get(groupId) || [];
                io.to(groupId).emit('recording_queue_updated', {
                    groupId,
                    queue: currentQueue
                });
            }
        }
      });

      // Debug endpoint to check room membership
      socket.on('debug_rooms', () => {
        const rooms = Array.from(socket.rooms);

        socket.emit('debug_rooms_response', { rooms });
      });

      // Test event handler
      socket.on('test', (data) => {
    
        socket.emit('test', { 
          message: 'Test response received', 
          timestamp: new Date().toISOString(),
          userId: socket.userId 
        });
      });

      // Manual reset recording state for a group
      socket.on('reset_recording_state', async (data) => {
        try {
          const { groupId } = data;
          console.log('[Socket][Reset] User requested recording state reset:', {
            userId: socket.userId,
            groupId: groupId
          });

          // Validate that the user is a member of this group
          const group = await getCollection('groupChats').findOne({ 
            _id: new ObjectId(groupId),
            'members.userId': String(socket.userId)
          });

          if (!group) {
            console.error('[Socket][Reset] User not a member of group:', {
              userId: socket.userId,
              groupId: groupId
            });
            return;
          }

          // Clear recording state for this group
          if (recordingStates.has(groupId)) {
            const previousUsers = Array.from(recordingStates.get(groupId));
            recordingStates.delete(groupId);
            console.log('[Socket][Reset] 🧹 RECORDING STATE RESET: Manual reset - Cleared recording state for group:', {
              groupId,
              previousUsers,
              resetBy: socket.userId,
              reason: 'manual_reset_request'
            });
          } else {
            console.log('[Socket][Reset] ℹ️ No recording state to reset for group:', {
              groupId,
              resetBy: socket.userId,
              reason: 'no_state_exists'
            });
          }

          // Broadcast recording state update to all users in the group
          io.to(groupId).emit('recording_state_update', {
            groupId,
            recordingUsers: [],
            isAnyoneRecording: false,
            resetBy: socket.userId
          });

          console.log('[Socket][Reset] 🧹 RECORDING STATE RESET: Manual reset completed and broadcasted:', {
            groupId,
            resetBy: socket.userId,
            reason: 'manual_reset_completed'
          });

        } catch (error) {
          console.error('[Socket][Reset] Error resetting recording state:', error);
        }
      });
    });

    return io;
  } catch (error) {
    console.error('Error initializing socket:', error, {
      errorStack: error.stack
    });
    throw error;
  }
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
  recordingStates,
  recordingQueues
}; 