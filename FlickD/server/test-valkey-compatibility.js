const Redis = require('ioredis');
const { createClient } = require('redis');
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

// Test 1: Basic Connection Test
async function testBasicConnection() {
  console.log('\n=== Testing Basic Connection ===');
  
  try {
    const redis = new Redis(TEST_CONFIG);
    
    await redis.ping();
    logTest('PING command', true);
    
    const info = await redis.info('server');
    const isValkey = info.includes('valkey') || info.includes('Valkey');
    logTest('Server info retrieval', true);
    logTest('Valkey detection', isValkey, isValkey ? 'Valkey detected' : 'Standard Redis detected');
    
    await redis.disconnect();
    logTest('Connection cleanup', true);
    
  } catch (error) {
    logTest('Basic connection', false, error.message);
  }
}

// Test 2: Basic Operations Test
async function testBasicOperations() {
  console.log('\n=== Testing Basic Operations ===');
  
  try {
    const redis = new Redis(TEST_CONFIG);
    
    // Test SET/GET
    await redis.set('test:basic:key', 'test-value');
    const value = await redis.get('test:basic:key');
    logTest('SET/GET operations', value === 'test-value');
    
    // Test DEL
    await redis.del('test:basic:key');
    const deletedValue = await redis.get('test:basic:key');
    logTest('DEL operation', deletedValue === null);
    
    // Test EXISTS
    const exists = await redis.exists('test:basic:key');
    logTest('EXISTS operation', exists === 0);
    
    await redis.disconnect();
    
  } catch (error) {
    logTest('Basic operations', false, error.message);
  }
}

// Test 3: Hash Operations Test
async function testHashOperations() {
  console.log('\n=== Testing Hash Operations ===');
  
  try {
    const redis = new Redis(TEST_CONFIG);
    
    // Test HSET/HGET
    await redis.hset('test:hash:key', 'field1', 'value1', 'field2', 'value2');
    const value1 = await redis.hget('test:hash:key', 'field1');
    const value2 = await redis.hget('test:hash:key', 'field2');
    logTest('HSET/HGET operations', value1 === 'value1' && value2 === 'value2');
    
    // Test HGETALL
    const allFields = await redis.hgetall('test:hash:key');
    logTest('HGETALL operation', allFields.field1 === 'value1' && allFields.field2 === 'value2');
    
    // Test HDEL
    await redis.hdel('test:hash:key', 'field1');
    const deletedField = await redis.hget('test:hash:key', 'field1');
    logTest('HDEL operation', deletedField === null);
    
    // Cleanup
    await redis.del('test:hash:key');
    await redis.disconnect();
    
  } catch (error) {
    logTest('Hash operations', false, error.message);
  }
}

// Test 4: List Operations Test
async function testListOperations() {
  console.log('\n=== Testing List Operations ===');
  
  try {
    const redis = new Redis(TEST_CONFIG);
    
    // Test LPUSH/LRANGE
    await redis.lpush('test:list:key', 'item1', 'item2', 'item3');
    const list = await redis.lrange('test:list:key', 0, -1);
    logTest('LPUSH/LRANGE operations', list.length === 3 && list[0] === 'item3');
    
    // Test LPOP
    const popped = await redis.lpop('test:list:key');
    logTest('LPOP operation', popped === 'item3');
    
    // Test LLEN
    const length = await redis.llen('test:list:key');
    logTest('LLEN operation', length === 2);
    
    // Cleanup
    await redis.del('test:list:key');
    await redis.disconnect();
    
  } catch (error) {
    logTest('List operations', false, error.message);
  }
}

// Test 5: Set Operations Test
async function testSetOperations() {
  console.log('\n=== Testing Set Operations ===');
  
  try {
    const redis = new Redis(TEST_CONFIG);
    
    // Test SADD/SMEMBERS
    await redis.sadd('test:set:key', 'member1', 'member2', 'member3');
    const members = await redis.smembers('test:set:key');
    logTest('SADD/SMEMBERS operations', members.length === 3);
    
    // Test SISMEMBER
    const isMember = await redis.sismember('test:set:key', 'member1');
    logTest('SISMEMBER operation', isMember === 1);
    
    // Test SREM
    await redis.srem('test:set:key', 'member1');
    const isMemberAfterRemoval = await redis.sismember('test:set:key', 'member1');
    logTest('SREM operation', isMemberAfterRemoval === 0);
    
    // Cleanup
    await redis.del('test:set:key');
    await redis.disconnect();
    
  } catch (error) {
    logTest('Set operations', false, error.message);
  }
}

// Test 6: Expiration Test
async function testExpiration() {
  console.log('\n=== Testing Expiration ===');
  
  try {
    const redis = new Redis(TEST_CONFIG);
    
    // Test EXPIRE
    await redis.set('test:expire:key', 'expire-value');
    await redis.expire('test:expire:key', 1);
    
    const ttl = await redis.ttl('test:expire:key');
    logTest('EXPIRE/TTL operations', ttl > 0 && ttl <= 1);
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    const expiredValue = await redis.get('test:expire:key');
    logTest('Expiration timing', expiredValue === null);
    
    await redis.disconnect();
    
  } catch (error) {
    logTest('Expiration', false, error.message);
  }
}

// Test 7: Pipeline Test
async function testPipeline() {
  console.log('\n=== Testing Pipeline ===');
  
  try {
    const redis = new Redis(TEST_CONFIG);
    
    const pipeline = redis.pipeline();
    pipeline.set('test:pipeline:key1', 'value1');
    pipeline.set('test:pipeline:key2', 'value2');
    pipeline.get('test:pipeline:key1');
    pipeline.get('test:pipeline:key2');
    
    const results = await pipeline.exec();
    logTest('Pipeline execution', results.length === 4);
    
    // Cleanup
    await redis.del('test:pipeline:key1', 'test:pipeline:key2');
    await redis.disconnect();
    
  } catch (error) {
    logTest('Pipeline', false, error.message);
  }
}

// Test 8: Auto-pipelining Test (Valkey specific)
async function testAutoPipelining() {
  console.log('\n=== Testing Auto-pipelining (Valkey) ===');
  
  try {
    const redis = new Redis({
      ...TEST_CONFIG,
      enableAutoPipelining: true
    });
    
    // Test multiple operations that should be auto-pipelined
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(redis.set(`test:auto:key${i}`, `value${i}`));
    }
    
    await Promise.all(promises);
    logTest('Auto-pipelining operations', true);
    
    // Cleanup
    const delPromises = [];
    for (let i = 0; i < 10; i++) {
      delPromises.push(redis.del(`test:auto:key${i}`));
    }
    await Promise.all(delPromises);
    
    await redis.disconnect();
    
  } catch (error) {
    logTest('Auto-pipelining', false, error.message);
  }
}

// Test 9: Error Handling Test
async function testErrorHandling() {
  console.log('\n=== Testing Error Handling ===');
  
  try {
    const redis = new Redis(TEST_CONFIG);
    
    // Test invalid command
    try {
      await redis.call('INVALID_COMMAND');
      logTest('Invalid command handling', false, 'Should have thrown error');
    } catch (error) {
      logTest('Invalid command handling', true);
    }
    
    // Test wrong type operation
    await redis.set('test:wrongtype:key', 'string');
    try {
      await redis.lpush('test:wrongtype:key', 'value');
      logTest('Wrong type handling', false, 'Should have thrown error');
    } catch (error) {
      logTest('Wrong type handling', true);
    }
    
    // Cleanup
    await redis.del('test:wrongtype:key');
    await redis.disconnect();
    
  } catch (error) {
    logTest('Error handling', false, error.message);
  }
}

// Test 10: Performance Test
async function testPerformance() {
  console.log('\n=== Testing Performance ===');
  
  try {
    const redis = new Redis(TEST_CONFIG);
    
    const startTime = Date.now();
    
    // Test bulk operations
    const pipeline = redis.pipeline();
    for (let i = 0; i < 100; i++) {
      pipeline.set(`test:perf:key${i}`, `value${i}`);
    }
    await pipeline.exec();
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    logTest('Bulk operations performance', duration < 5000, `Completed in ${duration}ms`);
    
    // Cleanup
    const delPipeline = redis.pipeline();
    for (let i = 0; i < 100; i++) {
      delPipeline.del(`test:perf:key${i}`);
    }
    await delPipeline.exec();
    
    await redis.disconnect();
    
  } catch (error) {
    logTest('Performance', false, error.message);
  }
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting Valkey Compatibility Tests');
  console.log(`📡 Testing Redis at: ${TEST_CONFIG.host}:${TEST_CONFIG.port}`);
  console.log('='.repeat(50));
  
  await testBasicConnection();
  await testBasicOperations();
  await testHashOperations();
  await testListOperations();
  await testSetOperations();
  await testExpiration();
  await testPipeline();
  await testAutoPipelining();
  await testErrorHandling();
  await testPerformance();
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`📈 Total: ${testResults.total}`);
  console.log(`📊 Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  
  if (testResults.failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Your Redis system is Valkey compatible!');
    console.log('🚀 Ready to switch to AWS ElastiCache with Valkey.');
  } else {
    console.log('\n⚠️  Some tests failed. Please review the issues before switching to Valkey.');
    console.log('\nFailed tests:');
    testResults.details
      .filter(test => !test.passed)
      .forEach(test => console.log(`   - ${test.testName}: ${test.details}`));
  }
  
  process.exit(testResults.failed === 0 ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
  console.error('❌ Test runner error:', error);
  process.exit(1);
}); 