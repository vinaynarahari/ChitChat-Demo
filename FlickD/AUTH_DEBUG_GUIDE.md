# Authentication Debug Guide

## Overview

Your app has been experiencing issues where features stop working after a user logs out and signs back in. This could be due to:

1. **Token Issues**: Stale or invalid tokens not being properly cleared/refreshed
2. **Socket Connection Issues**: Socket connections not being properly reset
3. **State Management Issues**: App state not being properly reset between sessions
4. **Race Conditions**: Multiple async operations interfering with each other

## Debug Logging Setup

I've added comprehensive logging throughout your authentication flow to track every step of the logout/login process. The logging uses specific prefixes to make it easy to filter and analyze.

**Important**: To enable debug logging, set these environment variables in your server's `.env` file:
```bash
DEBUG_AUTH=true
DEBUG_SOCKET=true
DEBUG_REDIS=true
DEBUG_GROUPCHATS=true
DEBUG_MESSAGES=true
```

**Note**: Debug logging is disabled by default to reduce console noise. Enable only when troubleshooting authentication issues, and disable when done.

### Log Prefixes

- `[AUTH-DEBUG]` - Authentication context events (login, logout, token refresh)
- `[SOCKET-DEBUG]` - Socket connection events (connect, disconnect, errors)
- `[APP-DEBUG]` - App initialization and routing events
- `[LOGIN-DEBUG]` - Login screen events
- `[LOGOUT-DEBUG]` - Server-side logout processing

### Key Events to Monitor

#### Logout Process
1. `LOGOUT_START` - User initiates logout
2. `LOGOUT_CLEARING_LOCAL_STATE` - Local auth state being cleared
3. `LOGOUT_NOTIFYING_SERVER` - Sending logout request to server
4. `LOGOUT_STORAGE_CLEARED` - AsyncStorage being cleared
5. `LOGOUT_STORAGE_VERIFICATION` - Verifying storage was actually cleared
6. `LOGOUT_SUCCESS` - Logout completed successfully

#### Login Process
1. `LOGIN_START` - User initiates login
2. `LOGIN_ATTEMPT` - Each login attempt (with retry logic)
3. `SERVER_CONNECTION_TEST` - Testing server connectivity
4. `LOGIN_RESPONSE_RECEIVED` - Server response received
5. `LOGIN_TOKENS_STORED` - Tokens saved to AsyncStorage
6. `LOGIN_SUCCESS` - Login completed successfully

#### Socket Events
1. `SOCKET_INIT_START` - Socket connection initialization
2. `SOCKET_CONNECTED` - Socket successfully connected
3. `SOCKET_DISCONNECTED` - Socket disconnected
4. `SOCKET_CLEANUP_START` - Socket cleanup during logout

## How to Debug

### Step 1: Start Monitoring

1. **For Expo apps**: Check the Expo development server console
2. **For React Native CLI**: 
   - iOS: Check Xcode console or iOS Simulator logs
   - Android: Run `npx react-native log-android`

### Step 2: Test the Flow

1. **Logout**: Tap the logout button in your app
2. **Wait**: Give it 5-10 seconds to complete all cleanup
3. **Login**: Log back in with the same credentials
4. **Test Features**: Try using features that were broken before

### Step 3: Analyze the Logs

Look for these patterns in your logs:

#### ✅ Healthy Logout Flow
```
[AUTH-DEBUG] LOGOUT_START
[AUTH-DEBUG] LOGOUT_CLEARING_LOCAL_STATE
[AUTH-DEBUG] LOGOUT_NOTIFYING_SERVER
[LOGOUT-DEBUG] LOGOUT_REQUEST_RECEIVED
[LOGOUT-DEBUG] LOGOUT_USER_FOUND
[LOGOUT-DEBUG] LOGOUT_SOCKET_CLEANUP_COMPLETE
[AUTH-DEBUG] LOGOUT_STORAGE_CLEARED
[AUTH-DEBUG] LOGOUT_STORAGE_VERIFICATION: storageCleared: true
[AUTH-DEBUG] LOGOUT_SUCCESS
```

#### ✅ Healthy Login Flow
```
[LOGIN-DEBUG] LOGIN_BUTTON_PRESSED
[AUTH-DEBUG] LOGIN_START
[AUTH-DEBUG] SERVER_CONNECTION_TEST: status: success
[AUTH-DEBUG] LOGIN_RESPONSE_RECEIVED: status: 200
[AUTH-DEBUG] LOGIN_TOKENS_STORED
[AUTH-DEBUG] LOGIN_SUCCESS
[SOCKET-DEBUG] SOCKET_INIT_START
[SOCKET-DEBUG] SOCKET_CONNECTED
```

#### ❌ Problematic Patterns

**Token Issues:**
```
[AUTH-DEBUG] TOKEN_REFRESH_ERROR
[AUTH-DEBUG] LOGIN_MISSING_TOKENS
[AUTH-DEBUG] LOGOUT_STORAGE_VERIFICATION: storageCleared: false
```

**Socket Issues:**
```
[SOCKET-DEBUG] SOCKET_CONNECTION_ERROR
[SOCKET-DEBUG] SOCKET_RECONNECT_FAILED
[SOCKET-DEBUG] SOCKET_DISCONNECTED: reason: transport_error
```

**Race Conditions:**
```
[AUTH-DEBUG] LOGIN_SUCCESS
[AUTH-DEBUG] LOGOUT_START  // This shouldn't happen right after login!
```

## Common Issues and Solutions

### Issue 1: Tokens Not Being Cleared

**Symptoms:**
- `LOGOUT_STORAGE_VERIFICATION: storageCleared: false`
- Old tokens still present after logout

**Solution:**
```javascript
// Add this to your logout function
await AsyncStorage.multiRemove(['accessToken', 'refreshToken', 'user']);
```

### Issue 2: Socket Connections Not Reset

**Symptoms:**
- `SOCKET_CONNECTION_ERROR` after login
- Features that depend on real-time updates not working

**Solution:**
- Ensure socket disconnection in logout process
- Verify socket reconnection with new user credentials

### Issue 3: Stale App State

**Symptoms:**
- App shows old user data after new login
- Features work partially

**Solution:**
- Reset all app state in AuthContext logout
- Clear any cached data in other contexts

### Issue 4: Server-Side Session Issues

**Symptoms:**
- `LOGOUT_USER_NOT_FOUND` or `LOGOUT_ERROR` on server
- API calls fail with authentication errors

**Solution:**
- Verify server-side session cleanup
- Check JWT token validation logic

## Advanced Debugging

### Enable Additional Logging

Add this to your app for even more detailed logs:

```javascript
// In your main App component
console.log('[APP-STATE]', 'App state:', {
  isAuthenticated,
  hasUser: !!user,
  socketConnected: socket?.connected
});
```

### Monitor Network Requests

Use a network monitoring tool like:
- **Flipper** (React Native debugging tool)
- **Charles Proxy** or **Proxyman**
- Browser DevTools (for web builds)

### Check AsyncStorage Directly

Add this debugging function to test storage state:

```javascript
const debugStorage = async () => {
  const keys = await AsyncStorage.getAllKeys();
  const values = await AsyncStorage.multiGet(keys);
  console.log('[STORAGE-DEBUG]', values);
};
```

## Quick Fix Checklist

If you're seeing issues, try these quick fixes:

1. **Clear App Storage**: Uninstall and reinstall the app
2. **Restart Metro**: Stop and restart your React Native bundler
3. **Clear Server Sessions**: Restart your backend server
4. **Check Network**: Ensure stable connection between app and server

## Next Steps

1. **Run the debug flow** and collect logs
2. **Identify the failure point** using the patterns above
3. **Apply the appropriate solution** based on the issue type
4. **Test thoroughly** to ensure the fix works
5. **Remove debug logging** once the issue is resolved (optional)

The comprehensive logging will help you pinpoint exactly where the logout/login process is failing, making it much easier to implement a targeted fix. 