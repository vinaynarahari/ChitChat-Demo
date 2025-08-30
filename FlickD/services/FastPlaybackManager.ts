import { Audio } from 'expo-av';
import { Message } from '../app/context/GroupChatContext';

interface PreloadedAudio {
  sound: Audio.Sound;
  duration: number;
  isReady: boolean;
  loadedAt: number;
  messageId: string;
  audioUrl: string;
}

interface PlaybackState {
  currentMessageId: string | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  queue: string[];
  currentIndex: number;
  skipMode: 'single' | 'auto' | 'bulk';
}

interface FastPlaybackCallbacks {
  onPlaybackStart?: (messageId: string) => void;
  onPlaybackComplete?: (messageId: string) => void;
  onPlaybackError?: (messageId: string, error: string) => void;
  onSkipComplete?: (fromMessageId: string, toMessageId: string, skippedCount: number) => void;
  onQueueComplete?: () => void;
  onMarkAsRead?: (messageId: string) => void;
  getAudioUrl?: (messageId: string) => Promise<string>;
  onSkipToLatestComplete?: () => void;
  onLastMessageSkip?: (messageId: string) => void;
  validateMessageType?: (messageId: string) => Promise<{ isValid: boolean; type?: string }>;
}

interface AudioCacheEntry {
  audioUrl: string;
  soundPromise: Promise<Audio.Sound>;
  sound?: Audio.Sound;
  duration: number;
  timestamp: number;
  isReady: boolean;
}

export class FastPlaybackManager {
  // Core state
  private playbackState: PlaybackState = {
    currentMessageId: null,
    isPlaying: false,
    position: 0,
    duration: 0,
    queue: [],
    currentIndex: -1,
    skipMode: 'single'
  };
  
  // Audio management
  private audioCache = new Map<string, AudioCacheEntry>();
  private preloadQueue = new Set<string>();
  private maxCacheSize = 20; // Keep 20 audio files preloaded
  private maxCacheAge = 10 * 60 * 1000; // 10 minutes
  
  // State management
  private callbacks: FastPlaybackCallbacks = {};
  private currentSound: Audio.Sound | null = null;
  private positionUpdateInterval: any = null;
  private cacheCleanupInterval: any = null; // Add cleanup interval tracking
  private isInitialized = false;
  
  // Performance tracking
  private metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    instantPlays: 0,
    totalPlays: 0,
    averageLoadTime: 0
  };

  public constructor() {}

  /**
   * Initialize the playback manager
   */
  public async initialize(callbacks: FastPlaybackCallbacks = {}): Promise<void> {
    if (this.isInitialized) return;
    
    this.callbacks = callbacks;
    
    // Set optimal audio mode for playback with maximum volume output
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
    
    // Start background cache cleanup
    this.startCacheCleanup();
    
    this.isInitialized = true;
  }

  /**
   * INSTANT PLAY - Main entry point for playing messages
   */
  public async playMessage(messageId: string, audioUrl: string, options: {
    queue?: string[];
    startIndex?: number;
    autoAdvance?: boolean;
  } = {}): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      // Stop any current playback immediately
      await this.stopCurrentPlayback();
      
      // Check if audio is already cached and ready
      const cached = this.audioCache.get(messageId);
      if (cached && cached.isReady && cached.sound) {
        this.metrics.cacheHits++;
        this.metrics.instantPlays++;
        
        // Set up state immediately
        this.playbackState = {
          currentMessageId: messageId,
          isPlaying: true,
          position: 0,
          duration: cached.duration,
          queue: options.queue || [],
          currentIndex: options.startIndex || 0,
          skipMode: 'single'
        };
        
        // Start playback instantly
        this.currentSound = cached.sound;
        await this.currentSound.setPositionAsync(0);
        await this.currentSound.playAsync();
        
        this.startPositionTracking();
        this.callbacks.onPlaybackStart?.(messageId);
        
        const loadTime = Date.now() - startTime;
        return true;
      }
      
      // Not cached - load quickly but not instant
      this.metrics.cacheMisses++;
      
      const sound = await this.loadAudioFast(messageId, audioUrl);
      if (!sound) {
        return false;
      }
      
      // Update state
      this.playbackState = {
        currentMessageId: messageId,
        isPlaying: true,
        position: 0,
        duration: 0,
        queue: options.queue || [],
        currentIndex: options.startIndex || 0,
        skipMode: 'single'
      };
      
      // Start playback
      this.currentSound = sound;
      await sound.playAsync();
      
      this.startPositionTracking();
      this.callbacks.onPlaybackStart?.(messageId);
      
      const loadTime = Date.now() - startTime;
      this.updateAverageLoadTime(loadTime);
      
      return true;
      
    } catch (error) {
      this.callbacks.onPlaybackError?.(messageId, error instanceof Error ? error.message : 'Unknown error');
      return false;
    } finally {
      this.metrics.totalPlays++;
    }
  }

  /**
   * INSTANT PAUSE/RESUME
   */
  public async pauseResume(): Promise<boolean> {
    if (!this.currentSound || !this.playbackState.currentMessageId) {
      return false;
    }
    
    try {
      if (this.playbackState.isPlaying) {
        await this.currentSound.pauseAsync();
        this.playbackState.isPlaying = false;
        this.stopPositionTracking();
      } else {
        await this.currentSound.playAsync();
        this.playbackState.isPlaying = true;
        this.startPositionTracking();
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * ULTRA-FAST SKIP - Skip to specific message or next/previous
   */
  public async skipToMessage(targetMessageId: string, options: {
    queue?: string[];
    markSkippedAsRead?: boolean;
  } = {}): Promise<boolean> {
    
    const queue = options.queue || this.playbackState.queue;
    const currentIndex = this.playbackState.currentIndex;
    const targetIndex = queue.indexOf(targetMessageId);
    
    if (targetIndex === -1) {
      return false;
    }
    
    // Calculate skipped messages using filter for better efficiency
    const minIndex = Math.min(currentIndex, targetIndex);
    const maxIndex = Math.max(currentIndex, targetIndex);
    const skippedMessages = queue.filter((_, index) => index >= minIndex && index <= maxIndex);
    
    // Mark skipped messages as read if requested
    if (options.markSkippedAsRead) {
      skippedMessages.forEach(messageId => {
        if (messageId !== targetMessageId) {
          this.callbacks.onMarkAsRead?.(messageId);
        }
      });
    }
    
    // ENHANCED: Get audio URL for target message with proper error handling
    let targetAudioUrl;
    try {
      targetAudioUrl = await this.getAudioUrl(targetMessageId);
      if (!targetAudioUrl) {
        // Mark skipped messages as read if requested
        if (options.markSkippedAsRead) {
          skippedMessages.forEach(messageId => {
            if (messageId !== targetMessageId) {
              this.callbacks.onMarkAsRead?.(messageId);
            }
          });
        }
        
        // Clear queue and trigger completion
        this.clearQueue();
        this.callbacks.onQueueComplete?.();
        return true; // Return true because we handled appropriately
      }
    } catch (error) {
      
      // Mark skipped messages as read if requested
      if (options.markSkippedAsRead) {
        skippedMessages.forEach(messageId => {
          this.callbacks.onMarkAsRead?.(messageId);
        });
      }
      
      // Clear queue and trigger completion
      this.clearQueue();
      this.callbacks.onQueueComplete?.();
      return true; // Return true because we handled the error gracefully
    }
    
    // Play target message instantly
    const success = await this.playMessage(targetMessageId, targetAudioUrl, {
      queue,
      startIndex: targetIndex
    });
    
    if (success) {
      this.callbacks.onSkipComplete?.(
        this.playbackState.currentMessageId || '',
        targetMessageId,
        skippedMessages.length - 1
      );
    }
    
    return success;
  }

  /**
   * SMART SKIP - Skip multiple messages at once with bulk processing
   */
  public async skipNext(count: number = 1): Promise<boolean> {
    const currentIndex = this.playbackState.currentIndex;
    const queue = this.playbackState.queue;
    
    // Check if we're already at the end or beyond the queue
    if (currentIndex >= queue.length - 1) {
      // Get current message ID for last message skip callback
      const currentMessageId = this.playbackState.currentMessageId || queue[currentIndex] || null;
      
      if (currentMessageId) {
        // Mark current message as read
        this.callbacks.onMarkAsRead?.(currentMessageId);
        
        // Stop current playback
        await this.stopCurrentPlayback();
        
        // Clear queue since we're done
        this.playbackState.queue = [];
        this.playbackState.currentIndex = -1;
        
        // Trigger queue completion and last message skip callbacks
        this.callbacks.onQueueComplete?.();
        this.callbacks.onLastMessageSkip?.(currentMessageId);
        
        return true;
      } else {
        // Still trigger queue completion
        await this.stopCurrentPlayback();
        this.callbacks.onQueueComplete?.();
        return true;
      }
    }
    
    const newIndex = Math.min(currentIndex + count, queue.length - 1);
    
    // Double check: if newIndex equals currentIndex, we're definitely at the end
    if (newIndex === currentIndex) {
      const currentMessageId = this.playbackState.currentMessageId || queue[currentIndex] || null;
      
      if (currentMessageId) {
        this.callbacks.onMarkAsRead?.(currentMessageId);
        await this.stopCurrentPlayback();
        this.playbackState.queue = [];
        this.playbackState.currentIndex = -1;
        this.callbacks.onQueueComplete?.();
        this.callbacks.onLastMessageSkip?.(currentMessageId);
        return true;
      } else {
        await this.stopCurrentPlayback();
        this.callbacks.onQueueComplete?.();
        return true;
      }
    }
    
    const targetMessageId = queue[newIndex];
    
    // Verify the target message exists before trying to skip to it
    if (!targetMessageId) {
      await this.stopCurrentPlayback();
      this.callbacks.onQueueComplete?.();
      return true;
    }
    

    
    // ENHANCED: Try to skip to target message with error handling
    try {
      return await this.skipToMessage(targetMessageId, { markSkippedAsRead: true });
    } catch (error) {
      // Mark current message as read if possible
      const currentMessageId = this.playbackState.currentMessageId || queue[currentIndex] || null;
      if (currentMessageId) {
        this.callbacks.onMarkAsRead?.(currentMessageId);
      }
      
      // Stop current playback and clear queue
      await this.stopCurrentPlayback();
      this.playbackState.queue = [];
      this.playbackState.currentIndex = -1;
      
      // Trigger completion callbacks
      this.callbacks.onQueueComplete?.();
      
      return true; // Return true because we handled the error gracefully
    }
  }

  /**
   * SKIP ON LAST MESSAGE - Handle skipping when already on the last message
   */
  public async skipOnLastMessage(messageId: string): Promise<boolean> {
    // Mark the message as read
    this.callbacks.onMarkAsRead?.(messageId);
    
    // Stop current playback
    await this.stopCurrentPlayback();
    
    // Clear queue since we're done
    this.playbackState.queue = [];
    this.playbackState.currentIndex = -1;
    
    // ENHANCED: Always trigger both completion callbacks for proper auto-recording handling
    
    // Trigger queue completion first
    this.callbacks.onQueueComplete?.();
    
    // Then trigger last message skip callback for auto-recording logic
    this.callbacks.onLastMessageSkip?.(messageId);
    
    return true;
  }

  /**
   * SKIP TO LATEST - Skip to the latest message in queue (multilevel skip)
   */
  public async skipToLatest(options: {
    markSkippedAsRead?: boolean;
  } = {}): Promise<boolean> {
    const queue = this.playbackState.queue;
    
    if (queue.length === 0) {
      this.callbacks.onQueueComplete?.();
      this.callbacks.onSkipToLatestComplete?.();
      return false;
    }
    
    const latestMessageId = queue[queue.length - 1];
    const currentIndex = this.playbackState.currentIndex;
    

    
    // Mark ALL skipped messages as read if requested (including currently playing one)
    if (options.markSkippedAsRead && currentIndex >= 0) {
      // Get all messages from current (inclusive) to second-to-last (excluding the latest we're about to play)
      const skippedMessages = queue.filter((_, index) => index >= currentIndex && index < queue.length - 1);
      
      skippedMessages.forEach(messageId => {
        this.callbacks.onMarkAsRead?.(messageId);
      });
    }
    
    // ENHANCED: Try to get audio URL for latest message with proper error handling
    try {
      const latestAudioUrl = await this.getAudioUrl(latestMessageId);
      if (!latestAudioUrl) {
        
        // Mark all messages as read since we can't play the latest one
        if (options.markSkippedAsRead) {
          queue.forEach(messageId => {
            this.callbacks.onMarkAsRead?.(messageId);
          });
        }
        
        // Clear queue and trigger completion
        this.clearQueue();
        this.callbacks.onQueueComplete?.();
        this.callbacks.onSkipToLatestComplete?.();
        return true; // Return true because we handled the skip appropriately
      }
      
      // Play latest message instantly
      const success = await this.playMessage(latestMessageId, latestAudioUrl, {
        queue,
        startIndex: queue.length - 1
      });
      
      if (success) {
        const skippedCount = Math.max(0, queue.length - 1 - currentIndex);

        
        this.callbacks.onSkipComplete?.(
          this.playbackState.currentMessageId || '',
          latestMessageId,
          skippedCount
        );
        
        // Trigger skip to latest completion callback
        this.callbacks.onSkipToLatestComplete?.();
      }
      
      return success;
      
    } catch (error) {
      // Mark all messages as read since we can't play any more
      if (options.markSkippedAsRead) {
        queue.forEach(messageId => {
          this.callbacks.onMarkAsRead?.(messageId);
        });
      }
      
      // Clear queue and trigger completion callbacks
      this.clearQueue();
      this.callbacks.onQueueComplete?.();
      this.callbacks.onSkipToLatestComplete?.();
      
      // Return true because we handled the error gracefully
      return true;
    }
  }

  /**
   * ULTRA-FAST SKIP TO LATEST - Optimized for large message queues (10+)
   * Uses background processing and batching to minimize UI blocking
   */
  public async ultraFastSkipToLatest(options: {
    messageIds: string[];
    userId?: string;
    onProgress?: (processed: number, total: number) => void;
    batchSize?: number;
  }): Promise<boolean> {
    const startTime = Date.now();
    const { messageIds, userId, onProgress, batchSize = 5 } = options;
    

    
    if (messageIds.length === 0) {
      return false;
    }
    
    // Step 1: INSTANTLY stop current playback (no await - fire and forget)
    this.stopCurrentPlayback().catch(() => {});
    
    // Step 2: INSTANTLY clear queue and update state
    this.playbackState.queue = [];
    this.playbackState.currentIndex = -1;
    this.playbackState.isPlaying = false;
    this.playbackState.currentMessageId = null;
    
    // Step 3: INSTANTLY trigger UI updates for immediate feedback
    this.callbacks.onQueueComplete?.();
    
    // Step 4: BACKGROUND processing of read status in batches (non-blocking)
    this.processReadStatusInBackground(messageIds, userId, batchSize, onProgress);
    
    // Step 5: Trigger skip to latest completion callback
    this.callbacks.onSkipToLatestComplete?.();
    
    const processingTime = Date.now() - startTime;
    
    return true;
  }

  /**
   * Background processor for marking messages as read (non-blocking)
   */
  private async processReadStatusInBackground(
    messageIds: string[], 
    userId?: string, 
    batchSize: number = 5,
    onProgress?: (processed: number, total: number) => void
  ): Promise<void> {

    
    let processed = 0;
    
    // Process in chunks to avoid blocking the UI
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      
      // Process batch with minimal delay
      await new Promise(resolve => {
        // Use requestAnimationFrame for smooth UI performance
        requestAnimationFrame(() => {
          batch.forEach(messageId => {
            this.callbacks.onMarkAsRead?.(messageId);
          });
          
          processed += batch.length;
          onProgress?.(processed, messageIds.length);
          resolve(void 0);
        });
      });
      
      // Tiny delay between batches to keep UI responsive
      if (i + batchSize < messageIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2));
      }
    }
    

  }

  /**
   * AGGRESSIVE PRELOADING - Preload audio files in background
   */
  public async preloadMessages(messageIds: string[], audioUrls: string[]): Promise<void> {

    
    // Preload in parallel but limit concurrency
    const concurrencyLimit = 3;
    const chunks = [];
    
    for (let i = 0; i < messageIds.length; i += concurrencyLimit) {
      chunks.push(messageIds.slice(i, i + concurrencyLimit));
    }
    
    for (const chunk of chunks) {
      const promises = chunk.map(async (messageId, index) => {
        const audioUrl = audioUrls[messageIds.indexOf(messageId)];
        if (audioUrl) {
          await this.preloadAudio(messageId, audioUrl);
        }
      });
      
      await Promise.allSettled(promises);
      
      // Small delay between chunks to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    

  }

  /**
   * BACKGROUND PRELOADING - Smart preloading based on queue position
   */
  public async startSmartPreloading(queue: string[], getAudioUrl: (id: string) => Promise<string>): Promise<void> {
    if (queue.length === 0) return;
    

    
    // Preload next 5 messages in background
    const currentIndex = this.playbackState.currentIndex;
    const preloadCount = Math.min(5, queue.length - currentIndex - 1);
    
    for (let i = 1; i <= preloadCount; i++) {
      const messageId = queue[currentIndex + i];
      if (messageId && !this.audioCache.has(messageId)) {
        // Preload in background without waiting
        this.preloadAudio(messageId, await getAudioUrl(messageId)).catch(error => {
        });
        
        // Small delay between preloads
        await new Promise(resolve => setTimeout(resolve, 15));
      }
    }
  }

  /**
   * Get current playback state
   */
  public getPlaybackState(): PlaybackState {
    return { ...this.playbackState };
  }

  /**
   * Get performance metrics
   */
  public getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.totalPlays > 0 ? this.metrics.cacheHits / this.metrics.totalPlays : 0,
      instantPlayRate: this.metrics.totalPlays > 0 ? this.metrics.instantPlays / this.metrics.totalPlays : 0,
      cacheSize: this.audioCache.size
    };
  }

  /**
   * Clear all cached audio
   */
  public async clearCache(): Promise<void> {

    
    for (const [messageId, entry] of this.audioCache.entries()) {
      if (entry.sound) {
        try {
          await entry.sound.unloadAsync();
        } catch (error) {
        }
      }
    }
    
    this.audioCache.clear();

  }

  /**
   * Cleanup resources
   */
  public async cleanup(): Promise<void> {
    await this.stopCurrentPlayback();
    await this.clearCache();
    
    // Clear all intervals to prevent memory leaks
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
    
    this.isInitialized = false;

  }

  // PRIVATE METHODS

  private async loadAudioFast(messageId: string, audioUrl: string): Promise<Audio.Sound | null> {
    try {
  
      
      // Check if already loading
      const existing = this.audioCache.get(messageId);
      if (existing && existing.soundPromise) {

        return await existing.soundPromise;
      }
      
      // Start loading
      const soundPromise = this.createSound(audioUrl);
      
      // Cache immediately (even before loading completes)
      this.audioCache.set(messageId, {
        audioUrl,
        soundPromise,
        duration: 0,
        timestamp: Date.now(),
        isReady: false
      });
      
      const sound = await soundPromise;
      
      // Get duration
      const status = await sound.getStatusAsync();
      const duration = status.isLoaded && status.durationMillis ? status.durationMillis : 0;
      
      // Update cache entry
      this.audioCache.set(messageId, {
        audioUrl,
        soundPromise,
        sound,
        duration,
        timestamp: Date.now(),
        isReady: true
      });
      
      // Set up status update callback
      sound.setOnPlaybackStatusUpdate((status) => {
        this.handlePlaybackStatusUpdate(status, messageId);
      });
      
      
      return sound;
      
    } catch (error) {
      this.audioCache.delete(messageId);
      return null;
    }
  }

  private async preloadAudio(messageId: string, audioUrl: string): Promise<void> {
    if (this.audioCache.has(messageId) || this.preloadQueue.has(messageId)) {
      return; // Already cached or preloading
    }
    
    if (this.audioCache.size >= this.maxCacheSize) {
      this.cleanupOldCache();
    }
    
    this.preloadQueue.add(messageId);
    
    try {
      const sound = await this.createSound(audioUrl);
      const status = await sound.getStatusAsync();
      const duration = status.isLoaded && status.durationMillis ? status.durationMillis : 0;
      
      this.audioCache.set(messageId, {
        audioUrl,
        soundPromise: Promise.resolve(sound),
        sound,
        duration,
        timestamp: Date.now(),
        isReady: true
      });
      
      
      
    } catch (error: any) {
    } finally {
      this.preloadQueue.delete(messageId);
    }
  }

  private async createSound(audioUrl: string): Promise<Audio.Sound> {
    const { sound } = await Audio.Sound.createAsync(
      { uri: audioUrl },
      {
        shouldPlay: false,
        progressUpdateIntervalMillis: 100,
        positionMillis: 0,
        volume: 1.0,
        rate: 1.0,
        shouldCorrectPitch: true
      }
    );
    
    // Set maximum volume after creation with additional boost
    await sound.setVolumeAsync(1.0);
    
    // Additional volume boost for Android devices
    try {
      // Set volume again after a brief delay to ensure it takes effect
      setTimeout(async () => {
        try {
          await sound.setVolumeAsync(1.0);
        } catch (error) {
        }
      }, 100);
    } catch (error) {
    }
    
    return sound;
  }

  private async stopCurrentPlayback(): Promise<void> {
    if (this.currentSound) {
      try {
        await this.currentSound.stopAsync();
      } catch (error) {
      }
    }
    
    this.stopPositionTracking();
    this.playbackState.isPlaying = false;
    this.playbackState.currentMessageId = null;
  }

  /**
   * Clear the entire queue instantly
   */
  public clearQueue(): void {

    this.playbackState.queue = [];
    this.playbackState.currentIndex = -1;
    this.playbackState.currentMessageId = null;
    this.playbackState.isPlaying = false;
  }

  private startPositionTracking(): void {
    this.stopPositionTracking();
    
    this.positionUpdateInterval = setInterval(async () => {
      if (this.currentSound && this.playbackState.isPlaying) {
        try {
          const status = await this.currentSound.getStatusAsync();
          if (status.isLoaded && status.positionMillis !== undefined) {
            this.playbackState.position = status.positionMillis;
            this.playbackState.duration = status.durationMillis || 0;
          }
        } catch (error) {
        }
      }
    }, 100);
  }

  private stopPositionTracking(): void {
    if (this.positionUpdateInterval) {
      clearInterval(this.positionUpdateInterval);
      this.positionUpdateInterval = null;
    }
  }

  private handlePlaybackStatusUpdate(status: any, messageId: string): void {
    if (status.isLoaded && status.didJustFinish) {
      
      this.callbacks.onPlaybackComplete?.(messageId);
      
      // Auto-advance to next if in queue mode
      if (this.playbackState.queue.length > 0) {
        const nextIndex = this.playbackState.currentIndex + 1;
        if (nextIndex < this.playbackState.queue.length) {
          const nextMessageId = this.playbackState.queue[nextIndex];
  
          setTimeout(() => {
            this.getAudioUrl(nextMessageId).then(audioUrl => {
              if (audioUrl) {
                this.playMessage(nextMessageId, audioUrl, {
                  queue: this.playbackState.queue,
                  startIndex: nextIndex
                });
              } else {
                this.clearQueue();
                this.callbacks.onQueueComplete?.();
              }
            }).catch((error: any) => {
              this.clearQueue();
              
              // Reset all playback states
              this.playbackState.isPlaying = false;
              this.playbackState.currentMessageId = null;
              
              // Stop current sound if playing
              this.stopCurrentPlayback().then(() => {
                // Trigger queue completion to allow auto-recording logic
                this.callbacks.onQueueComplete?.();
              }).catch(stopError => {
                this.callbacks.onQueueComplete?.();
              });
            });
          }, 100);
        } else {
          this.callbacks.onQueueComplete?.();
        }
      } else {
        // For single message playback, still call onQueueComplete to trigger auto-recording logic
        this.callbacks.onQueueComplete?.();
      }
    }
  }

  private async getAudioUrl(messageId: string): Promise<string | null> {
    // NEW: Validate message type before attempting to get audio URL
    if (this.callbacks.validateMessageType) {
      try {
        const validation = await this.callbacks.validateMessageType(messageId);
        if (!validation.isValid) {
          
          return null;
        }
      } catch (error) {
      }
    }
    
    if (this.callbacks.getAudioUrl) {
      try {
        return await this.callbacks.getAudioUrl(messageId);
      } catch (error) {
        return null;
      }
    }
    
    return null;
  }

  private cleanupOldCache(): void {
    const now = Date.now();
    const entriesToRemove: string[] = [];
    
    for (const [messageId, entry] of this.audioCache.entries()) {
      if (now - entry.timestamp > this.maxCacheAge) {
        entriesToRemove.push(messageId);
      }
    }
    
    // Remove oldest entries if cache is full
    if (this.audioCache.size >= this.maxCacheSize) {
      const sortedEntries = Array.from(this.audioCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const removeCount = Math.max(0, this.audioCache.size - this.maxCacheSize + 5);
      for (let i = 0; i < removeCount; i++) {
        entriesToRemove.push(sortedEntries[i][0]);
      }
    }
    
    // Clean up
    entriesToRemove.forEach(messageId => {
      const entry = this.audioCache.get(messageId);
      if (entry && entry.sound) {
        entry.sound.unloadAsync().catch(() => {});
      }
      this.audioCache.delete(messageId);
    });
    

  }

  private startCacheCleanup(): void {
    // Clear existing interval if any
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }
    
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupOldCache();
    }, 60000); // Clean up every minute
  }

  private updateAverageLoadTime(loadTime: number): void {
    if (this.metrics.totalPlays === 0) {
      this.metrics.averageLoadTime = loadTime;
    } else {
      this.metrics.averageLoadTime = (
        (this.metrics.averageLoadTime * (this.metrics.totalPlays - 1)) + loadTime
      ) / this.metrics.totalPlays;
    }
  }
}

export default FastPlaybackManager; 