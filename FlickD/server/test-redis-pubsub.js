const { createClient } = require('redis');
const Redis = require('ioredis');
require('dotenv').config();

// Test configuration
const TEST_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  connectTimeout: 10000,
  enableOfflineQueue: true,
  maxScripts: 100,
  keepAlive: 10000,
  // Valkey-specific optimizations
  lazyConnect: false,
  showFriendlyErrorStack: true,
  enableAutoPipelining: true,
  family: 4,
  commandTimeout: 5000,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined
};

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  details: []
};

// Utility function to log test results
const logTest = (testName, passed, details = '') => {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${testName}`);
  } else {
    testResults.failed++;
    console.log(`❌ ${testName}`);
    if (details) console.log(`   Details: ${details}`);
  }
  testResults.details.push({ testName, passed, details });
};

// Test channels
const TEST_CHANNELS = {
  MESSAGE_READY: 'test:message:ready',
  TRANSCRIPTION_READY: 'test:transcription:ready',
  GENERAL: 'test:general'
};

// Test 1: Basic Pub/Sub Connection Test
async function testPubSubConnection() {
  console.log('\n=== Testing Pub/Sub Connection ===');
  
  try {
    const pubSubClient = createClient({
      url: process.env.REDIS_URL || `redis://${TEST_CONFIG.host}:${TEST_CONFIG.port}`,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
        connectTimeout: 10000,
        commandTimeout: 5000,
        keepAlive: 10000
      },
      disableOfflineQueue: false,
      legacyMode: false,
      isolationPoolOptions: {
        min: 1,
        max: 10
      }
    });
    
    await pubSubClient.connect();
    logTest('Pub/Sub client connection', true);
    
    const info = await pubSubClient.info('server');
    const isValkey = info.includes('valkey') || info.includes('Valkey');
    logTest('Pub/Sub Valkey detection', isValkey, isValkey ? 'Valkey detected' : 'Standard Redis detected');
    
    await pubSubClient.disconnect();
    logTest('Pub/Sub connection cleanup', true);
    
  } catch (error) {
    logTest('Pub/Sub connection', false, error.message);
  }
}

// Test 2: Basic Subscribe/Publish Test
async function testBasicPubSub() {
  console.log('\n=== Testing Basic Subscribe/Publish ===');
  
  try {
    const publisher = createClient({
      url: process.env.REDIS_URL || `redis://${TEST_CONFIG.host}:${TEST_CONFIG.port}`,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
        connectTimeout: 10000,
        commandTimeout: 5000,
        keepAlive: 10000
      }
    });
    
    const subscriber = createClient({
      url: process.env.REDIS_URL || `redis://${TEST_CONFIG.host}:${TEST_CONFIG.port}`,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
        connectTimeout: 10000,
        commandTimeout: 5000,
        keepAlive: 10000
      }
    });
    
    await publisher.connect();
    await subscriber.connect();
    
    // Subscribe to test channel
    await subscriber.subscribe(TEST_CHANNELS.GENERAL, (message) => {
      logTest('Message reception', message === 'test-message', `Received: ${message}`);
    });
    
    // Publish message
    await publisher.publish(TEST_CHANNELS.GENERAL, 'test-message');
    
    // Wait for message to be received
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Unsubscribe
    await subscriber.unsubscribe(TEST_CHANNELS.GENERAL);
    
    await publisher.disconnect();
    await subscriber.disconnect();
    
    logTest('Basic Pub/Sub operations', true);
    
  } catch (error) {
    logTest('Basic Pub/Sub', false, error.message);
  }
}

// Test 3: Your App's Specific Channels Test
async function testAppSpecificChannels() {
  console.log('\n=== Testing Your App\'s Specific Channels ===');
  
  try {
    const publisher = createClient({
      url: process.env.REDIS_URL || `redis://${TEST_CONFIG.host}:${TEST_CONFIG.port}`,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
        connectTimeout: 10000,
        commandTimeout: 5000,
        keepAlive: 10000
      }
    });
    
    const subscriber = createClient({
      url: process.env.REDIS_URL || `redis://${TEST_CONFIG.host}:${TEST_CONFIG.port}`,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
        connectTimeout: 10000,
        commandTimeout: 5000,
        keepAlive: 10000
      }
    });
    
    await publisher.connect();
    await subscriber.connect();
    
    // Test message:ready channel
    let messageReadyReceived = false;
    await subscriber.subscribe('message:ready', (message) => {
      try {
        const data = JSON.parse(message);
        messageReadyReceived = data.groupChatId === 'test-group' && data.messageId === 'test-message';
        logTest('message:ready channel', messageReadyReceived, `Received: ${data.messageId}`);
      } catch (error) {
        logTest('message:ready channel', false, error.message);
      }
    });
    
    // Test transcription:ready channel
    let transcriptionReadyReceived = false;
    await subscriber.subscribe('transcription:ready', (message) => {
      try {
        const data = JSON.parse(message);
        transcriptionReadyReceived = data.messageId === 'test-message' && data.transcription === 'test transcription';
        logTest('transcription:ready channel', transcriptionReadyReceived, `Received: ${data.messageId}`);
      } catch (error) {
        logTest('transcription:ready channel', false, error.message);
      }
    });
    
    // Publish test messages
    await publisher.publish('message:ready', JSON.stringify({
      groupChatId: 'test-group',
      messageId: 'test-message'
    }));
    
    await publisher.publish('transcription:ready', JSON.stringify({
      messageId: 'test-message',
      transcription: 'test transcription'
    }));
    
    // Wait for messages
    await new Promise(resolve => setTimeout(resolve, 200));
    
    logTest('App-specific channels', messageReadyReceived && transcriptionReadyReceived, 'Both channels working');
    
    // Cleanup
    await subscriber.unsubscribe('message:ready');
    await subscriber.unsubscribe('transcription:ready');
    
    await publisher.disconnect();
    await subscriber.disconnect();
    
  } catch (error) {
    logTest('App-specific channels', false, error.message);
  }
}

// Main test runner
async function runAllPubSubTests() {
  console.log('🚀 Starting Redis Pub/Sub Compatibility Tests');
  console.log(`📡 Testing Redis at: ${TEST_CONFIG.host}:${TEST_CONFIG.port}`);
  console.log('='.repeat(50));
  
  await testPubSubConnection();
  await testBasicPubSub();
  await testAppSpecificChannels();
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 PUB/SUB TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`📈 Total: ${testResults.total}`);
  console.log(`📊 Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  
  if (testResults.failed === 0) {
    console.log('\n🎉 ALL PUB/SUB TESTS PASSED! Your Redis Pub/Sub system is Valkey compatible!');
    console.log('🚀 Ready to switch to AWS ElastiCache with Valkey for Pub/Sub.');
  } else {
    console.log('\n⚠️  Some Pub/Sub tests failed. Please review the issues before switching to Valkey.');
    console.log('\nFailed tests:');
    testResults.details
      .filter(test => !test.passed)
      .forEach(test => console.log(`   - ${test.testName}: ${test.details}`));
  }
  
  process.exit(testResults.failed === 0 ? 0 : 1);
}

// Run tests
runAllPubSubTests().catch(error => {
  console.error('❌ Pub/Sub test runner error:', error);
  process.exit(1);
}); 