const { getCollection } = require('../database/collections');
const { ObjectId } = require('mongodb');

/**
 * PHASE 3: Advanced Caching and Preloading Service
 * Implements intelligent caching strategies for near-instantaneous message delivery
 */
class AdvancedCacheService {
  constructor() {
    this.messageCache = new Map();
    this.userCache = new Map();
    this.groupCache = new Map();
    this.preloadQueue = new Map();
    this.accessPatterns = new Map();
    this.summaryCache = new Map(); // PHASE 3: Summary caching
    this.maxCacheSize = 1000;
    this.preloadThreshold = 0.7; // Preload if access probability > 70%
    this.summaryCacheTTL = 5 * 60 * 1000; // 5 minutes for summaries
  }

  /**
   * Initialize the advanced cache service
   */
  async initialize() {
    console.log('[AdvancedCacheService] Initializing advanced caching system...');
    
    // Start background preloading
    this.startBackgroundPreloading();
    
    // Start cache cleanup
    setInterval(() => this.cleanupCache(), 5 * 60 * 1000); // Every 5 minutes
    
    console.log('[AdvancedCacheService] Advanced caching system initialized');
  }

  /**
   * Cache message metadata for instant access
   */
  async cacheMessage(messageId, messageData) {
    try {
      const cacheEntry = {
        data: messageData,
        timestamp: Date.now(),
        accessCount: 0,
        lastAccessed: Date.now()
      };
      
      this.messageCache.set(messageId, cacheEntry);
      
      // Track access patterns for preloading
      this.trackAccessPattern(messageData.groupChatId, messageId);
      
      console.log('[AdvancedCacheService] Cached message:', messageId);
    } catch (error) {
      console.error('[AdvancedCacheService] Error caching message:', error);
    }
  }

  /**
   * Get cached message with access tracking
   */
  async getCachedMessage(messageId) {
    const cacheEntry = this.messageCache.get(messageId);
    if (cacheEntry) {
      cacheEntry.accessCount++;
      cacheEntry.lastAccessed = Date.now();
      console.log('[AdvancedCacheService] Cache hit for message:', messageId);
      return cacheEntry.data;
    }
    
    console.log('[AdvancedCacheService] Cache miss for message:', messageId);
    return null;
  }

  /**
   * PHASE 3: Cache summary for instant access
   */
  async cacheSummary(groupId, userId, summaryData) {
    try {
      const cacheKey = `${groupId}:${userId}:summary`;
      const cacheEntry = {
        data: summaryData,
        timestamp: Date.now(),
        accessCount: 0,
        lastAccessed: Date.now()
      };
      
      this.summaryCache.set(cacheKey, cacheEntry);
      console.log('[AdvancedCacheService] Cached summary for:', cacheKey);
    } catch (error) {
      console.error('[AdvancedCacheService] Error caching summary:', error);
    }
  }

  /**
   * PHASE 3: Get cached summary with access tracking
   */
  async getCachedSummary(groupId, userId) {
    const cacheKey = `${groupId}:${userId}:summary`;
    const cacheEntry = this.summaryCache.get(cacheKey);
    
    if (cacheEntry) {
      const now = Date.now();
      const age = now - cacheEntry.timestamp;
      
      // Check if cache entry is still valid
      if (age < this.summaryCacheTTL) {
        cacheEntry.accessCount++;
        cacheEntry.lastAccessed = now;
        console.log('[AdvancedCacheService] Cache hit for summary:', cacheKey);
        return cacheEntry.data;
      } else {
        // Remove expired entry
        this.summaryCache.delete(cacheKey);
        console.log('[AdvancedCacheService] Expired summary cache entry removed:', cacheKey);
      }
    }
    
    console.log('[AdvancedCacheService] Cache miss for summary:', cacheKey);
    return null;
  }

  /**
   * PHASE 3: Generate and cache summary in background
   */
  async generateAndCacheSummary(groupId, userId) {
    try {
      console.log('[AdvancedCacheService] Generating summary in background for:', groupId, userId);
      
      // Get unread messages efficiently
      const recordedMessagesCollection = getCollection('recordedMessages');
      const messageReadStatusCollection = getCollection('messageReadStatus');
      
      // Get read status
      const readStatus = await messageReadStatusCollection.findOne({
        userId: new ObjectId(userId),
        groupChatId: new ObjectId(groupId)
      });
      
      const lastReadAt = readStatus?.lastReadAt || new Date(0);
      
      // Get unread messages with optimized query
      const unreadMessages = await recordedMessagesCollection.find({
        groupChatId: new ObjectId(groupId),
        timestamp: { $gt: lastReadAt },
        senderId: { $ne: new ObjectId(userId) }
      }).limit(50).toArray(); // Limit to prevent excessive processing
      
      if (unreadMessages.length === 0) {
        const summaryData = {
          summary: null,
          messageCount: 0,
          lastUpdated: null
        };
        await this.cacheSummary(groupId, userId, summaryData);
        return summaryData;
      }
      
      // Extract transcripts efficiently
      const transcripts = unreadMessages
        .filter(msg => msg.transcription)
        .map(msg => msg.transcription);
      
      if (transcripts.length === 0) {
        const summaryData = {
          summary: null,
          messageCount: unreadMessages.length,
          lastUpdated: unreadMessages[0]?.timestamp || null
        };
        await this.cacheSummary(groupId, userId, summaryData);
        return summaryData;
      }
      
      // Generate summary
      const summary = this.generateSummaryFromTranscripts(transcripts);
      const summaryData = {
        summary: summary,
        messageCount: unreadMessages.length,
        lastUpdated: unreadMessages[0]?.timestamp || null
      };
      
      await this.cacheSummary(groupId, userId, summaryData);
      console.log('[AdvancedCacheService] Summary generated and cached for:', groupId, userId);
      return summaryData;
      
    } catch (error) {
      console.error('[AdvancedCacheService] Error generating summary:', error);
      return null;
    }
  }

  /**
   * PHASE 3: Generate summary from transcripts (optimized version)
   */
  generateSummaryFromTranscripts(transcripts) {
    if (!Array.isArray(transcripts) || transcripts.length === 0) return '';
    
    const transcriptTexts = transcripts.map(t => {
      if (typeof t === 'string') return t;
      if (t.results?.transcripts?.[0]?.transcript) return t.results.transcripts[0].transcript;
      if (t.transcription?.results?.transcripts?.[0]?.transcript) return t.transcription.results.transcripts[0].transcript;
      if (t.results?.items) {
        return t.results.items.map(item => item.alternatives?.[0]?.content || '').join(' ').replace(/\s+/g, ' ').trim();
      }
      return '';
    });
    
    const text = transcriptTexts.map(t => t.trim()).filter(t => t.length > 0).join('. ');
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    
    if (sentences.length === 0) return '';
    if (sentences.length <= 3) return text;
    
    const firstSentence = sentences[0];
    const middleSentence = sentences[Math.floor(sentences.length / 2)];
    const lastSentence = sentences[sentences.length - 1];
    const summary = [firstSentence, middleSentence, lastSentence].filter(s => s && s.length > 0).join('. ');
    
    return summary.endsWith('.') ? summary : summary + '.';
  }

  /**
   * Preload messages for a group based on access patterns
   */
  async preloadGroupMessages(groupId) {
    try {
      console.log('[AdvancedCacheService] Preloading messages for group:', groupId);
      
      // Get recent messages for the group
      const recordedMessagesCollection = getCollection('recordedMessages');
      const recentMessages = await recordedMessagesCollection
        .find({ groupChatId: groupId })
        .sort({ timestamp: -1 })
        .limit(20)
        .toArray();
      
      // Cache each message
      for (const message of recentMessages) {
        await this.cacheMessage(message._id.toString(), message);
      }
      
      console.log('[AdvancedCacheService] Preloaded', recentMessages.length, 'messages for group:', groupId);
    } catch (error) {
      console.error('[AdvancedCacheService] Error preloading group messages:', error);
    }
  }

  /**
   * Track access patterns for intelligent preloading
   */
  trackAccessPattern(groupId, messageId) {
    if (!this.accessPatterns.has(groupId)) {
      this.accessPatterns.set(groupId, {
        messageAccesses: new Map(),
        totalAccesses: 0,
        lastAccessed: Date.now()
      });
    }
    
    const pattern = this.accessPatterns.get(groupId);
    pattern.totalAccesses++;
    pattern.lastAccessed = Date.now();
    
    const messageAccesses = pattern.messageAccesses.get(messageId) || 0;
    pattern.messageAccesses.set(messageId, messageAccesses + 1);
  }

  /**
   * Start background preloading based on access patterns
   */
  startBackgroundPreloading() {
    setInterval(async () => {
      try {
        // Find groups with high access probability
        const groupsToPreload = [];
        
        for (const [groupId, pattern] of this.accessPatterns) {
          const timeSinceLastAccess = Date.now() - pattern.lastAccessed;
          const accessProbability = this.calculateAccessProbability(pattern, timeSinceLastAccess);
          
          if (accessProbability > this.preloadThreshold) {
            groupsToPreload.push(groupId);
          }
        }
        
        // Preload messages for high-probability groups
        for (const groupId of groupsToPreload.slice(0, 5)) { // Limit to 5 groups
          await this.preloadGroupMessages(groupId);
        }
        
        console.log('[AdvancedCacheService] Background preloading completed for', groupsToPreload.length, 'groups');
      } catch (error) {
        console.error('[AdvancedCacheService] Background preloading error:', error);
      }
    }, 30 * 1000); // Every 30 seconds
  }

  /**
   * Calculate access probability based on patterns
   */
  calculateAccessProbability(pattern, timeSinceLastAccess) {
    const timeDecay = Math.exp(-timeSinceLastAccess / (5 * 60 * 1000)); // 5 minute decay
    const frequencyScore = Math.min(pattern.totalAccesses / 100, 1); // Normalize to 0-1
    return (frequencyScore * 0.7) + (timeDecay * 0.3);
  }

  /**
   * Clean up old cache entries
   */
  cleanupCache() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    // Clean message cache
    for (const [messageId, entry] of this.messageCache) {
      if (now - entry.lastAccessed > maxAge) {
        this.messageCache.delete(messageId);
      }
    }
    
    // Clean summary cache
    for (const [summaryKey, entry] of this.summaryCache) {
      if (now - entry.timestamp > this.summaryCacheTTL) {
        this.summaryCache.delete(summaryKey);
      }
    }
    
    // Clean access patterns
    for (const [groupId, pattern] of this.accessPatterns) {
      if (now - pattern.lastAccessed > maxAge) {
        this.accessPatterns.delete(groupId);
      }
    }
    
    console.log('[AdvancedCacheService] Cache cleanup completed');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      messageCacheSize: this.messageCache.size,
      userCacheSize: this.userCache.size,
      groupCacheSize: this.groupCache.size,
      accessPatternsCount: this.accessPatterns.size,
      preloadQueueSize: this.preloadQueue.size,
      summaryCacheSize: this.summaryCache.size // PHASE 3: Add summary cache stats
    };
  }
}

// Create singleton instance
const advancedCacheService = new AdvancedCacheService();

module.exports = {
  AdvancedCacheService,
  advancedCacheService
}; 