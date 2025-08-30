interface SimplePerformanceMetrics {
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  error?: string;
}

interface SimpleCacheMetrics {
  cacheType: 'preprocessing' | 'audio';
  hit: boolean;
  duration: number;
  timestamp: number;
}

class SimplePerformanceMonitor {
  private static instance: SimplePerformanceMonitor;
  private metrics: SimplePerformanceMetrics[] = [];
  private cacheMetrics: SimpleCacheMetrics[] = [];
  private isEnabled: boolean = true;

  private constructor() {
    // Start background cleanup
    this.startCleanupTask();
  }

  public static getInstance(): SimplePerformanceMonitor {
    if (!SimplePerformanceMonitor.instance) {
      SimplePerformanceMonitor.instance = new SimplePerformanceMonitor();
    }
    return SimplePerformanceMonitor.instance;
  }

  /**
   * Start timing an operation
   */
  startOperation(operation: string): string {
    if (!this.isEnabled) return '';

    const operationId = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const metric: SimplePerformanceMetrics = {
      operation,
      startTime: Date.now(),
      success: false
    };

    this.metrics.push(metric);
    return operationId;
  }

  /**
   * End timing an operation
   */
  endOperation(operationId: string, success: boolean = true, error?: string): void {
    if (!this.isEnabled) return;

    const metric = this.metrics.find(m => 
      m.operation === operationId.split('-')[0] && 
      !m.endTime
    );

    if (metric) {
      metric.endTime = Date.now();
      metric.duration = metric.endTime - metric.startTime;
      metric.success = success;
      if (error) metric.error = error;
    }
  }

  /**
   * Record cache hit/miss
   */
  recordCacheHit(cacheType: 'preprocessing' | 'audio', hit: boolean, duration: number): void {
    if (!this.isEnabled) return;

    this.cacheMetrics.push({
      cacheType,
      hit,
      duration,
      timestamp: Date.now()
    });
  }

  /**
   * Get performance statistics
   */
  getStats(): {
    totalOperations: number;
    averageDuration: number;
    successRate: number;
    cacheHitRate: number;
    recentMetrics: SimplePerformanceMetrics[];
  } {
    const completedMetrics = this.metrics.filter(m => m.endTime);
    const totalOperations = completedMetrics.length;
    const averageDuration = totalOperations > 0 
      ? completedMetrics.reduce((sum, m) => sum + (m.duration || 0), 0) / totalOperations 
      : 0;
    const successRate = totalOperations > 0 
      ? completedMetrics.filter(m => m.success).length / totalOperations 
      : 0;

    const totalCacheAttempts = this.cacheMetrics.length;
    const cacheHitRate = totalCacheAttempts > 0 
      ? this.cacheMetrics.filter(h => h.hit).length / totalCacheAttempts 
      : 0;

    return {
      totalOperations,
      averageDuration,
      successRate,
      cacheHitRate,
      recentMetrics: this.metrics.slice(-10) // Last 10 operations
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    preprocessing: { hits: number; misses: number; hitRate: number };
    audio: { hits: number; misses: number; hitRate: number };
  } {
    const preprocessing = this.cacheMetrics.filter(h => h.cacheType === 'preprocessing');
    const audio = this.cacheMetrics.filter(h => h.cacheType === 'audio');

    const calculateHitRate = (hits: SimpleCacheMetrics[]) => {
      const total = hits.length;
      const hitCount = hits.filter(h => h.hit).length;
      return total > 0 ? hitCount / total : 0;
    };

    return {
      preprocessing: {
        hits: preprocessing.filter(h => h.hit).length,
        misses: preprocessing.filter(h => !h.hit).length,
        hitRate: calculateHitRate(preprocessing)
      },
      audio: {
        hits: audio.filter(h => h.hit).length,
        misses: audio.filter(h => !h.hit).length,
        hitRate: calculateHitRate(audio)
      }
    };
  }

  /**
   * Export metrics for analysis
   */
  exportMetrics(): {
    metrics: SimplePerformanceMetrics[];
    cacheMetrics: SimpleCacheMetrics[];
    stats: any;
  } {
    return {
      metrics: [...this.metrics],
      cacheMetrics: [...this.cacheMetrics],
      stats: this.getStats()
    };
  }

  /**
   * Clear old metrics
   */
  clearOldMetrics(maxAge: number = 24 * 60 * 60 * 1000): void { // Default 24 hours
    const cutoff = Date.now() - maxAge;

    this.metrics = this.metrics.filter(m => 
      m.endTime && m.endTime > cutoff
    );

    this.cacheMetrics = this.cacheMetrics.filter(h => 
      h.timestamp > cutoff
    );
  }

  /**
   * Start background cleanup task
   */
  private startCleanupTask(): void {
    // Clean up old metrics every hour
    setInterval(() => {
      this.clearOldMetrics();
    }, 60 * 60 * 1000);
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = [];
    this.cacheMetrics = [];
  }
}

export default SimplePerformanceMonitor; 