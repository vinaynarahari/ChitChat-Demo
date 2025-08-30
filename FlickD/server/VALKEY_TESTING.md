# Valkey Compatibility Testing

This directory contains comprehensive tests to verify your Redis system is compatible with **Valkey** before switching to AWS ElastiCache.

## 🎯 What is Valkey?

**Valkey** is an open-source Redis-compatible database that offers:
- **20% cost savings** compared to Redis OSS on ElastiCache
- **Full Redis OSS v7.0 compatibility**
- **Enhanced performance** and memory management
- **Drop-in replacement** for Redis

## 🧪 Test Files

### 1. `test-valkey-compatibility.js`
**Comprehensive Redis functionality test:**
- ✅ Basic connection and operations
- ✅ Hash, List, Set operations
- ✅ Expiration and TTL
- ✅ Pipeline and auto-pipelining
- ✅ Error handling
- ✅ Performance benchmarks
- ✅ Valkey-specific optimizations

### 2. `test-redis-pubsub.js`
**Pub/Sub functionality test:**
- ✅ Pub/Sub connection
- ✅ Basic subscribe/publish
- ✅ Your app's specific channels (`message:ready`, `transcription:ready`)
- ✅ JSON message handling
- ✅ Valkey detection

### 3. `test-valkey-runner.js`
**Master test runner:**
- ✅ Runs all tests sequentially
- ✅ Provides comprehensive summary
- ✅ Checks Redis availability first
- ✅ Clear pass/fail reporting

## 🚀 How to Run Tests

### Option 1: Run All Tests (Recommended)
```bash
cd FlickD/server
npm run test:valkey
```

### Option 2: Run Individual Tests
```bash
# Test main Redis functionality
npm run test:redis

# Test Pub/Sub functionality
npm run test:pubsub
```

### Option 3: Direct Node Execution
```bash
# Run all tests
node test-valkey-runner.js

# Run individual tests
node test-valkey-compatibility.js
node test-redis-pubsub.js
```

## ⚙️ Configuration

The tests use your existing environment variables:

```bash
# Required
REDIS_HOST=your-redis-host
REDIS_PORT=6379

# Optional
REDIS_PASSWORD=your-password
REDIS_URL=redis://host:port
REDIS_TLS=true  # Enable TLS if needed
```

## 📊 Test Results

### ✅ All Tests Pass
```
🎉 ALL TESTS PASSED!
✅ Your Redis system is fully compatible with Valkey
✅ Your Pub/Sub system will work with ElastiCache Valkey
✅ You can safely switch to AWS ElastiCache with Valkey

🚀 Next steps:
   1. Create ElastiCache cluster with Valkey engine
   2. Update your REDIS_HOST environment variable
   3. Deploy your application

💰 Expected cost savings: 20% compared to Redis OSS
```

### ❌ Some Tests Fail
```
⚠️  SOME TESTS FAILED
❌ Your Redis system may have compatibility issues with Valkey
❌ Please review the failed tests before switching

🔧 Recommended actions:
   1. Review the specific test failures above
   2. Check your Redis configuration
   3. Verify your Redis version compatibility
   4. Run tests again after fixes
```

## 🔍 What the Tests Check

### Main Redis Compatibility Test
1. **Connection & Authentication**
   - PING command
   - Server info retrieval
   - Valkey detection

2. **Basic Operations**
   - SET/GET operations
   - DEL operation
   - EXISTS operation

3. **Data Structures**
   - Hash operations (HSET/HGET/HGETALL/HDEL)
   - List operations (LPUSH/LRANGE/LPOP/LLEN)
   - Set operations (SADD/SMEMBERS/SISMEMBER/SREM)

4. **Advanced Features**
   - Expiration and TTL
   - Pipeline execution
   - Auto-pipelining (Valkey specific)
   - Error handling
   - Performance benchmarks

### Pub/Sub Compatibility Test
1. **Connection**
   - Pub/Sub client connection
   - Valkey detection for Pub/Sub

2. **Basic Pub/Sub**
   - Subscribe/Publish operations
   - Message reception

3. **Your App's Channels**
   - `message:ready` channel
   - `transcription:ready` channel
   - JSON message parsing

## 🛠️ Troubleshooting

### Redis Not Available
```
❌ Redis is not available or not responding
🔧 Please ensure:
   1. Redis server is running
   2. REDIS_HOST and REDIS_PORT are correctly set
   3. REDIS_PASSWORD is correct (if required)
   4. Network connectivity is available
```

### Connection Timeout
- Check your Redis server is running
- Verify host/port configuration
- Check firewall settings
- Ensure network connectivity

### Authentication Errors
- Verify REDIS_PASSWORD is correct
- Check Redis server authentication settings
- Ensure user has proper permissions

### Test Failures
- Review specific error messages
- Check Redis version compatibility
- Verify your Redis configuration
- Run tests with verbose logging

## 📈 Performance Expectations

With Valkey, you should see:
- **20% cost savings** on ElastiCache
- **Better memory management**
- **Enhanced auto-pipelining performance**
- **Improved connection handling**

## 🔄 Migration Steps

Once tests pass:

1. **Create ElastiCache Cluster**
   - Choose Valkey engine
   - Configure security groups
   - Set up VPC if needed

2. **Update Environment Variables**
   ```bash
   REDIS_HOST=your-valkey-cluster-endpoint
   REDIS_PORT=6379
   ```

3. **Deploy Application**
   - Update your deployment configuration
   - Test in staging first
   - Monitor performance

4. **Monitor & Optimize**
   - Watch CloudWatch metrics
   - Monitor application performance
   - Optimize based on usage patterns

## 📚 Additional Resources

- [Valkey Documentation](https://valkey.io/)
- [AWS ElastiCache Valkey](https://aws.amazon.com/elasticache/valkey/)
- [Redis Compatibility Guide](https://valkey.io/docs/compatibility/)

## 🆘 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review test output for specific error messages
3. Verify your Redis configuration
4. Test with a local Redis instance first 