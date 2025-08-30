interface PerformanceMetrics {
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

interface CacheHitMetrics {
  cacheType: 'preprocessing' | 'transcription' | 'audioHash';
  hit: boolean;
  duration: number;
  timestamp: number;
}

interface PreloadMetrics {
  preloadType: 'transcription' | 'audio' | 'predictive';
  success: boolean;
  duration: number;
  timestamp: number;
  estimatedTimeSaved?: number;
}

class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: PerformanceMetrics[] = [];
  private cacheHits: CacheHitMetrics[] = [];
  private preloadMetrics: PreloadMetrics[] = [];
  private isEnabled: boolean = true;

  private constructor() {
    // Start background cleanup
    this.startCleanupTask();
  }

  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Start timing an operation
   */
  startOperation(operation: string, metadata?: Record<string, any>): string {
    if (!this.isEnabled) return '';

    const operationId = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const metric: PerformanceMetrics = {
      operation,
      startTime: Date.now(),
      success: false,
      metadata
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
  recordCacheHit(cacheType: 'preprocessing' | 'transcription' | 'audioHash', hit: boolean, duration: number): void {
    if (!this.isEnabled) return;

    this.cacheHits.push({
      cacheType,
      hit,
      duration,
      timestamp: Date.now()
    });
  }

  /**
   * Record preload metrics
   */
  recordPreload(preloadType: 'transcription' | 'audio' | 'predictive', success: boolean, duration: number, estimatedTimeSaved?: number): void {
    if (!this.isEnabled) return;

    this.preloadMetrics.push({
      preloadType,
      success,
      duration,
      timestamp: Date.now(),
      estimatedTimeSaved
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
    preloadSuccessRate: number;
    timeSaved: number;
    recentMetrics: PerformanceMetrics[];
  } {
    const completedMetrics = this.metrics.filter(m => m.endTime);
    const totalOperations = completedMetrics.length;
    const averageDuration = totalOperations > 0 
      ? completedMetrics.reduce((sum, m) => sum + (m.duration || 0), 0) / totalOperations 
      : 0;
    const successRate = totalOperations > 0 
      ? completedMetrics.filter(m => m.success).length / totalOperations 
      : 0;

    const totalCacheAttempts = this.cacheHits.length;
    const cacheHitRate = totalCacheAttempts > 0 
      ? this.cacheHits.filter(h => h.hit).length / totalCacheAttempts 
      : 0;

    const totalPreloads = this.preloadMetrics.length;
    const preloadSuccessRate = totalPreloads > 0 
      ? this.preloadMetrics.filter(p => p.success).length / totalPreloads 
      : 0;

    const timeSaved = this.preloadMetrics
      .filter(p => p.estimatedTimeSaved)
      .reduce((sum, p) => sum + (p.estimatedTimeSaved || 0), 0);

    return {
      totalOperations,
      averageDuration,
      successRate,
      cacheHitRate,
      preloadSuccessRate,
      timeSaved,
      recentMetrics: this.metrics.slice(-10) // Last 10 operations
    };
  }

  /**
   * Get detailed cache statistics
   */
  getCacheStats(): {
    preprocessing: { hits: number; misses: number; hitRate: number };
    transcription: { hits: number; misses: number; hitRate: number };
    audioHash: { hits: number; misses: number; hitRate: number };
  } {
    const preprocessing = this.cacheHits.filter(h => h.cacheType === 'preprocessing');
    const transcription = this.cacheHits.filter(h => h.cacheType === 'transcription');
    const audioHash = this.cacheHits.filter(h => h.cacheType === 'audioHash');

    const calculateHitRate = (hits: CacheHitMetrics[]) => {
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
      transcription: {
        hits: transcription.filter(h => h.hit).length,
        misses: transcription.filter(h => !h.hit).length,
        hitRate: calculateHitRate(transcription)
      },
      audioHash: {
        hits: audioHash.filter(h => h.hit).length,
        misses: audioHash.filter(h => !h.hit).length,
        hitRate: calculateHitRate(audioHash)
      }
    };
  }

  /**
   * Get preload statistics
   */
  getPreloadStats(): {
    transcription: { success: number; failed: number; successRate: number; averageTimeSaved: number };
    audio: { success: number; failed: number; successRate: number; averageTimeSaved: number };
    predictive: { success: number; failed: number; successRate: number; averageTimeSaved: number };
  } {
    const transcription = this.preloadMetrics.filter(p => p.preloadType === 'transcription');
    const audio = this.preloadMetrics.filter(p => p.preloadType === 'audio');
    const predictive = this.preloadMetrics.filter(p => p.preloadType === 'predictive');

    const calculateStats = (metrics: PreloadMetrics[]) => {
      const total = metrics.length;
      const success = metrics.filter(m => m.success).length;
      const successRate = total > 0 ? success / total : 0;
      const timeSavedMetrics = metrics.filter(m => m.estimatedTimeSaved);
      const averageTimeSaved = timeSavedMetrics.length > 0 
        ? timeSavedMetrics.reduce((sum, m) => sum + (m.estimatedTimeSaved || 0), 0) / timeSavedMetrics.length 
        : 0;

      return {
        success,
        failed: total - success,
        successRate,
        averageTimeSaved
      };
    };

    return {
      transcription: calculateStats(transcription),
      audio: calculateStats(audio),
      predictive: calculateStats(predictive)
    };
  }

  /**
   * Export metrics for analysis
   */
  exportMetrics(): {
    metrics: PerformanceMetrics[];
    cacheHits: CacheHitMetrics[];
    preloadMetrics: PreloadMetrics[];
    stats: any;
  } {
    return {
      metrics: [...this.metrics],
      cacheHits: [...this.cacheHits],
      preloadMetrics: [...this.preloadMetrics],
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

    this.cacheHits = this.cacheHits.filter(h => 
      h.timestamp > cutoff
    );

    this.preloadMetrics = this.preloadMetrics.filter(p => 
      p.timestamp > cutoff
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
    this.cacheHits = [];
    this.preloadMetrics = [];
  }
}

export default PerformanceMonitor; 