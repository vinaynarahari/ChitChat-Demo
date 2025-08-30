// Performance Configuration for ChitChat App
// This file controls performance-related settings to reduce CPU usage and improve battery life

export const PERFORMANCE_CONFIG = {
  // Logging Configuration (set to false in production)
  ENABLE_DEBUG_LOGS: false, // Disable debug logs to reduce CPU usage
  ENABLE_ANIMATION_LOGS: false, // Disable animation logs
  ENABLE_QUEUE_LOGS: false, // Disable queue processing logs
  ENABLE_RECORDING_LOGS: true, // Keep recording logs for debugging important features
  
  // Interval Configuration (optimized for performance)
  INTERVALS: {
    BACKGROUND_SYNC: 120000, // 2 minutes (reduced from 30 seconds)
    GROUP_CHAT_REFRESH: 180000, // 3 minutes (reduced from 30 seconds)
    RECORDING_STATE_CHECK: 30000, // 30 seconds (reduced from 10 seconds)
    QUEUE_MONITORING: 0, // Disabled (was 500ms aggressive polling)
  },
  
  // Cache Configuration
  CACHE: {
    MAX_MESSAGE_CACHE_SIZE: 100, // Maximum messages to keep in memory
    CACHE_CLEANUP_INTERVAL: 300000, // 5 minutes
    PRELOAD_MESSAGE_COUNT: 20, // Number of messages to preload
  },
  
  // Animation Configuration
  ANIMATIONS: {
    REDUCE_MOTION_ON_LOW_BATTERY: true,
    SKIP_NON_ESSENTIAL_ANIMATIONS: true,
    USE_NATIVE_DRIVER: true, // Always use native driver for better performance
  },
  
  // Network Configuration
  NETWORK: {
    BATCH_SIZE: 10, // Batch size for message processing
    REQUEST_TIMEOUT: 8000, // 8 seconds timeout
    RETRY_DELAY: 1000, // 1 second retry delay
  }
};

// Performance-aware logging utility
export const perfLog = {
  debug: (message: string, data?: any) => {
    if (PERFORMANCE_CONFIG.ENABLE_DEBUG_LOGS) {
      console.log(`[DEBUG] ${message}`, data);
    }
  },
  
  animation: (message: string, data?: any) => {
    if (PERFORMANCE_CONFIG.ENABLE_ANIMATION_LOGS) {
      console.log(`[ANIMATION] ${message}`, data);
    }
  },
  
  queue: (message: string, data?: any) => {
    if (PERFORMANCE_CONFIG.ENABLE_QUEUE_LOGS) {
      console.log(`[QUEUE] ${message}`, data);
    }
  },
  
  recording: (message: string, data?: any) => {
    if (PERFORMANCE_CONFIG.ENABLE_RECORDING_LOGS) {
      console.log(`[RECORDING] ${message}`, data);
    }
  },
  
  // Always log errors and warnings
  error: (message: string, error?: any) => {
    console.error(`[ERROR] ${message}`, error);
  },
  
  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${message}`, data);
  },
  
  // Always log important info
  info: (message: string, data?: any) => {
    console.log(`[INFO] ${message}`, data);
  }
};

// Performance monitoring utilities
export const performanceMonitor = {
  startTimer: (label: string) => {
    if (PERFORMANCE_CONFIG.ENABLE_DEBUG_LOGS) {
      console.time(label);
    }
  },
  
  endTimer: (label: string) => {
    if (PERFORMANCE_CONFIG.ENABLE_DEBUG_LOGS) {
      console.timeEnd(label);
    }
  },
  
  // Memory usage check (for development)
  checkMemory: () => {
    if (PERFORMANCE_CONFIG.ENABLE_DEBUG_LOGS && typeof window !== 'undefined' && (window as any).performance?.memory) {
      const memory = (window as any).performance.memory;
      console.log('[MEMORY]', {
        used: Math.round(memory.usedJSHeapSize / 1024 / 1024) + 'MB',
        total: Math.round(memory.totalJSHeapSize / 1024 / 1024) + 'MB',
        limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024) + 'MB'
      });
    }
  }
};

export default PERFORMANCE_CONFIG; 