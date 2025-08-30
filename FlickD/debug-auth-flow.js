#!/usr/bin/env node

/**
 * Auth Flow Debug Monitor
 * 
 * This script helps debug the logout/login process by:
 * 1. Monitoring console logs for auth-related events
 * 2. Providing a summary of the auth flow
 * 3. Identifying potential issues
 * 
 * Usage:
 * 1. Start your React Native app
 * 2. Run this script in a separate terminal: node debug-auth-flow.js
 * 3. Perform logout and login actions in your app
 * 4. Watch the output for issues
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Auth Flow Debug Monitor Started');
console.log('================================================');
console.log('');
console.log('This monitor will help you debug logout/login issues by:');
console.log('• Tracking authentication state changes');
console.log('• Monitoring socket connections');
console.log('• Identifying token management issues');
console.log('• Highlighting potential race conditions');
console.log('');
console.log('📱 Instructions:');
console.log('1. Make sure your React Native app is running');
console.log('2. Open your app and perform the following test:');
console.log('   a) Log out of the app');
console.log('   b) Wait 5 seconds');
console.log('   c) Log back in');
console.log('   d) Try using app features that were broken before');
console.log('');
console.log('🔍 Watch the logs below for any issues...');
console.log('================================================');
console.log('');

// Create a simple log aggregator that filters for our debug events
const authEvents = [];
const socketEvents = [];
const appEvents = [];
const loginEvents = [];
const logoutEvents = [];

// Function to analyze events and provide insights
function analyzeAuthFlow() {
  console.log('\n📊 AUTH FLOW ANALYSIS');
  console.log('======================');
  
  // Analyze logout process
  const logoutEventCount = logoutEvents.length;
  if (logoutEventCount > 0) {
    console.log(`✅ Logout Events Detected: ${logoutEventCount}`);
    
    const lastLogout = logoutEvents[logoutEvents.length - 1];
    if (lastLogout.includes('LOGOUT_SUCCESS')) {
      console.log('✅ Last logout completed successfully');
    } else if (lastLogout.includes('LOGOUT_ERROR')) {
      console.log('❌ Last logout had errors');
    }
  } else {
    console.log('⚠️  No logout events detected yet');
  }
  
  // Analyze login process
  const loginEventCount = loginEvents.length;
  if (loginEventCount > 0) {
    console.log(`✅ Login Events Detected: ${loginEventCount}`);
    
    const lastLogin = loginEvents[loginEvents.length - 1];
    if (lastLogin.includes('LOGIN_SUCCESS')) {
      console.log('✅ Last login completed successfully');
    } else if (lastLogin.includes('LOGIN_ERROR')) {
      console.log('❌ Last login had errors');
    }
  } else {
    console.log('⚠️  No login events detected yet');
  }
  
  // Analyze socket connections
  const socketEventCount = socketEvents.length;
  if (socketEventCount > 0) {
    console.log(`✅ Socket Events Detected: ${socketEventCount}`);
    
    const connectionEvents = socketEvents.filter(e => e.includes('SOCKET_CONNECTED'));
    const disconnectionEvents = socketEvents.filter(e => e.includes('SOCKET_DISCONNECTED'));
    const errorEvents = socketEvents.filter(e => e.includes('ERROR'));
    
    console.log(`   - Connections: ${connectionEvents.length}`);
    console.log(`   - Disconnections: ${disconnectionEvents.length}`);
    console.log(`   - Errors: ${errorEvents.length}`);
    
    if (errorEvents.length > 0) {
      console.log('❌ Socket errors detected - this could cause app instability');
    }
  } else {
    console.log('⚠️  No socket events detected yet');
  }
  
  // Analyze auth state changes
  const authEventCount = authEvents.length;
  if (authEventCount > 0) {
    console.log(`✅ Auth State Events Detected: ${authEventCount}`);
    
    const stateChanges = authEvents.filter(e => e.includes('AUTH_STATE_CHANGED'));
    console.log(`   - State changes: ${stateChanges.length}`);
  }
  
  // Check for potential issues
  console.log('\n🚨 POTENTIAL ISSUES:');
  
  // Check for token issues
  const tokenErrors = [...authEvents, ...loginEvents].filter(e => 
    e.includes('TOKEN_REFRESH_ERROR') || 
    e.includes('MISSING_TOKENS') || 
    e.includes('NO_REFRESH_TOKEN')
  );
  
  if (tokenErrors.length > 0) {
    console.log('❌ Token management issues detected:');
    tokenErrors.forEach(error => console.log(`   - ${error}`));
  }
  
  // Check for socket connection issues
  const socketErrors = socketEvents.filter(e => 
    e.includes('CONNECTION_ERROR') || 
    e.includes('RECONNECT_FAILED') ||
    e.includes('AUTH') && e.includes('ERROR')
  );
  
  if (socketErrors.length > 0) {
    console.log('❌ Socket connection issues detected:');
    socketErrors.forEach(error => console.log(`   - ${error}`));
  }
  
  // Check for storage issues
  const storageErrors = [...authEvents, ...appEvents].filter(e => 
    e.includes('STORAGE') && e.includes('ERROR')
  );
  
  if (storageErrors.length > 0) {
    console.log('❌ Storage issues detected:');
    storageErrors.forEach(error => console.log(`   - ${error}`));
  }
  
  console.log('\n💡 RECOMMENDATIONS:');
  
  if (tokenErrors.length > 0) {
    console.log('• Check if tokens are being properly cleared during logout');
    console.log('• Verify token refresh logic is working correctly');
    console.log('• Ensure AsyncStorage is being cleared properly');
  }
  
  if (socketErrors.length > 0) {
    console.log('• Check if socket connections are being properly closed on logout');
    console.log('• Verify socket reconnection logic after login');
    console.log('• Ensure user authentication is passed correctly to socket');
  }
  
  if (authEventCount === 0 && loginEventCount === 0 && logoutEventCount === 0) {
    console.log('• Make sure your React Native app is running with the latest code');
    console.log('• Try performing a logout and login action');
    console.log('• Check if the debug logging code is properly included');
  }
  
  console.log('\n================================================');
}

// Function to process incoming log lines
function processLogLine(line) {
  const timestamp = new Date().toISOString();
  
  // Filter for our debug events
  if (line.includes('[AUTH-DEBUG]')) {
    authEvents.push(`${timestamp}: ${line}`);
    console.log(`🔐 ${line}`);
  } else if (line.includes('[SOCKET-DEBUG]')) {
    socketEvents.push(`${timestamp}: ${line}`);
    console.log(`🔌 ${line}`);
  } else if (line.includes('[APP-DEBUG]')) {
    appEvents.push(`${timestamp}: ${line}`);
    console.log(`📱 ${line}`);
  } else if (line.includes('[LOGIN-DEBUG]')) {
    loginEvents.push(`${timestamp}: ${line}`);
    console.log(`👤 ${line}`);
  } else if (line.includes('[LOGOUT-DEBUG]')) {
    logoutEvents.push(`${timestamp}: ${line}`);
    console.log(`🚪 ${line}`);
  }
}

// Instructions for manual monitoring
console.log('📋 MANUAL MONITORING INSTRUCTIONS:');
console.log('==================================');
console.log('');
console.log('Since this is a React Native app, you\'ll need to:');
console.log('');
console.log('1. Open your React Native development tools:');
console.log('   • For iOS: Open iOS Simulator and check the logs');
console.log('   • For Android: Run `npx react-native log-android`');
console.log('   • For Expo: Check the Expo development server logs');
console.log('');
console.log('2. Look for these debug prefixes in your logs:');
console.log('   • [AUTH-DEBUG] - Authentication state changes');
console.log('   • [SOCKET-DEBUG] - Socket connection events');  
console.log('   • [APP-DEBUG] - App initialization events');
console.log('   • [LOGIN-DEBUG] - Login process events');
console.log('   • [LOGOUT-DEBUG] - Logout process events');
console.log('');
console.log('3. Test the logout/login flow:');
console.log('   a) Log out of the app');
console.log('   b) Watch for LOGOUT_* events in the logs');
console.log('   c) Wait a few seconds');
console.log('   d) Log back in');
console.log('   e) Watch for LOGIN_* events in the logs');
console.log('   f) Try using features that were broken before');
console.log('');
console.log('4. Common issues to look for:');
console.log('   • TOKEN_REFRESH_ERROR - Token management issues');
console.log('   • SOCKET_CONNECTION_ERROR - Socket connection problems');
console.log('   • STORAGE errors - AsyncStorage issues');
console.log('   • Missing LOGOUT_SUCCESS or LOGIN_SUCCESS events');
console.log('');
console.log('5. If you see errors:');
console.log('   • Note the exact error message');
console.log('   • Check the timestamp sequence of events');
console.log('   • Look for any race conditions (events happening out of order)');
console.log('');

// Set up periodic analysis
setInterval(() => {
  if (authEvents.length > 0 || socketEvents.length > 0 || 
      appEvents.length > 0 || loginEvents.length > 0 || 
      logoutEvents.length > 0) {
    analyzeAuthFlow();
  }
}, 10000); // Analyze every 10 seconds

// Keep the script running
console.log('🔄 Monitor is running... Press Ctrl+C to stop');
console.log('');

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n📊 FINAL ANALYSIS');
  console.log('==================');
  analyzeAuthFlow();
  console.log('\n👋 Auth Flow Debug Monitor stopped');
  process.exit(0);
}); 