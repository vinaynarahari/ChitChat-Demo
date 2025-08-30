const { getCollection } = require('../database/collections');

/**
 * Performance Metrics System for Message Sending
 * Tracks performance and identifies bottlenecks
 */
class PerformanceMetrics {
  constructor() {
    this.metrics = {
      messageSending: {
        totalMessages: 0,
        avgSendTime: 0,
        sendTimes: [],
        byEndpoint: {},
        byType: {},
        errors: 0,
        slowSends: 0 // > 200ms
      },
      socketEvents: {
        totalEvents: 0,
        avgLatency: 0,
        byEventType: {},
        slowEvents: 0 // > 100ms
      },
      database: {
        totalQueries: 0,
        avgQueryTime: 0,
        slowQueries: 0, // > 50ms
        byOperation: {}
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        avgAccessTime: 0
      }
    };
    
    this.startTime = Date.now();
    this.alertThresholds = {
      sendTime: 200, // ms
      socketLatency: 100, // ms
      dbQueryTime: 50, // ms
      errorRate: 0.05 // 5%
    };
  }

  /**
   * Track message sending performance
   */
  trackMessageSend(endpoint, messageType, startTime, success = true, error = null) {
    const sendTime = Date.now() - startTime;
    
    this.metrics.messageSending.totalMessages++;
    this.metrics.messageSending.sendTimes.push(sendTime);
    
    // Update average send time
    const totalTime = this.metrics.messageSending.sendTimes.reduce((sum, time) => sum + time, 0);
    this.metrics.messageSending.avgSendTime = totalTime / this.metrics.messageSending.sendTimes.length;
    
    // Track by endpoint
    if (!this.metrics.messageSending.byEndpoint[endpoint]) {
      this.metrics.messageSending.byEndpoint[endpoint] = {
        count: 0,
        avgTime: 0,
        totalTime: 0
      };
    }
    const endpointStats = this.metrics.messageSending.byEndpoint[endpoint];
    endpointStats.count++;
    endpointStats.totalTime += sendTime;
    endpointStats.avgTime = endpointStats.totalTime / endpointStats.count;
    
    // Track by message type
    if (!this.metrics.messageSending.byType[messageType]) {
      this.metrics.messageSending.byType[messageType] = {
        count: 0,
        avgTime: 0,
        totalTime: 0
      };
    }
    const typeStats = this.metrics.messageSending.byType[messageType];
    typeStats.count++;
    typeStats.totalTime += sendTime;
    typeStats.avgTime = typeStats.totalTime / typeStats.count;
    
    // Track errors
    if (!success) {
      this.metrics.messageSending.errors++;
      console.error('[PerformanceMetrics] Message send error:', {
        endpoint,
        messageType,
        sendTime,
        error: error?.message
      });
    }
    
    // Track slow sends
    if (sendTime > this.alertThresholds.sendTime) {
      this.metrics.messageSending.slowSends++;
      console.warn('[PerformanceMetrics] Slow message send detected:', {
        endpoint,
        messageType,
        sendTime,
        threshold: this.alertThresholds.sendTime
      });
    }
    
    // Log performance data
    console.log('[PerformanceMetrics] Message send tracked:', {
      endpoint,
      messageType,
      sendTime,
      success,
      avgSendTime: this.metrics.messageSending.avgSendTime
    });
  }

  /**
   * Track socket event performance
   */
  trackSocketEvent(eventType, latency) {
    this.metrics.socketEvents.totalEvents++;
    
    if (!this.metrics.socketEvents.byEventType[eventType]) {
      this.metrics.socketEvents.byEventType[eventType] = {
        count: 0,
        avgLatency: 0,
        totalLatency: 0
      };
    }
    
    const eventStats = this.metrics.socketEvents.byEventType[eventType];
    eventStats.count++;
    eventStats.totalLatency += latency;
    eventStats.avgLatency = eventStats.totalLatency / eventStats.count;
    
    // Update overall average
    const totalLatency = Object.values(this.metrics.socketEvents.byEventType)
      .reduce((sum, stats) => sum + stats.totalLatency, 0);
    this.metrics.socketEvents.avgLatency = totalLatency / this.metrics.socketEvents.totalEvents;
    
    // Track slow events
    if (latency > this.alertThresholds.socketLatency) {
      this.metrics.socketEvents.slowEvents++;
      console.warn('[PerformanceMetrics] Slow socket event detected:', {
        eventType,
        latency,
        threshold: this.alertThresholds.socketLatency
      });
    }
  }

  /**
   * Track database query performance
   */
  trackDatabaseQuery(operation, queryTime) {
    this.metrics.database.totalQueries++;
    
    if (!this.metrics.database.byOperation[operation]) {
      this.metrics.database.byOperation[operation] = {
        count: 0,
        avgTime: 0,
        totalTime: 0
      };
    }
    
    const opStats = this.metrics.database.byOperation[operation];
    opStats.count++;
    opStats.totalTime += queryTime;
    opStats.avgTime = opStats.totalTime / opStats.count;
    
    // Update overall average
    const totalTime = Object.values(this.metrics.database.byOperation)
      .reduce((sum, stats) => sum + stats.totalTime, 0);
    this.metrics.database.avgQueryTime = totalTime / this.metrics.database.totalQueries;
    
    // Track slow queries
    if (queryTime > this.alertThresholds.dbQueryTime) {
      this.metrics.database.slowQueries++;
      console.warn('[PerformanceMetrics] Slow database query detected:', {
        operation,
        queryTime,
        threshold: this.alertThresholds.dbQueryTime
      });
    }
  }

  /**
   * Track cache performance
   */
  trackCacheAccess(hit, accessTime) {
    if (hit) {
      this.metrics.cache.hits++;
    } else {
      this.metrics.cache.misses++;
    }
    
    const totalAccesses = this.metrics.cache.hits + this.metrics.cache.misses;
    this.metrics.cache.hitRate = this.metrics.cache.hits / totalAccesses;
    
    // Update average access time (simplified)
    this.metrics.cache.avgAccessTime = 
      (this.metrics.cache.avgAccessTime * (totalAccesses - 1) + accessTime) / totalAccesses;
  }

  /**
   * Get performance report
   */
  getPerformanceReport() {
    const uptime = Date.now() - this.startTime;
    const errorRate = this.metrics.messageSending.totalMessages > 0 
      ? this.metrics.messageSending.errors / this.metrics.messageSending.totalMessages 
      : 0;
    
    const report = {
      uptime: {
        total: uptime,
        formatted: this.formatDuration(uptime)
      },
      messageSending: {
        ...this.metrics.messageSending,
        errorRate,
        slowSendRate: this.metrics.messageSending.totalMessages > 0 
          ? this.metrics.messageSending.slowSends / this.metrics.messageSending.totalMessages 
          : 0
      },
      socketEvents: {
        ...this.metrics.socketEvents,
        slowEventRate: this.metrics.socketEvents.totalEvents > 0 
          ? this.metrics.socketEvents.slowEvents / this.metrics.socketEvents.totalEvents 
          : 0
      },
      database: {
        ...this.metrics.database,
        slowQueryRate: this.metrics.database.totalQueries > 0 
          ? this.metrics.database.slowQueries / this.metrics.database.totalQueries 
          : 0
      },
      cache: this.metrics.cache,
      alerts: this.generateAlerts()
    };
    
    return report;
  }

  /**
   * Generate performance alerts
   */
  generateAlerts() {
    const alerts = [];
    
    // Check error rate
    const errorRate = this.metrics.messageSending.totalMessages > 0 
      ? this.metrics.messageSending.errors / this.metrics.messageSending.totalMessages 
      : 0;
    
    if (errorRate > this.alertThresholds.errorRate) {
      alerts.push({
        type: 'high_error_rate',
        message: `Error rate is ${(errorRate * 100).toFixed(2)}%, above threshold of ${(this.alertThresholds.errorRate * 100).toFixed(2)}%`,
        severity: 'high'
      });
    }
    
    // Check slow send rate
    const slowSendRate = this.metrics.messageSending.totalMessages > 0 
      ? this.metrics.messageSending.slowSends / this.metrics.messageSending.totalMessages 
      : 0;
    
    if (slowSendRate > 0.1) { // More than 10% slow sends
      alerts.push({
        type: 'high_slow_send_rate',
        message: `${(slowSendRate * 100).toFixed(2)}% of messages are taking longer than ${this.alertThresholds.sendTime}ms to send`,
        severity: 'medium'
      });
    }
    
    // Check average send time
    if (this.metrics.messageSending.avgSendTime > this.alertThresholds.sendTime) {
      alerts.push({
        type: 'high_avg_send_time',
        message: `Average send time is ${this.metrics.messageSending.avgSendTime.toFixed(2)}ms, above threshold of ${this.alertThresholds.sendTime}ms`,
        severity: 'medium'
      });
    }
    
    return alerts;
  }

  /**
   * Format duration in human readable format
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Save performance metrics to database
   */
  async saveMetrics() {
    try {
      const performanceCollection = getCollection('performanceMetrics');
      
      const metricsDoc = {
        timestamp: new Date(),
        metrics: this.metrics,
        uptime: Date.now() - this.startTime,
        alerts: this.generateAlerts()
      };
      
      await performanceCollection.insertOne(metricsDoc);
      console.log('[PerformanceMetrics] Metrics saved to database');
    } catch (error) {
      console.error('[PerformanceMetrics] Error saving metrics:', error);
    }
  }

  /**
   * Reset metrics (for testing)
   */
  reset() {
    this.metrics = {
      messageSending: {
        totalMessages: 0,
        avgSendTime: 0,
        sendTimes: [],
        byEndpoint: {},
        byType: {},
        errors: 0,
        slowSends: 0
      },
      socketEvents: {
        totalEvents: 0,
        avgLatency: 0,
        byEventType: {},
        slowEvents: 0
      },
      database: {
        totalQueries: 0,
        avgQueryTime: 0,
        slowQueries: 0,
        byOperation: {}
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        avgAccessTime: 0
      }
    };
    this.startTime = Date.now();
    console.log('[PerformanceMetrics] Metrics reset');
  }
}

// Create singleton instance
const performanceMetrics = new PerformanceMetrics();

// Save metrics every 5 minutes
setInterval(() => {
  performanceMetrics.saveMetrics();
}, 5 * 60 * 1000);

module.exports = {
  PerformanceMetrics,
  performanceMetrics
}; 