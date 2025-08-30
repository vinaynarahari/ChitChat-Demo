const { voiceMessageCache } = require('./redisClient');
const { startTranscription } = require('./transcriptionHandler');
const { getIO } = require('../socket');
const { publishTranscriptionReady } = require('./redisPubSub');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');

// Enhanced cache service with preloading capabilities
class EnhancedCacheService {
  constructor() {
    this.preloadQueue = new Map();
    this.audioHashCache = new Map();
    this.transcriptionPredictor = new Map();
    this.isInitialized = false;
    
    // Add interval tracking for cleanup
    this.cacheCleanupInterval = null;
    this.predictiveModelInterval = null;
  }

  /**
   * Initialize the enhanced cache service
   */
  async initialize() {
    if (this.isInitialized) return;
    
    // Start background tasks
    this.startBackgroundTasks();
    this.isInitialized = true;
    console.log('Enhanced cache service initialized');
  }

  /**
   * Enhanced message processing with preloading
   */
  async processMessageWithPreloading(messageId, audioUrl, groupChatId, senderId) {
    try {
      console.log('Processing message with preloading:', messageId);

      // Step 1: Calculate audio hash for deduplication
      const audioHash = await this.generateAudioHash(audioUrl);
      
      // Step 2: Check for cached transcription
      const cachedTranscription = await voiceMessageCache.getTranscriptionByHash(audioHash);
      if (cachedTranscription) {
        console.log('Found cached transcription for audio hash:', audioHash);
        await this.handleTranscriptionComplete(messageId, cachedTranscription, groupChatId, audioHash);
        return { status: 'completed', cached: true };
      }

      // Step 3: Check if transcription is already preloading
      const preloadStatus = this.preloadQueue.get(audioHash);
      if (preloadStatus && preloadStatus.status === 'processing') {
        console.log('Transcription already preloading for audio hash:', audioHash);
        // Wait for preload to complete
        const result = await this.waitForPreload(audioHash, messageId);
        if (result) {
          return { status: 'completed', preloaded: true };
        }
      }

      // Step 4: Start transcription with enhanced caching
      const jobName = await this.startEnhancedTranscription(messageId, audioUrl, groupChatId, audioHash);
      
      // Step 5: Start preloading for similar audio patterns
      this.startPredictivePreloading(audioHash, groupChatId, senderId);

      return { status: 'processing', jobName };
    } catch (error) {
      console.error('Enhanced message processing error:', error);
      throw error;
    }
  }

  /**
   * Start enhanced transcription with better caching
   */
  async startEnhancedTranscription(messageId, audioUrl, groupChatId, audioHash) {
    try {
      // Cache audio hash mapping
      this.audioHashCache.set(audioHash, {
        messageId,
        audioUrl,
        groupChatId,
        timestamp: Date.now()
      });

      // Start transcription
      const jobName = await startTranscription(messageId, audioUrl, groupChatId);
      
      // Add to preload queue
      this.preloadQueue.set(audioHash, {
        jobName,
        messageId,
        status: 'processing',
        startTime: Date.now(),
        groupChatId
      });

      return jobName;
    } catch (error) {
      console.error('Enhanced transcription start error:', error);
      throw error;
    }
  }

  /**
   * Wait for preload to complete
   */
  async waitForPreload(audioHash, messageId, timeout = 30000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkPreload = () => {
        const preloadStatus = this.preloadQueue.get(audioHash);
        
        if (preloadStatus && preloadStatus.status === 'completed') {
          resolve(preloadStatus.result);
          return;
        }
        
        if (Date.now() - startTime > timeout) {
          resolve(null);
          return;
        }
        
        setTimeout(checkPreload, 1000);
      };
      
      checkPreload();
    });
  }

  /**
   * Start predictive preloading based on user patterns
   */
  async startPredictivePreloading(audioHash, groupChatId, senderId) {
    try {
      // Analyze user's transcription patterns
      const userPatterns = await this.analyzeUserPatterns(senderId, groupChatId);
      
      // If user frequently sends similar messages, preload transcription
      if (userPatterns.frequency > 0.7) { // 70% threshold
        console.log('Starting predictive preloading for user:', senderId);
        
        // This would start preloading transcription for similar audio patterns
        // Implementation depends on the specific prediction algorithm
      }
    } catch (error) {
      console.error('Predictive preloading error:', error);
    }
  }

  /**
   * Analyze user transcription patterns
   */
  async analyzeUserPatterns(senderId, groupChatId) {
    try {
      // Get user's recent messages
      const recentMessages = await this.getRecentUserMessages(senderId, groupChatId, 10);
      
      // Calculate patterns (simplified)
      const patterns = {
        frequency: recentMessages.length / 10, // Normalized frequency
        averageDuration: recentMessages.reduce((sum, msg) => sum + (msg.duration || 0), 0) / recentMessages.length,
        commonTopics: this.extractCommonTopics(recentMessages)
      };
      
      return patterns;
    } catch (error) {
      console.error('Pattern analysis error:', error);
      return { frequency: 0, averageDuration: 0, commonTopics: [] };
    }
  }

  /**
   * Get recent user messages
   */
  async getRecentUserMessages(senderId, groupChatId, limit = 10) {
    try {
      // Validate ObjectId format before converting
      if (!require('mongodb').ObjectId.isValid(groupChatId)) {
        console.error('[enhancedCacheService] Invalid groupChatId format in getRecentUserMessages:', groupChatId);
        return [];
      }

      const { getCollection } = require('../database/collections');
      const recordedMessagesCollection = getCollection('recordedMessages');
      
      const messages = await recordedMessagesCollection
        .find({
          senderId,
          groupChatId: new ObjectId(groupChatId),
          type: 'voice'
        })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
      
      return messages;
    } catch (error) {
      console.error('Error getting recent messages:', error);
      return [];
    }
  }

  /**
   * Extract common topics from messages
   */
  extractCommonTopics(messages) {
    // Simplified topic extraction
    const topics = [];
    messages.forEach(msg => {
      if (msg.transcription && msg.transcription.results) {
        const transcript = msg.transcription.results.transcripts?.[0]?.transcript || '';
        // Basic keyword extraction (would be more sophisticated in production)
        const keywords = transcript.toLowerCase().match(/\b\w+\b/g) || [];
        topics.push(...keywords);
      }
    });
    
    // Return most common topics
    const topicCount = {};
    topics.forEach(topic => {
      topicCount[topic] = (topicCount[topic] || 0) + 1;
    });
    
    return Object.entries(topicCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([topic]) => topic);
  }

  /**
   * Enhanced transcription completion handler
   */
  async handleTranscriptionComplete(messageId, transcription, groupChatId, audioHash) {
    try {
      // Update message in database
      const { getCollection } = require('../database/collections');
      const recordedMessagesCollection = getCollection('recordedMessages');
      
      await recordedMessagesCollection.updateOne(
        { _id: new ObjectId(messageId) },
        { 
          $set: { 
            transcription,
            processingStatus: 'completed',
            completedAt: new Date(),
            audioHash
          }
        }
      );

      // Cache transcription with enhanced TTL
      await Promise.all([
        voiceMessageCache.setTranscription(messageId, transcription),
        voiceMessageCache.setTranscriptionByHash(audioHash, transcription)
      ]);

      // Update preload queue
      const preloadStatus = this.preloadQueue.get(audioHash);
      if (preloadStatus) {
        preloadStatus.status = 'completed';
        preloadStatus.result = transcription;
        preloadStatus.completedAt = new Date();
      }

      // Publish event
      await publishTranscriptionReady(messageId, transcription);

      // Emit socket event
      const io = getIO();
      if (io) {
        io.to(groupChatId).emit('transcription:ready', {
          messageId,
          transcription
        });
      }

      console.log('Enhanced transcription completion handled:', messageId);
    } catch (error) {
      console.error('Enhanced transcription completion error:', error);
      throw error;
    }
  }

  /**
   * Generate audio hash for deduplication
   */
  async generateAudioHash(audioUrl) {
    try {
      // Use the existing hash generation logic
      const { generateAudioHash } = require('./transcriptionHandler');
      return await generateAudioHash(audioUrl);
    } catch (error) {
      console.error('Audio hash generation error:', error);
      return null;
    }
  }

  /**
   * Start background tasks
   */
  startBackgroundTasks() {
    // Clear existing intervals if any
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }
    if (this.predictiveModelInterval) {
      clearInterval(this.predictiveModelInterval);
    }
    
    // Clean up old cache entries every 5 minutes
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupOldCache();
    }, 5 * 60 * 1000);

    // Analyze patterns every 10 minutes
    this.predictiveModelInterval = setInterval(() => {
      this.updatePredictiveModels();
    }, 10 * 60 * 1000);
  }

  /**
   * Clean up old cache entries
   */
  cleanupOldCache() {
    try {
      const now = Date.now();
      const maxAge = 30 * 60 * 1000; // 30 minutes

      // Clean audio hash cache
      for (const [key, value] of this.audioHashCache.entries()) {
        if (now - value.timestamp > maxAge) {
          this.audioHashCache.delete(key);
        }
      }

      // Clean preload queue
      for (const [key, value] of this.preloadQueue.entries()) {
        if (now - value.startTime > maxAge) {
          this.preloadQueue.delete(key);
        }
      }

      console.log('Cache cleanup completed');
    } catch (error) {
      console.error('Cache cleanup error:', error);
    }
  }

  /**
   * Update predictive models
   */
  async updatePredictiveModels() {
    try {
      // This would update machine learning models for better prediction
      console.log('Updating predictive models');
    } catch (error) {
      console.error('Predictive model update error:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      audioHashCacheSize: this.audioHashCache.size,
      preloadQueueSize: this.preloadQueue.size,
      transcriptionPredictorSize: this.transcriptionPredictor.size,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Cleanup method to prevent memory leaks
   */
  cleanup() {
    // Clear all intervals
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
    
    if (this.predictiveModelInterval) {
      clearInterval(this.predictiveModelInterval);
      this.predictiveModelInterval = null;
    }
    
    // Clear caches
    this.audioHashCache.clear();
    this.preloadQueue.clear();
    this.transcriptionPredictor.clear();
    
    this.isInitialized = false;
    console.log('[EnhancedCacheService] ✅ Cleanup completed');
  }

  /**
   * Preload transcription for specific audio
   */
  async preloadTranscription(audioUrl, groupChatId) {
    try {
      const audioHash = await this.generateAudioHash(audioUrl);
      if (!audioHash) return null;

      // Check if already cached
      const cached = await voiceMessageCache.getTranscriptionByHash(audioHash);
      if (cached) {
        return { status: 'cached', transcription: cached };
      }

      // Start preloading
      const jobName = `preload-${audioHash}-${Date.now()}`;
      this.preloadQueue.set(audioHash, {
        jobName,
        status: 'processing',
        startTime: Date.now(),
        groupChatId
      });

      // Start transcription job
      await startTranscription(jobName, audioUrl, groupChatId);

      return { status: 'preloading', jobName };
    } catch (error) {
      console.error('Preload transcription error:', error);
      return null;
    }
  }
}

// Create singleton instance
const enhancedCacheService = new EnhancedCacheService();

module.exports = {
  enhancedCacheService,
  EnhancedCacheService
}; 