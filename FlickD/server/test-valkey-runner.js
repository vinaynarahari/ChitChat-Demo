#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Valkey Compatibility Test Suite');
console.log('='.repeat(50));
console.log('This will test your Redis system for Valkey compatibility');
console.log('before switching to AWS ElastiCache with Valkey.');
console.log('');

// Test files to run
const tests = [
  {
    name: 'Main Redis Compatibility',
    file: 'test-valkey-compatibility.js',
    description: 'Tests basic Redis operations, caching, and Valkey-specific features'
  },
  {
    name: 'Redis Pub/Sub Compatibility',
    file: 'test-redis-pubsub.js',
    description: 'Tests Pub/Sub functionality used by your WebSocket system'
  }
];

// Run tests sequentially
async function runTests() {
  let allPassed = true;
  
  for (const test of tests) {
    console.log(`\n📋 Running: ${test.name}`);
    console.log(`📝 ${test.description}`);
    console.log('─'.repeat(50));
    
    try {
      const result = await runTest(test.file);
      if (result !== 0) {
        allPassed = false;
        console.log(`❌ ${test.name} FAILED`);
      } else {
        console.log(`✅ ${test.name} PASSED`);
      }
    } catch (error) {
      allPassed = false;
      console.log(`❌ ${test.name} ERROR: ${error.message}`);
    }
    
    console.log('');
  }
  
  // Final summary
  console.log('\n' + '='.repeat(50));
  console.log('🎯 FINAL VALKEY COMPATIBILITY SUMMARY');
  console.log('='.repeat(50));
  
  if (allPassed) {
    console.log('🎉 ALL TESTS PASSED!');
    console.log('');
    console.log('✅ Your Redis system is fully compatible with Valkey');
    console.log('✅ Your Pub/Sub system will work with ElastiCache Valkey');
    console.log('✅ You can safely switch to AWS ElastiCache with Valkey');
    console.log('');
    console.log('🚀 Next steps:');
    console.log('   1. Create ElastiCache cluster with Valkey engine');
    console.log('   2. Update your REDIS_HOST environment variable');
    console.log('   3. Deploy your application');
    console.log('');
    console.log('💰 Expected cost savings: 20% compared to Redis OSS');
  } else {
    console.log('⚠️  SOME TESTS FAILED');
    console.log('');
    console.log('❌ Your Redis system may have compatibility issues with Valkey');
    console.log('❌ Please review the failed tests before switching');
    console.log('');
    console.log('🔧 Recommended actions:');
    console.log('   1. Review the specific test failures above');
    console.log('   2. Check your Redis configuration');
    console.log('   3. Verify your Redis version compatibility');
    console.log('   4. Run tests again after fixes');
  }
  
  process.exit(allPassed ? 0 : 1);
}

// Run a single test file
function runTest(testFile) {
  return new Promise((resolve, reject) => {
    const testPath = path.join(__dirname, testFile);
    const child = spawn('node', [testPath], {
      stdio: 'inherit',
      cwd: __dirname
    });
    
    child.on('close', (code) => {
      resolve(code);
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
}

// Check if Redis is available
async function checkRedisAvailability() {
  console.log('🔍 Checking Redis availability...');
  
  const Redis = require('ioredis');
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    connectTimeout: 5000,
    lazyConnect: true
  });
  
  try {
    await redis.ping();
    console.log('✅ Redis is available and responding');
    await redis.disconnect();
    return true;
  } catch (error) {
    console.log('❌ Redis is not available or not responding');
    console.log(`   Error: ${error.message}`);
    console.log('');
    console.log('🔧 Please ensure:');
    console.log('   1. Redis server is running');
    console.log('   2. REDIS_HOST and REDIS_PORT are correctly set');
    console.log('   3. REDIS_PASSWORD is correct (if required)');
    console.log('   4. Network connectivity is available');
    console.log('');
    return false;
  }
}

// Main execution
async function main() {
  try {
    // Check Redis availability first
    const redisAvailable = await checkRedisAvailability();
    if (!redisAvailable) {
      process.exit(1);
    }
    
    console.log('');
    console.log('🚀 Starting Valkey compatibility tests...');
    console.log('');
    
    // Run all tests
    await runTests();
    
  } catch (error) {
    console.error('❌ Test runner error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { runTests, checkRedisAvailability }; 