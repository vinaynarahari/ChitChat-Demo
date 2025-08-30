# Debug Logging Control Guide

## Overview

The FlickD server now supports selective debug logging to reduce console noise while maintaining essential error and performance information.

## Environment Variables

Add these environment variables to your `.env` file to control logging levels:

```bash
# Debug Logging Controls
DEBUG_REDIS=false          # Controls Redis sync and unread count logging
DEBUG_GROUPCHATS=false     # Controls group chat fetching and unread message logging
DEBUG_MESSAGES=false       # Controls message fetching and processing logging
DEBUG_AUTH=false           # Controls authentication flow logging
DEBUG_SOCKET=false         # Controls socket connection logging
```

## Default Behavior (Reduced Logging)

With debug flags set to `false` (default), the system will only log:

### Redis Operations
- ✅ Errors and warnings
- ❌ Sync operations (unless debug enabled)
- ❌ Individual chat sync operations
- ❌ Routine sync completion messages

### Group Chat Operations
- ✅ Errors and warnings
- ✅ Slow operations (>1000ms)
- ❌ Individual chat unread counts
- ❌ Routine fetching operations
- ❌ Summary logs (unless debug enabled)

### Message Operations
- ✅ Errors and warnings
- ❌ Individual message fetching logs
- ❌ Message processing details
- ❌ Raw database query results

### Authentication Operations
- ✅ Errors and critical auth events
- ❌ Routine login/logout operations (unless debug enabled)

### Socket Operations
- ✅ Connection errors and warnings
- ❌ Routine connection/disconnection events

## Enabling Debug Logging

To enable detailed logging for troubleshooting:

1. **For Redis issues:**
   ```bash
   DEBUG_REDIS=true
   ```

2. **For Group Chat issues:**
   ```bash
   DEBUG_GROUPCHATS=true
   ```

3. **For Message fetching issues:**
   ```bash
   DEBUG_MESSAGES=true
   ```

4. **For Authentication issues:**
   ```bash
   DEBUG_AUTH=true
   ```

5. **For Socket issues:**
   ```bash
   DEBUG_SOCKET=true
   ```

6. **Enable all debug logging:**
   ```bash
   DEBUG_REDIS=true
   DEBUG_GROUPCHATS=true
   DEBUG_MESSAGES=true
   DEBUG_AUTH=true
   DEBUG_SOCKET=true
   ```

## What You'll See Now

### Before (Excessive Logging)
```
[Redis] Syncing unread counts from DB for user 683a3d8d13fad8e4e3bccfb6
[Redis] Synced unread count for chat 6864070954ce70f74ae78077: 1
[Redis] Synced unread count for chat 685e35e3338a1ad9ba7e1140: 30
[Redis] Synced unread count for chat 68575274f73c69b53992d48b: 1
[Redis] Completed unread count sync for user 683a3d8d13fad8e4e3bccfb6
[groupchats] Fetching group chats for userId: 683a3d8d13fad8e4e3bccfb6
[groupchats] Found 65 group chats in 769ms
[groupchats] Unread messages in test 3+: 30 (from Redis)
[groupchats] Unread messages in Wow: 12 (from Redis)
[groupchats] Unread messages in testm: 1 (from Redis)
[groupchats] Returning 65 group chats in 801ms
```

### After (Clean Logging)
```
# Only performance warnings for slow operations
[groupchats] Returning 65 group chats in 1800ms (15 with unread messages)
```

### With Debug Enabled
```
[groupchats] Fetching group chats for userId: 683a3d8d13fad8e4e3bccfb6
[Redis] Syncing unread counts from DB for user 683a3d8d13fad8e4e3bccfb6 (65 chats)
[Redis] Completed unread count sync for user 683a3d8d13fad8e4e3bccfb6 (15 chats with unread messages)
[groupchats] Found 65 group chats in 769ms
[groupchats] Unread messages in test 3+: 30 (from Redis)
[groupchats] Unread messages in Wow: 12 (from Redis)
[groupchats] Unread messages in testm: 1 (from Redis)
[groupchats] Returning 65 group chats in 801ms (15 with unread messages)
[API][messages] Fetching messages: { groupChatId: '685dcd40d5756cae822cda25', page: 1, limit: 20 }
[API][messages] Raw messages retrieved from DB: { groupChatId: '685dcd40d5756cae822cda25', count: 4 }
[API][messages] Messages processed and ready to send: { groupChatId: '685dcd40d5756cae822cda25', count: 4 }
```

## Benefits

1. **Cleaner Console**: Reduced noise makes it easier to spot important issues
2. **Better Performance**: Less logging overhead during normal operations
3. **Selective Debugging**: Enable detailed logging only when needed
4. **Maintained Visibility**: Still see important metrics and errors

## Troubleshooting

If you're experiencing issues and need more detailed logs:

1. Enable the relevant debug flag
2. Restart your server
3. Reproduce the issue
4. Check the detailed logs
5. Disable debug logging when done

## Restart Required

After changing debug environment variables, restart your server:

```bash
# If using PM2
pm2 restart flick-server

# If running directly
# Stop the server and restart
``` 