const { performance } = require('perf_hooks');

class MetricsCollector {
  constructor() {
    this.metrics = new Map();
    this.startTimes = new Map();
  }

  startOperation(operationId) {
    this.startTimes.set(operationId, performance.now());
  }

  endOperation(operationId, metadata = {}) {
    const startTime = this.startTimes.get(operationId);
    if (!startTime) return;

    const endTime = performance.now();
    const duration = endTime - startTime;

    const metric = {
      operationId,
      duration,
      timestamp: new Date(),
      ...metadata
    };

    // Store metric
    if (!this.metrics.has(operationId)) {
      this.metrics.set(operationId, []);
    }
    this.metrics.get(operationId).push(metric);

    // Clean up
    this.startTimes.delete(operationId);

    // Log if duration exceeds threshold
    if (duration > 1000) { // 1 second threshold
      console.warn(`Slow operation detected: ${operationId} took ${duration}ms`, metadata);
    }

    return metric;
  }

  getMetrics(operationId) {
    return this.metrics.get(operationId) || [];
  }

  getAverageDuration(operationId) {
    const metrics = this.getMetrics(operationId);
    if (!metrics.length) return 0;

    const total = metrics.reduce((sum, m) => sum + m.duration, 0);
    return total / metrics.length;
  }

  getPercentile(operationId, percentile) {
    const metrics = this.getMetrics(operationId);
    if (!metrics.length) return 0;

    const sorted = metrics.map(m => m.duration).sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }

  clearMetrics(operationId) {
    if (operationId) {
      this.metrics.delete(operationId);
    } else {
      this.metrics.clear();
    }
  }
}

// Create singleton instance
const metricsCollector = new MetricsCollector();

// Performance monitoring middleware
const performanceMiddleware = (req, res, next) => {
  const operationId = `${req.method}:${req.path}`;
  metricsCollector.startOperation(operationId);

  // Add response listener
  res.on('finish', () => {
    metricsCollector.endOperation(operationId, {
      statusCode: res.statusCode,
      path: req.path,
      method: req.method
    });
  });

  next();
};

// Voice message specific metrics
const voiceMessageMetrics = {
  startUpload: (messageId) => {
    metricsCollector.startOperation(`upload:${messageId}`);
  },

  endUpload: (messageId, metadata) => {
    return metricsCollector.endOperation(`upload:${messageId}`, {
      type: 'upload',
      ...metadata
    });
  },

  startTranscription: (messageId) => {
    metricsCollector.startOperation(`transcription:${messageId}`);
  },

  endTranscription: (messageId, metadata) => {
    return metricsCollector.endOperation(`transcription:${messageId}`, {
      type: 'transcription',
      ...metadata
    });
  },

  startDelivery: (messageId) => {
    metricsCollector.startOperation(`delivery:${messageId}`);
  },

  endDelivery: (messageId, metadata) => {
    return metricsCollector.endOperation(`delivery:${messageId}`, {
      type: 'delivery',
      ...metadata
    });
  },

  getMessageMetrics: (messageId) => {
    return {
      upload: metricsCollector.getMetrics(`upload:${messageId}`),
      transcription: metricsCollector.getMetrics(`transcription:${messageId}`),
      delivery: metricsCollector.getMetrics(`delivery:${messageId}`)
    };
  }
};

module.exports = {
  metricsCollector,
  performanceMiddleware,
  voiceMessageMetrics
}; 