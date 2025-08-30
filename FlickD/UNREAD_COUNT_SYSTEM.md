# Unread Count System

This document describes the implementation of the unread count system for group chats in ChitChat.

## Overview

The unread count system tracks the number of unread messages for each user in each group chat. It ensures that:

1. **Senders don't get unread counts** for their own messages
2. **Receivers get unread counts** when new messages arrive
3. **Unread counts reset to 0** when a user opens a chat
4. **Real-time updates** are sent via WebSocket for immediate UI updates

## Architecture

### Data Storage

- **Redis**: Primary storage for unread counts using hash structure
  - Key: `unread:{groupId}`
  - Field: `{userId}`
  - Value: `{count}` (number of unread messages)

- **MongoDB**: Fallback storage and message read status tracking
  - `messageReadStatus` collection: Tracks last read timestamps
  - `recordedMessages` collection: Message data with read status

### Key Components

1. **Redis Utility Functions** (`server/utils/redisClient.js`)
   - `incrementUserUnreadCount(groupChatId, userId)`: Increment unread count
   - `getUserUnreadCount(groupChatId, userId)`: Get unread count
   - `resetUserUnreadCount(groupChatId, userId)`: Reset to 0
   - `getTotalUnreadCount(userId, groupChats)`: Get total across all chats

2. **Socket Handler** (`server/socket.js`)
   - Handles real-time message sending via `new_message` event
   - Updates unread counts for receivers only
   - Emits `unread_count_update` events to affected users

3. **API Endpoints** (`server/index.js`)
   - `/api/messages`: Creates messages and updates unread counts
   - `/api/groupchats`: Returns group chats with unread counts
   - `/api/groupchats/:groupId/mark-all-read`: Resets unread counts

4. **Frontend Context** (`app/context/GroupChatContext.tsx`)
   - Listens for `unread_count_update` events
   - Updates local state for real-time UI updates
   - Handles chat selection and read status marking

## Message Flow

### When a Message is Sent

1. **Message Creation**: Message is saved to MongoDB
2. **Group Lookup**: Get all group members
3. **Receiver Identification**: Filter out the sender
4. **Unread Count Update**: Increment Redis counters for receivers
5. **Real-time Notification**: Emit `unread_count_update` events
6. **Message Broadcast**: Emit `new_message` event to all members

### When a User Opens a Chat

1. **Chat Selection**: User selects a group chat
2. **Read Status Update**: Mark all messages as read in MongoDB
3. **Unread Count Reset**: Reset Redis counter to 0
4. **Real-time Update**: Emit `unread_count_update` event
5. **UI Update**: Frontend updates unread count display

## API Endpoints

### Get Group Chats with Unread Counts
```
GET /api/groupchats?userId={userId}
```
Returns group chats with unread counts from Redis (with database fallback).

### Get Individual Unread Count
```
GET /api/groupchats/{groupId}/unread?userId={userId}
```
Returns unread count for a specific group chat.

### Get Total Unread Count
```
GET /api/group-chats/unread-count
```
Returns total unread count across all group chats.

### Mark All Messages as Read
```
POST /api/groupchats/{groupId}/mark-all-read
Body: { userId: string }
```
Resets unread count to 0 for the specified user and group.

## WebSocket Events

### `unread_count_update`
Emitted when unread count changes for a user:
```javascript
{
  chatId: string,
  userId: string,
  unreadCount: number
}
```

### `new_message`
Emitted when a new message is sent:
```javascript
{
  _id: string,
  groupChatId: string,
  senderId: string,
  content: string,
  timestamp: string,
  isRead: boolean,
  readBy: Record<string, string>
}
```

## Frontend Integration

### GroupChatContext
The frontend context handles:
- Listening for unread count updates
- Updating local state
- Marking messages as read
- Resetting unread counts when entering chats

### Key Functions
- `handleUnreadCountUpdate`: Updates unread counts from server events
- `selectGroupChat`: Resets unread count when entering a chat
- `markMessageAsRead`: Marks individual messages as read

## Testing

Run the test script to verify the system:
```bash
node test-unread-counts.js
```

This will test:
- Message sending and unread count increments
- Chat opening and unread count resets
- Multiple users and messages
- Real-time updates

## Error Handling

The system includes fallback mechanisms:
- **Redis failures**: Fall back to database calculations
- **Network issues**: Retry mechanisms for critical operations
- **Data consistency**: Validation and error logging

## Performance Considerations

- **Redis caching**: Fast unread count lookups
- **Batch operations**: Efficient updates for multiple users
- **Real-time updates**: Immediate UI feedback
- **Fallback mechanisms**: Reliable operation even with Redis issues

## Monitoring

Key metrics to monitor:
- Redis connection status
- Unread count update latency
- WebSocket event delivery
- Database fallback usage
- Error rates in unread count operations 