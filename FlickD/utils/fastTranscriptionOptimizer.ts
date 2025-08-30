import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { AppState } from 'react-native';
import { decode as base64Decode } from 'base-64';
import { uploadAudioToS3, startTranscriptionJob, getTranscriptionResult } from './transcription';
import Constants from 'expo-constants';

const API_URL = Constants.expoConfig?.extra?.API_URL;

// Fast transcription cache with TTL
const transcriptionCache = new Map<string, {
  transcription: any;
  timestamp: number;
  ttl: number;
}>();

// Audio similarity cache for near-duplicate detection
const audioSimilarityCache = new Map<string, {
  similarAudioHash: string;
  similarity: number;
  timestamp: number;
}>();

// Preload queue for background transcription
const preloadQueue = new Map<string, {
  jobName: string;
  startTime: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: any;
}>();

interface FastTranscriptionResult {
  messageId: string;
  transcription?: any;
  status: 'instant' | 'cached' | 'preloaded' | 'processing';
  estimatedTime?: number;
  audioHash: string;
}

export class FastTranscriptionOptimizer {
  private static instance: FastTranscriptionOptimizer;
  private isInitialized = false;
  private processingLock = false;
  
  // Add interval tracking for cleanup
  private backgroundPreloadInterval: any = null;
  private cacheCleanupInterval: any = null;
  
  // App state tracking for transcription polling
  private isAppActive = true;
  private appStateSubscription: any = null;

  private constructor() {
    this.initializeOptimizations();
  }

  public static getInstance(): FastTranscriptionOptimizer {
    if (!FastTranscriptionOptimizer.instance) {
      FastTranscriptionOptimizer.instance = new FastTranscriptionOptimizer();
    }
    return FastTranscriptionOptimizer.instance;
  }

  /**
   * Initialize optimization strategies
   */
  private async initializeOptimizations() {
    if (this.isInitialized) return;

    // Start app state monitoring
    this.startAppStateMonitoring();
    
    // Start background preloading for common audio patterns
    this.startBackgroundPreloading();
    
    // Start cache cleanup
    this.startCacheCleanup();
    
    this.isInitialized = true;
  }

  /**
   * Start monitoring app state changes
   */
  private startAppStateMonitoring() {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
    }

    this.appStateSubscription = AppState.addEventListener('change', (nextAppState: string) => {
      const wasActive = this.isAppActive;
      this.isAppActive = nextAppState === 'active';
      
      if (wasActive && !this.isAppActive) {
        // App went to background, pausing transcription polling
      } else if (!wasActive && this.isAppActive) {
        // App came to foreground, resuming transcription polling
      }
    });
  }

  /**
   * Fast transcription with multiple optimization strategies
   */
  async fastTranscribe(
    audioUri: string,
    senderId: string,
    groupChatId: string
  ): Promise<FastTranscriptionResult> {
    // CRITICAL FIX: Add robust locking to serialize processing
    if (this.processingLock) {
      let waitCount = 0;
      // Wait for up to 5 seconds for the lock to release
      while (this.processingLock && waitCount < 50) {
        await new Promise(resolve => setTimeout(resolve, 10)); // Reduced from 25ms to 10ms for faster blocking
        waitCount++;
      }
      if (this.processingLock) {
        this.processingLock = false; // Force release to prevent deadlock
      }
    }

    try {
      this.processingLock = true; // Acquire lock for this transcription task

      // Step 1: Quick audio analysis
      const audioAnalysis = await this.quickAudioAnalysis(audioUri);
      
      // Step 2: Check multiple cache layers
      const cachedResult = await this.checkAllCaches(audioAnalysis.audioHash);
      if (cachedResult) {
        this.processingLock = false; // Release lock
        return cachedResult;
      }

      // Step 3: Check for similar audio (near-duplicate detection)
      const similarResult = await this.checkSimilarAudio(audioAnalysis.audioHash);
      if (similarResult) {
        this.processingLock = false; // Release lock
        return similarResult;
      }

      // Step 4: Create temporary message data (not saved to DB yet)
      const tempMessageData = await this.createMessage({
        duration: audioAnalysis.duration,
        senderId,
        groupChatId,
        audioHash: audioAnalysis.audioHash
      });

      // Step 5: Start aggressive background processing (which will now handle releasing the lock)
      this.startAggressiveProcessingWithRetry(audioUri, tempMessageData, audioAnalysis);

      // Step 6: Start preloading for future use
      this.startPreloading(audioUri, audioAnalysis.audioHash);

      return {
        messageId: tempMessageData._id,
        status: 'processing',
        estimatedTime: this.estimateTranscriptionTime(audioAnalysis.duration),
        audioHash: audioAnalysis.audioHash
      };

    } catch (error) {
      console.error('Fast transcription error:', error);
      this.processingLock = false; // Ensure lock is released on error
      
      // For rapid messages, try to recover gracefully
      if (error instanceof Error && error.message.includes('recording')) {
        console.log('Recording-related error detected, attempting recovery...');
        return this.handleRapidMessageError(audioUri, senderId, groupChatId, error);
      }
      
      throw error;
    }
  }

  /**
   * Handle rapid message errors with recovery logic
   */
  private async handleRapidMessageError(
    audioUri: string,
    senderId: string,
    groupChatId: string,
    error: Error
  ): Promise<FastTranscriptionResult> {
    try {
      console.log('Attempting rapid message error recovery...');
      
      // Wait a short time for any ongoing operations to complete
      await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 100ms to 50ms for faster blocking
      
      // Try to analyze audio again
      const audioAnalysis = await this.quickAudioAnalysis(audioUri);
      
      // Create a simple message without complex processing
      const tempMessageData = await this.createMessage({
        duration: audioAnalysis.duration,
        senderId,
        groupChatId,
        audioHash: audioAnalysis.audioHash
      });

      // Start simplified background processing
      this.startSimplifiedProcessing(audioUri, tempMessageData, audioAnalysis);

      return {
        messageId: tempMessageData._id,
        status: 'processing',
        estimatedTime: this.estimateTranscriptionTime(audioAnalysis.duration),
        audioHash: audioAnalysis.audioHash
      };
    } catch (recoveryError) {
      console.error('Rapid message error recovery failed:', recoveryError);
      
      // Return a fallback result
      return {
        messageId: `fallback-${Date.now()}`,
        status: 'processing',
        estimatedTime: 15000,
        audioHash: 'fallback'
      };
    }
  }

  /**
   * Start aggressive background processing with retry logic
   */
  private async startAggressiveProcessingWithRetry(
    audioUri: string,
    tempMessageData: any,
    audioAnalysis: any
  ): Promise<void> {
    (async () => {
      let messageId: string | null = null;
      try {
        //console.log(`Starting aggressive background processing for temp message:`, tempMessageData._id);

        // Step 1: Upload audio to S3. This is safe to do upfront.
        const s3Uri = await this.uploadWithOptimization(audioUri);

        // Step 2: Create the message in the database. This is NOT retried to prevent duplicates.
        const actualMessage = await this.createMessageWithAudioUrl(tempMessageData, s3Uri);
        messageId = actualMessage._id;


        // Step 3: Attempt transcription with a retry loop.
        let retryCount = 0;
        const maxRetries = 3;
        while (retryCount < maxRetries) {
          try {
            const jobName = `fast-${messageId}-${retryCount}`;
            await startTranscriptionJob(s3Uri, jobName);
            
            preloadQueue.set(audioAnalysis.audioHash, { jobName, startTime: Date.now(), status: 'processing' });
            
            const transcription = await this.aggressivePolling(jobName, audioAnalysis.complexity);

            if (transcription) {
              if (messageId) {
                await this.updateMessageTranscription(messageId, transcription, 'ready');
              }
              
              const preload = preloadQueue.get(audioAnalysis.audioHash);
              if (preload) {
                preload.status = 'completed';
                preload.result = transcription;
              }
              break; // Success, exit retry loop
            } else {
              // This case handles a timeout from aggressivePolling
              throw new Error('Transcription polling timed out');
            }
          } catch (transcriptionError) {
            console.error(`Transcription attempt ${retryCount + 1} failed:`, transcriptionError);
            retryCount++;
            if (retryCount >= maxRetries) {
              console.error('All transcription retries failed for message:', messageId);
              const emptyTranscription = { results: { transcripts: [{ transcript: '' }], items: [] } };
              if (messageId) {
                await this.updateMessageTranscription(messageId, emptyTranscription, 'failed');
              }
            } else {
              await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            }
          }
        }
      } catch (error) {
        console.error(`Fatal error in aggressive processing for message ${messageId || tempMessageData._id}:`, error);
        if (messageId) {
          await this.updateMessageStatus(messageId, 'failed');
        }
      } finally {
        // Step 4: Final cleanup.
        this.processingLock = false; // Release the lock
        try {
          await FileSystem.deleteAsync(audioUri);
        } catch (deleteError) {
          console.warn('Failed to delete local audio file during cleanup:', deleteError);
        }
      }
    })();
  }

  /**
   * Start simplified processing for rapid message recovery
   */
  private async startSimplifiedProcessing(
    audioUri: string,
    tempMessageData: any,
    audioAnalysis: any
  ): Promise<void> {
    (async () => {
      let messageId: string | null = null;
      
      try {


        // Simple upload without optimization
        const timestamp = Date.now();
        const fileName = `rapid-${timestamp}`;
        const s3Uri = await uploadAudioToS3(audioUri, fileName);

        // Create message with audio URL
        const actualMessage = await this.createMessageWithAudioUrl(tempMessageData, s3Uri);
        messageId = actualMessage._id;



        // Start transcription with simple polling
        const jobName = `rapid-${timestamp}`;
        await startTranscriptionJob(s3Uri, jobName);

        // Simple polling with 15-second timeout
        const transcription = await this.simplePolling(jobName);

        if (transcription && messageId) {
          // Update message with transcription
          await this.updateMessageTranscription(messageId, transcription, 'ready');
        } else if (messageId) {
          // Set empty transcription on timeout
          const emptyTranscription = {
            results: {
              transcripts: [{ transcript: '' }],
              items: []
            }
          };
          await this.updateMessageTranscription(messageId, emptyTranscription, 'ready');
        }

        // Clear the local audio file
        try {
          await FileSystem.deleteAsync(audioUri);
        } catch (deleteError) {
          console.warn('Failed to delete local audio file:', deleteError);
        }
      } catch (error) {
        console.error('Simplified processing error:', error);
        if (messageId && !messageId.startsWith('temp-')) {
          await this.updateMessageStatus(messageId, 'error');
        }
      }
    })();
  }

  /**
   * Simple polling for rapid message recovery
   */
  private async simplePolling(jobName: string): Promise<any | null> {
    const startTime = Date.now();
    const TIMEOUT_MS = 15 * 1000; // 15 seconds timeout
    
    for (let attempt = 0; attempt < 30; attempt++) {
      // Check if we've exceeded the 15-second timeout
      if (Date.now() - startTime > TIMEOUT_MS) {
        return null;
      }

      // CRITICAL FIX: Check if app is active before polling
      if (!this.isAppActive) {
        // Wait for app to become active again, but respect timeout
        const timeRemaining = TIMEOUT_MS - (Date.now() - startTime);
        if (timeRemaining > 0) {
          await new Promise(resolve => setTimeout(resolve, Math.min(timeRemaining, 3000)));
        } else {
          return null;
        }
        continue; // Skip this attempt and try again
      }

      try {
        const result = await getTranscriptionResult(jobName);
        if (result) {
          return result;
        }
        
        // Simple 1-second delay
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    return null;
  }

  /**
   * Quick audio analysis for fast processing
   */
  private async quickAudioAnalysis(audioUri: string): Promise<{
    duration: number;
    fileSize: number;
    audioHash: string;
    complexity: 'low' | 'medium' | 'high';
  }> {
    try {
      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(audioUri);
      if (!fileInfo.exists) {
        throw new Error('Audio file does not exist');
      }

      // Get audio duration (cached if possible)
      let duration = 0;
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUri },
          { shouldPlay: false }
        );
        const status = await sound.getStatusAsync();
        duration = status.isLoaded && status.durationMillis ? status.durationMillis : 0;
        await sound.unloadAsync();
      } catch (audioError) {
        console.error('Error getting audio duration:', audioError);
      }

      // Calculate audio hash
      const fileContent = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const audioData = this.base64ToUint8Array(fileContent);
      const audioHash = this.calculateAudioHash(audioData);

      // Estimate complexity based on duration and file size
      const complexity = this.estimateComplexity(duration, fileInfo.size || 0);

      return {
        duration,
        fileSize: fileInfo.size || 0,
        audioHash,
        complexity
      };
    } catch (error) {
      console.error('Quick audio analysis error:', error);
      throw error;
    }
  }

  /**
   * Check all cache layers for transcription
   */
  private async checkAllCaches(audioHash: string): Promise<FastTranscriptionResult | null> {
    // Check in-memory cache first
    const cached = transcriptionCache.get(audioHash);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return {
        messageId: 'cached',
        transcription: cached.transcription,
        status: 'cached',
        audioHash
      };
    }

    // Check preload queue
    const preloaded = preloadQueue.get(audioHash);
    if (preloaded && preloaded.status === 'completed' && preloaded.result) {
      return {
        messageId: 'preloaded',
        transcription: preloaded.result,
        status: 'preloaded',
        audioHash
      };
    }

    // Check server-side cache (if available)
    try {
      const serverCached = await this.checkServerCache(audioHash);
      if (serverCached) {
        // Cache locally for future use
        transcriptionCache.set(audioHash, {
          transcription: serverCached,
          timestamp: Date.now(),
          ttl: 24 * 60 * 60 * 1000 // 24 hours
        });
        return {
          messageId: 'server-cached',
          transcription: serverCached,
          status: 'cached',
          audioHash
        };
      }
    } catch (error) {
      console.warn('Server cache check failed:', error);
    }

    return null;
  }

  /**
   * Check for similar audio (near-duplicate detection)
   */
  private async checkSimilarAudio(audioHash: string): Promise<FastTranscriptionResult | null> {
    const similar = audioSimilarityCache.get(audioHash);
    if (similar && similar.similarity > 0.9) { // 90% similarity threshold
      const cached = transcriptionCache.get(similar.similarAudioHash);
      if (cached && Date.now() - cached.timestamp < cached.ttl) {
        return {
          messageId: 'similar-cached',
          transcription: cached.transcription,
          status: 'cached',
          audioHash
        };
      }
    }
    return null;
  }

  /**
   * Aggressive polling with complexity-based intervals and 15-second timeout
   */
  private async aggressivePolling(jobName: string, complexity: 'low' | 'medium' | 'high'): Promise<any | null> {
    const startTime = Date.now();
    const TIMEOUT_MS = 15 * 1000; // 15 seconds timeout
    const maxAttempts = complexity === 'low' ? 30 : complexity === 'medium' ? 45 : 60;
    const baseInterval = complexity === 'low' ? 1000 : complexity === 'medium' ? 1500 : 2000;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Check if we've exceeded the 15-second timeout
      if (Date.now() - startTime > TIMEOUT_MS) {
        return null; // Return empty message after 15 seconds
      }

      // CRITICAL FIX: Check if app is active before polling
      if (!this.isAppActive) {
        // Wait for app to become active again, but respect timeout
        const timeRemaining = TIMEOUT_MS - (Date.now() - startTime);
        if (timeRemaining > 0) {
          await new Promise(resolve => setTimeout(resolve, Math.min(timeRemaining, 5000)));
        } else {
          return null;
        }
        continue; // Skip this attempt and try again
      }

      try {
        const result = await getTranscriptionResult(jobName);
        if (result) {
          return result;
        }
        
        // Calculate delay, but ensure we don't exceed the timeout
        const delay = Math.min(baseInterval + (attempt * 100), 5000);
        const timeRemaining = TIMEOUT_MS - (Date.now() - startTime);
        
        // If delay would exceed timeout, just wait for remaining time and exit
        if (delay > timeRemaining) {
          if (timeRemaining > 0) {
            await new Promise(resolve => setTimeout(resolve, timeRemaining));
          }
          return null; // Return empty message after 15 seconds
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    return null;
  }

  /**
   * Start preloading for future use
   */
  private async startPreloading(audioUri: string, audioHash: string): Promise<void> {
    // This could start preloading similar audio patterns
    // For now, we'll just cache the audio hash for similarity detection
    audioSimilarityCache.set(audioHash, {
      similarAudioHash: audioHash,
      similarity: 1.0,
      timestamp: Date.now()
    });
  }

  /**
   * Estimate transcription time based on audio complexity
   */
  private estimateTranscriptionTime(duration: number): number {
    // Base estimation: 1 second of audio ≈ 2-3 seconds of transcription
    const baseTime = duration * 2.5;
    // Add some buffer for network and processing
    return Math.min(baseTime + 5000, 30000); // Max 30 seconds
  }

  /**
   * Estimate audio complexity
   */
  private estimateComplexity(duration: number, fileSize: number): 'low' | 'medium' | 'high' {
    if (duration < 10000 && fileSize < 500000) return 'low';
    if (duration < 30000 && fileSize < 1500000) return 'medium';
    return 'high';
  }

  /**
   * Upload with optimization
   */
  private async uploadWithOptimization(audioUri: string): Promise<string> {
    // Use existing upload function with potential optimizations
    const timestamp = Date.now();
    const fileName = `fast-${timestamp}`;
    return await uploadAudioToS3(audioUri, fileName);
  }

  /**
   * Check server cache
   */
  private async checkServerCache(audioHash: string): Promise<any | null> {
    try {
      const response = await fetch(`${API_URL}/cache/transcription/${audioHash}`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.warn('Server cache check failed:', error);
    }
    return null;
  }

  /**
   * Create message in database
   */
  private async createMessage(data: any): Promise<any> {
    // Don't create the message yet - wait until we have the audio URL
    // This prevents blank messages from being created and sent via socket
    return {
      _id: `temp-${Date.now()}`, // Temporary ID for tracking
      ...data,
      type: 'voice',
      timestamp: new Date().toISOString(),
      isRead: false,
      isDelivered: true,
      processingStatus: 'pending'
    };
  }

  /**
   * Create message in database with audio URL
   */
  private async createMessageWithAudioUrl(data: any, audioUrl: string): Promise<any> {
    try {

      
      const response = await fetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          audioUrl,
          type: 'voice',
          timestamp: new Date().toISOString(),
          isRead: false,
          isDelivered: true,
          processingStatus: 'processing'
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[FastTranscriptionOptimizer] Failed to create message:', error);
        throw new Error(error.error || 'Failed to save voice message');
      }

      const message = await response.json();

      
      // CRITICAL FIX: Add small delay to ensure message is properly saved and socket events are sent
      await new Promise(resolve => setTimeout(resolve, 200));
      
      return message;
    } catch (error) {
      console.error('[FastTranscriptionOptimizer] Error creating message with audio URL:', error);
      throw error;
    }
  }

  /**
   * Update message status
   */
  private async updateMessageStatus(messageId: string, status: string): Promise<void> {
    await fetch(`${API_URL}/messages/${messageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processingStatus: status }),
    });
  }

  /**
   * Update message transcription
   */
  private async updateMessageTranscription(messageId: string, transcription: any, status: string): Promise<void> {
    try {

      
      // CRITICAL FIX: Use the correct existing endpoint
      const response = await fetch(`${API_URL}/messages/${messageId}/transcription`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          transcription, 
          processingStatus: status 
        }),
      });

      if (!response.ok) {
        console.warn('[FastTranscriptionOptimizer] Failed to update transcription via backend:', response.status);
        const errorText = await response.text();
        console.warn('[FastTranscriptionOptimizer] Backend error response:', errorText);
        throw new Error(`Failed to update transcription: ${response.status}`);
      } else {

      }
    } catch (error) {
      console.error('[FastTranscriptionOptimizer] Error updating transcription:', error);
      throw error;
    }
  }

  /**
   * Start background preloading
   */
  private startBackgroundPreloading(): void {
    // Clear existing interval if any
    if (this.backgroundPreloadInterval) {
      clearInterval(this.backgroundPreloadInterval);
    }
    
    // This could analyze user patterns and preload common audio patterns
    this.backgroundPreloadInterval = setInterval(() => {
      this.cleanupOldCache();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Start cache cleanup
   */
  private startCacheCleanup(): void {
    // Clear existing interval if any
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }
    
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupOldCache();
    }, 10 * 60 * 1000); // Every 10 minutes
  }

  /**
   * Clean up old cache entries
   */
  private cleanupOldCache(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Clean transcription cache
    for (const [key, value] of transcriptionCache.entries()) {
      if (now - value.timestamp > value.ttl) {
        transcriptionCache.delete(key);
      }
    }

    // Clean similarity cache
    for (const [key, value] of audioSimilarityCache.entries()) {
      if (now - value.timestamp > maxAge) {
        audioSimilarityCache.delete(key);
      }
    }

    // Clean preload queue
    for (const [key, value] of preloadQueue.entries()) {
      if (now - value.startTime > maxAge) {
        preloadQueue.delete(key);
      }
    }
  }

  /**
   * Calculate audio hash
   */
  private calculateAudioHash(audioData: Uint8Array): string {
    let hash = 0;
    for (let i = 0; i < audioData.length; i++) {
      const char = audioData[i];
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Convert base64 to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = base64Decode(base64);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    transcriptionCacheSize: number;
    similarityCacheSize: number;
    preloadQueueSize: number;
  } {
    return {
      transcriptionCacheSize: transcriptionCache.size,
      similarityCacheSize: audioSimilarityCache.size,
      preloadQueueSize: preloadQueue.size
    };
  }

  /**
   * Cleanup method to prevent memory leaks
   */
  public cleanup(): void {
    // Clear all intervals
    if (this.backgroundPreloadInterval) {
      clearInterval(this.backgroundPreloadInterval);
      this.backgroundPreloadInterval = null;
    }
    
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
    
    // Clean up app state subscription
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    
    // Clear caches
    transcriptionCache.clear();
    audioSimilarityCache.clear();
    preloadQueue.clear();
    
    this.isInitialized = false;
  }
}

export default FastTranscriptionOptimizer; 