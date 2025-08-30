# Skip to Message Bug Fix

## Problem Description

When users double-tapped on voice messages to skip to the next message, the system was failing with an error:

```
ERROR [getAudioUrl] Error getting signed URL: [Error: Message 6858f68e6ab75b42aaab68b0 not found in current messages]
ERROR [FastPlaybackManager] Error getting audio URL: [Error: Message 6858f68e6ab75b42aaab68b0 not found in current messages]
```

The skip functionality wasn't working and users couldn't advance to the next message in the queue.

## Root Cause

The issue had two main parts:

1. **Inconsistent Message Sources**: The `skipToMessage` function was only looking in the `messages` array, but the next message to play might be in the `robustQueue` instead.

2. **Message Not Found**: The `getAudioUrl` function couldn't find messages that existed in the robust queue but weren't in the current messages state array.

## Solution

### 1. Fixed `skipToMessage` Function

**Before:** Only searched in the `messages` array
```typescript
const currentIndex = messages.findIndex(m => m._id === targetMessageId);
const nextUnreadMessage = messages.slice(currentIndex + 1).find(m => 
  m.type === 'voice' && 
  m.senderId !== user?.userId &&
  !playedMessageIdsRef.current.has(m._id) &&
  !m.isRead
);
```

**After:** Primary search in `robustQueue`, fallback to `messages` array
```typescript
// Use the robust queue instead of the messages array for more reliable next message finding
const queue = robustQueueRef.current;
const currentMessageIndex = queue.messages.findIndex(m => m._id === targetMessageId);

// Find the next message in the queue after the current one
let nextMessage = null;
if (currentMessageIndex !== -1 && currentMessageIndex < queue.messages.length - 1) {
  nextMessage = queue.messages[currentMessageIndex + 1];
} else {
  // If not found in queue, look in messages array as fallback
  const currentIndex = messages.findIndex(m => m._id === targetMessageId);
  nextMessage = messages.slice(currentIndex + 1).find(m => 
    m.type === 'voice' && 
    m.senderId !== user?.userId &&
    !playedMessageIdsRef.current.has(m._id) &&
    !m.isRead
  );
}
```

### 2. Fixed `getAudioUrl` Function

**Before:** Only searched in the `messages` array
```typescript
const messageToUse = message || messages.find(m => m._id === messageId);
if (!messageToUse) {
  throw new Error(`Message ${messageId} not found in current messages`);
}
```

**After:** Search in `messages` first, then `robustQueue` as fallback
```typescript
let messageToUse = message || messages.find(m => m._id === messageId);

// FIXED: If message not found in current messages, check the robust queue
if (!messageToUse) {
  const queue = robustQueueRef.current;
  messageToUse = queue.messages.find(m => m._id === messageId);
}

if (!messageToUse) {
  throw new Error(`Message ${messageId} not found in current messages or queue`);
}
```

### 3. Added Safety Checks

The fix includes several safety checks:

- **Message existence validation**: Verify the next message exists in the messages array before playing
- **Queue cleanup**: Properly remove processed messages from the queue
- **Fallback handling**: If no valid next message found, clear queue and trigger auto-recording
- **Better error logging**: Detailed logs showing queue state and message IDs for debugging

## How It Works Now

1. **User double-taps** on a voice message
2. **System finds current message** in the robust queue (primary) or messages array (fallback)
3. **Locates next message** in the queue sequence
4. **Validates message exists** in both queue and messages array
5. **Cleans up queue** by removing processed messages
6. **Plays next message** or triggers auto-recording if queue is complete

## Key Benefits

✅ **Reliable skip functionality** - Uses robust queue as primary source of truth  
✅ **Better error handling** - Graceful fallbacks when messages aren't found  
✅ **Queue consistency** - Properly manages queue state during skips  
✅ **Improved debugging** - Enhanced logging for troubleshooting  
✅ **Auto-recording integration** - Seamlessly triggers recording when queue completes  

## Files Modified

- `FlickD/app/gcTestDatabase.tsx` - Fixed `skipToMessage()` and `getAudioUrl()` functions

## Testing

The skip functionality now:
1. Reliably finds the next message to play
2. Handles edge cases where messages are in queue but not in current state
3. Properly manages queue state during skip operations
4. Gracefully handles end-of-queue scenarios with auto-recording 