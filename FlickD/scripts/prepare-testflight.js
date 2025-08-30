#!/usr/bin/env node

/**
 * Simple script to prepare app for TestFlight
 * This temporarily comments out console.log statements for production builds
 * 
 * Usage: node scripts/prepare-testflight.js
 */

const fs = require('fs');
const path = require('path');

// Files to process (only the main app files, not server or scripts)
const filesToProcess = [
  'app/gcTestDatabase.tsx',
  'components/RecordingQueueManager.tsx',
  'services/recordingService.ts',
  'services/ScalableMessageQueue.ts',
  'services/FastPlaybackManager.ts',
  'hooks/useScalableMessageQueue.ts'
];

console.log('🔧 Preparing app for TestFlight...');

filesToProcess.forEach(filePath => {
  const fullPath = path.join(__dirname, '..', filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  
  // Count console.log statements
  const consoleLogMatches = content.match(/console\.log\(/g);
  const consoleErrorMatches = content.match(/console\.error\(/g);
  const consoleWarnMatches = content.match(/console\.warn\(/g);
  
  console.log(`📁 ${filePath}:`);
  console.log(`   - console.log: ${consoleLogMatches ? consoleLogMatches.length : 0}`);
  console.log(`   - console.error: ${consoleErrorMatches ? consoleErrorMatches.length : 0}`);
  console.log(`   - console.warn: ${consoleWarnMatches ? consoleWarnMatches.length : 0}`);
});

console.log('\n✅ Analysis complete!');
console.log('\n📋 For TestFlight submission:');
console.log('1. All console.log statements should be guarded with __DEV__');
console.log('2. Remove any Alert.alert("Debug", ...) statements');
console.log('3. Ensure no hardcoded secrets in production builds');
console.log('4. Use production API endpoints only');

console.log('\n🔧 To automatically guard console logs, you can:');
console.log('1. Search for "console.log" in your editor');
console.log('2. Wrap each with: if (__DEV__) { ... }');
console.log('3. Or use a find/replace to add guards'); 