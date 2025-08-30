import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { decode as base64Decode } from 'base-64';
import { s3Client, BUCKET_NAME } from '../config/aws-config';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { StartTranscriptionJobCommand, GetTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { transcribeClient } from '../config/aws-config';
import Constants from 'expo-constants';
import 'react-native-get-random-values';

const API_URL = Constants.expoConfig?.extra?.API_URL;

// Helper function to convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = base64Decode(base64);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Simple hash function for React Native (not cryptographically secure, but sufficient for deduplication)
async function simpleHash(data: Uint8Array): Promise<string> {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

// Audio preprocessing cache
const audioPreprocessingCache = new Map<string, {
  duration: number;
  fileSize: number;
  audioHash: string;
  preprocessedUri?: string;
  timestamp: number;
}>();

// Transcription preloading cache
const transcriptionPreloadCache = new Map<string, {
  jobName: string;
  startTime: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: any;
}>();

interface PreprocessingResult {
  duration: number;
  fileSize: number;
  audioHash: string;
  preprocessedUri: string;
  isOptimized: boolean;
}

interface PreloadTranscriptionResult {
  jobName: string;
  isPreloaded: boolean;
  estimatedCompletionTime?: number;
}

export class PreprocessingOptimizer {
  private static instance: PreprocessingOptimizer;
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): PreprocessingOptimizer {
    if (!PreprocessingOptimizer.instance) {
      PreprocessingOptimizer.instance = new PreprocessingOptimizer();
    }
    return PreprocessingOptimizer.instance;
  }

  /**
   * Preprocess audio file to extract metadata and optimize for upload
   */
  async preprocessAudio(uri: string): Promise<PreprocessingResult> {
    try {
      // Check cache first
      const cached = audioPreprocessingCache.get(uri);
      if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
        return {
          duration: cached.duration,
          fileSize: cached.fileSize,
          audioHash: cached.audioHash,
          preprocessedUri: cached.preprocessedUri || uri,
          isOptimized: !!cached.preprocessedUri
        };
      }

      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        throw new Error('Audio file does not exist');
      }

      // Get audio duration
      let duration = 0;
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false }
        );
        const status = await sound.getStatusAsync();
        duration = status.isLoaded && status.durationMillis ? status.durationMillis : 0;
        await sound.unloadAsync();
      } catch (audioError) {
        console.error('Error getting audio duration:', audioError);
      }

      // Calculate audio hash for deduplication
      const fileContent = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      // Convert base64 string to Uint8Array for hashing
      const audioData = base64ToUint8Array(fileContent);
      const audioHash = await this.calculateAudioHash(audioData);

      // Check if we have a cached transcription for this audio hash
      const cachedTranscription = await this.getCachedTranscription(audioHash);
      if (cachedTranscription) {
        transcriptionPreloadCache.set(audioHash, {
          jobName: `cached-${audioHash}`,
          startTime: Date.now(),
          status: 'completed',
          result: cachedTranscription
        });
      }

      // Optimize audio file if needed (compress, normalize, etc.)
      const preprocessedUri = await this.optimizeAudioFile(uri, duration);

      const result: PreprocessingResult = {
        duration,
        fileSize: fileInfo.size || 0,
        audioHash,
        preprocessedUri: preprocessedUri || uri,
        isOptimized: preprocessedUri !== uri
      };

      // Cache the result
      audioPreprocessingCache.set(uri, {
        ...result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      console.error('Audio preprocessing error:', error);
      throw error;
    }
  }

  /**
   * Preload transcription by starting the job early
   */
  async preloadTranscription(audioUri: string, audioHash: string): Promise<PreloadTranscriptionResult> {
    try {
      // Check if already preloading
      const existing = transcriptionPreloadCache.get(audioHash);
      if (existing) {
        return {
          jobName: existing.jobName,
          isPreloaded: true,
          estimatedCompletionTime: existing.status === 'completed' ? Date.now() : 
            existing.startTime + (30 * 1000) // Estimate 30 seconds for transcription
        };
      }

      // Check if we have cached transcription
      const cachedTranscription = await this.getCachedTranscription(audioHash);
      if (cachedTranscription) {
        transcriptionPreloadCache.set(audioHash, {
          jobName: `cached-${audioHash}`,
          startTime: Date.now(),
          status: 'completed',
          result: cachedTranscription
        });
        return {
          jobName: `cached-${audioHash}`,
          isPreloaded: true,
          estimatedCompletionTime: Date.now()
        };
      }

      // Start transcription job early
      const jobName = `preload-${audioHash}-${Date.now()}`;
      const s3Uri = await this.uploadToS3(audioUri, `preload-${audioHash}`);
      
      const command = new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        Media: { MediaFileUri: s3Uri },
        OutputBucketName: BUCKET_NAME,
        OutputKey: `transcriptions/${jobName}.json`,
        LanguageCode: 'en-US',
        Settings: {
          ShowSpeakerLabels: true,
          MaxSpeakerLabels: 2
        }
      });

      await transcribeClient.send(command);

      // Cache the preload job
      transcriptionPreloadCache.set(audioHash, {
        jobName,
        startTime: Date.now(),
        status: 'processing'
      });

      return {
        jobName,
        isPreloaded: true,
        estimatedCompletionTime: Date.now() + (30 * 1000) // Estimate 30 seconds
      };
    } catch (error) {
      console.error('Transcription preload error:', error);
      return {
        jobName: '',
        isPreloaded: false
      };
    }
  }

  /**
   * Get preloaded transcription result
   */
  async getPreloadedTranscription(audioHash: string): Promise<any | null> {
    const preload = transcriptionPreloadCache.get(audioHash);
    if (!preload) return null;

    if (preload.status === 'completed') {
      return preload.result;
    }

    if (preload.status === 'processing') {
      // Check if more than 15 seconds have passed since starting
      const timeElapsed = Date.now() - preload.startTime;
      if (timeElapsed > 15000) {
        // Mark as completed with empty transcription
        const emptyTranscription = {
          results: {
            transcripts: [{ transcript: '' }],
            items: []
          }
        };
        
        preload.status = 'completed';
        preload.result = emptyTranscription;
        return emptyTranscription;
      }

      // Check if transcription is complete
      try {
        const result = await this.checkTranscriptionStatus(preload.jobName);
        if (result) {
          preload.status = 'completed';
          preload.result = result;
          return result;
        }
      } catch (error) {
        console.error('Error checking transcription status:', error);
      }
    }

    return null;
  }

  /**
   * Optimize audio file for better upload and transcription performance
   */
  private async optimizeAudioFile(uri: string, duration: number): Promise<string | null> {
    try {
      // For now, return null to use original file
      // In the future, this could include:
      // - Audio compression
      // - Sample rate optimization
      // - Noise reduction
      // - Audio normalization
      return null;
    } catch (error) {
      console.error('Audio optimization error:', error);
      return null;
    }
  }

  /**
   * Calculate simple hash of audio data (React Native compatible)
   */
  private async calculateAudioHash(audioData: Uint8Array): Promise<string> {
    return await simpleHash(audioData);
  }

  /**
   * Upload audio to S3 for preloading
   */
  private async uploadToS3(uri: string, key: string): Promise<string> {
    try {
      const fileContent = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const audioData = base64ToUint8Array(fileContent);
      const s3Key = `preload/${key}.m4a`;

      const uploadParams = {
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: audioData,
        ContentType: 'audio/mp4',
        Metadata: {
          'x-amz-meta-preload': 'true'
        }
      };

      await s3Client.send(new PutObjectCommand(uploadParams));
      return `s3://${BUCKET_NAME}/${s3Key}`;
    } catch (error) {
      console.error('S3 upload error:', error);
      throw error;
    }
  }

  /**
   * Check transcription job status
   */
  private async checkTranscriptionStatus(jobName: string): Promise<any | null> {
    try {
      const command = new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName
      });

      const response = await transcribeClient.send(command);
      
      if (response.TranscriptionJob?.TranscriptionJobStatus === 'COMPLETED') {
        const transcriptionKey = `transcriptions/${jobName}.json`;
        const getObjectCommand = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: transcriptionKey
        });

        const transcriptionResponse = await s3Client.send(getObjectCommand);
        const transcriptionText = await transcriptionResponse.Body?.transformToString();
        
        if (transcriptionText) {
          return JSON.parse(transcriptionText);
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error checking transcription status:', error);
      return null;
    }
  }

  /**
   * Get cached transcription from Redis (placeholder)
   */
  private async getCachedTranscription(audioHash: string): Promise<any | null> {
    // This would integrate with the existing Redis cache
    // For now, return null
    return null;
  }

  /**
   * Clear old cache entries
   */
  clearOldCache(): void {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    // Clear old preprocessing cache
    for (const [key, value] of audioPreprocessingCache.entries()) {
      if (now - value.timestamp > maxAge) {
        audioPreprocessingCache.delete(key);
      }
    }

    // Clear old preload cache
    for (const [key, value] of transcriptionPreloadCache.entries()) {
      if (now - value.startTime > maxAge) {
        transcriptionPreloadCache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    preprocessingCacheSize: number;
    preloadCacheSize: number;
    totalMemoryUsage: number;
  } {
    return {
      preprocessingCacheSize: audioPreprocessingCache.size,
      preloadCacheSize: transcriptionPreloadCache.size,
      totalMemoryUsage: 0 // Would calculate actual memory usage
    };
  }
}

export default PreprocessingOptimizer; 