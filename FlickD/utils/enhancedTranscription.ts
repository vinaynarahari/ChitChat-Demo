import { PreprocessingOptimizer } from './preprocessingOptimizer';
import { uploadAudioToS3, startTranscriptionJob, getTranscriptionResult } from './transcription';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';

const API_URL = Constants.expoConfig?.extra?.API_URL;

interface EnhancedTranscriptionResult {
  messageId: string;
  audioUrl: string;
  duration: number;
  transcription?: any;
  processingStatus: 'pending' | 'processing' | 'ready' | 'error';
  preloadedTranscription?: boolean;
  estimatedCompletionTime?: number;
}

export class EnhancedTranscriptionService {
  private static instance: EnhancedTranscriptionService;
  private optimizer: PreprocessingOptimizer;

  private constructor() {
    this.optimizer = PreprocessingOptimizer.getInstance();
  }

  public static getInstance(): EnhancedTranscriptionService {
    if (!EnhancedTranscriptionService.instance) {
      EnhancedTranscriptionService.instance = new EnhancedTranscriptionService();
    }
    return EnhancedTranscriptionService.instance;
  }

  /**
   * Enhanced transcription with preprocessing and preloading
   */
  async transcribeWithOptimization(
    audioUri: string,
    senderId: string,
    groupChatId: string
  ): Promise<EnhancedTranscriptionResult> {
    try {
      console.log('Starting enhanced transcription with optimization');

      // Step 1: Preprocess audio (extract metadata, calculate hash, check cache)
      const preprocessing = await this.optimizer.preprocessAudio(audioUri);
      console.log('Audio preprocessing completed:', preprocessing);

      // Step 2: Create message immediately with pending status
      const messageData = await this.createMessage({
        audioUrl: null,
        duration: preprocessing.duration,
        senderId,
        groupChatId,
        audioHash: preprocessing.audioHash
      });

      // Step 3: Check for preloaded transcription
      const preloadedTranscription = await this.optimizer.getPreloadedTranscription(preprocessing.audioHash);
      
      if (preloadedTranscription) {
        console.log('Using preloaded transcription');
        // Update message with transcription immediately
        await this.updateMessageTranscription(messageData._id, preloadedTranscription, 'ready');
        
        return {
          messageId: messageData._id,
          audioUrl: messageData.audioUrl || '',
          duration: preprocessing.duration,
          transcription: preloadedTranscription,
          processingStatus: 'ready',
          preloadedTranscription: true
        };
      }

      // Step 4: Start background processing
      this.processInBackground(audioUri, messageData._id, preprocessing);

      // Step 5: Start preloading for future use
      this.optimizer.preloadTranscription(audioUri, preprocessing.audioHash).catch(error => {
        console.error('Preload error (non-blocking):', error);
      });

      return {
        messageId: messageData._id,
        audioUrl: messageData.audioUrl || '',
        duration: preprocessing.duration,
        processingStatus: 'pending',
        estimatedCompletionTime: Date.now() + (30 * 1000) // Estimate 30 seconds
      };
    } catch (error) {
      console.error('Enhanced transcription error:', error);
      throw error;
    }
  }

  /**
   * Create message in database
   */
  private async createMessage(data: {
    audioUrl: string | null;
    duration: number;
    senderId: string;
    groupChatId: string;
    audioHash: string;
  }): Promise<any> {
    const response = await fetch(`${API_URL}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioUrl: data.audioUrl,
        duration: data.duration,
        senderId: data.senderId,
        groupChatId: data.groupChatId,
        type: 'voice',
        timestamp: new Date().toISOString(),
        isRead: false,
        isDelivered: true,
        processingStatus: 'pending',
        audioHash: data.audioHash
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save voice message');
    }

    return await response.json();
  }

  /**
   * Update message transcription
   */
  private async updateMessageTranscription(
    messageId: string,
    transcription: any,
    status: 'processing' | 'ready' | 'error'
  ): Promise<void> {
    await fetch(`${API_URL}/messages/${messageId}/transcription`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcription,
        processingStatus: status
      }),
    });
  }

  /**
   * Process audio in background
   */
  private async processInBackground(
    audioUri: string,
    messageId: string,
    preprocessing: any
  ): Promise<void> {
    (async () => {
      try {
        console.log('Starting background processing for message:', messageId);

        // Update status to processing
        await fetch(`${API_URL}/messages/${messageId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            processingStatus: 'processing'
          }),
        });

        // Upload to S3
        const timestamp = Date.now();
        const fileName = `recording-${timestamp}`;
        const s3Uri = await uploadAudioToS3(preprocessing.preprocessedUri, fileName);

        // Update message with S3 URL
        await fetch(`${API_URL}/messages/${messageId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioUrl: s3Uri,
            processingStatus: 'uploading'
          }),
        });

        // Start transcription
        const jobName = `transcription-${timestamp}`;
        await startTranscriptionJob(s3Uri, jobName);

        // Poll for transcription with exponential backoff and 15-second timeout
        const transcription = await this.pollTranscriptionWithBackoff(jobName);

        if (transcription) {
          // Update message with transcription
          await this.updateMessageTranscription(messageId, transcription, 'ready');
          console.log('Background processing completed for message:', messageId);
        } else {
          // Transcription timed out after 15 seconds, set empty transcription
          console.log('Transcription timed out after 15 seconds, setting empty transcription for message:', messageId);
          
          const emptyTranscription = {
            results: {
              transcripts: [{ transcript: '' }],
              items: []
            }
          };

          // Update message with empty transcription
          await this.updateMessageTranscription(messageId, emptyTranscription, 'ready');
          console.log('Empty transcription set for timed out message:', messageId);
        }

        // Clear the local audio file
        try {
          await FileSystem.deleteAsync(audioUri);
        } catch (deleteError) {
          console.warn('Failed to delete local audio file:', deleteError);
        }
      } catch (error) {
        console.error('Background processing error:', error);
        // Update message status to error
        await fetch(`${API_URL}/messages/${messageId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            processingStatus: 'error'
          }),
        });
      }
    })();
  }

  /**
   * Poll for transcription with exponential backoff and 15-second timeout
   */
  private async pollTranscriptionWithBackoff(jobName: string, retryCount = 0, startTime?: number): Promise<any | null> {
    const pollStartTime = startTime || Date.now();
    const TIMEOUT_MS = 15 * 1000; // 15 seconds timeout
    
    // Check if we've exceeded the 15-second timeout
    if (Date.now() - pollStartTime > TIMEOUT_MS) {
      console.log(`[EnhancedTranscription] Transcription timeout after 15 seconds for job: ${jobName}`);
      return null; // Return empty message after 15 seconds
    }

    try {
      const result = await getTranscriptionResult(jobName);
      if (result) {
        return result;
      }
      
      // Exponential backoff: 2^retryCount * 1000ms, max 10 seconds
      const delay = Math.min(Math.pow(2, retryCount) * 1000, 10000);
      const timeRemaining = TIMEOUT_MS - (Date.now() - pollStartTime);
      
      // If delay would exceed timeout, just wait for remaining time and exit
      if (delay > timeRemaining) {
        if (timeRemaining > 0) {
          await new Promise(resolve => setTimeout(resolve, timeRemaining));
        }
        console.log(`[EnhancedTranscription] Transcription timeout after 15 seconds for job: ${jobName}`);
        return null; // Return empty message after 15 seconds
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.pollTranscriptionWithBackoff(jobName, retryCount + 1, pollStartTime);
    } catch (error) {
      console.error('Error polling transcription:', error);
      
      // Check timeout before continuing
      if (Date.now() - pollStartTime > TIMEOUT_MS) {
        console.log(`[EnhancedTranscription] Transcription timeout after 15 seconds for job: ${jobName}`);
        return null; // Return empty message after 15 seconds
      }
      
      return null;
    }
  }

  /**
   * Preload transcription for future use
   */
  async preloadTranscription(audioUri: string): Promise<void> {
    try {
      const preprocessing = await this.optimizer.preprocessAudio(audioUri);
      await this.optimizer.preloadTranscription(audioUri, preprocessing.audioHash);
    } catch (error) {
      console.error('Preload error:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.optimizer.getCacheStats();
  }

  /**
   * Clear old cache entries
   */
  clearOldCache(): void {
    this.optimizer.clearOldCache();
  }
}

export default EnhancedTranscriptionService; 