import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { decode as base64Decode } from 'base-64';

// Simple hash function for React Native
function simpleHash(data: Uint8Array): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

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

// Simple in-memory cache for client-side optimizations
const audioCache = new Map<string, {
  duration: number;
  fileSize: number;
  audioHash: string;
  timestamp: number;
}>();

interface SimplePreprocessingResult {
  duration: number;
  fileSize: number;
  audioHash: string;
  isOptimized: boolean;
}

export class SimpleOptimizer {
  private static instance: SimpleOptimizer;

  private constructor() {}

  public static getInstance(): SimpleOptimizer {
    if (!SimpleOptimizer.instance) {
      SimpleOptimizer.instance = new SimpleOptimizer();
    }
    return SimpleOptimizer.instance;
  }

  /**
   * Simple audio preprocessing for React Native
   */
  async preprocessAudio(uri: string): Promise<SimplePreprocessingResult> {
    try {
      // Check cache first
      const cached = audioCache.get(uri);
      if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
        return {
          duration: cached.duration,
          fileSize: cached.fileSize,
          audioHash: cached.audioHash,
          isOptimized: false
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

      // Calculate simple audio hash for deduplication
      const fileContent = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const audioData = base64ToUint8Array(fileContent);
      const audioHash = simpleHash(audioData);

      const result: SimplePreprocessingResult = {
        duration,
        fileSize: fileInfo.size || 0,
        audioHash,
        isOptimized: false
      };

      // Cache the result
      audioCache.set(uri, {
        ...result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      console.error('Simple audio preprocessing error:', error);
      throw error;
    }
  }

  /**
   * Clear old cache entries
   */
  clearOldCache(): void {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [key, value] of audioCache.entries()) {
      if (now - value.timestamp > maxAge) {
        audioCache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    cacheSize: number;
    totalMemoryUsage: number;
  } {
    return {
      cacheSize: audioCache.size,
      totalMemoryUsage: 0
    };
  }

  /**
   * Check if audio is cached
   */
  isAudioCached(uri: string): boolean {
    const cached = audioCache.get(uri);
    return cached && (Date.now() - cached.timestamp < 300000);
  }

  /**
   * Get cached audio data
   */
  getCachedAudio(uri: string): SimplePreprocessingResult | null {
    const cached = audioCache.get(uri);
    if (cached && Date.now() - cached.timestamp < 300000) {
      return {
        duration: cached.duration,
        fileSize: cached.fileSize,
        audioHash: cached.audioHash,
        isOptimized: false
      };
    }
    return null;
  }
}

export default SimpleOptimizer; 