import { Audio } from 'expo-av';
import { Alert } from 'react-native';

interface RecordingState {
  recording: Audio.Recording | null;
  isRecording: boolean;
  duration: number;
  startTime: number;
}

interface PendingRecording {
  resolve: (value: string | null) => void;
  reject: (reason?: any) => void;
  timestamp: number;
}

// BULLETPROOF Recording Service with Queue Integration
class RecordingService {
  private static instance: RecordingService;
  private state: RecordingState = {
    recording: null,
    isRecording: false,
    duration: 0,
    startTime: 0
  };
  
  private listeners: ((state: RecordingState) => void)[] = [];
  private timer: any = null;
  private isProcessing: boolean = false;
  private pendingRecordings: PendingRecording[] = [];
  private lastError: string | null = null;
  private errorCount: number = 0;
  private maxRetries: number = 3;
  private isInQueue: boolean = false; // Track if this recording is from queue

  private constructor() {}

  static getInstance(): RecordingService {
    if (!RecordingService.instance) {
      RecordingService.instance = new RecordingService();
    }
    return RecordingService.instance;
  }

  // BULLETPROOF: Set queue status for this recording attempt
  setQueueStatus(inQueue: boolean) {
    this.isInQueue = inQueue;
  }

  subscribe(listener: (state: RecordingState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener({ ...this.state }));
  }

  private async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('[RecordingService] Permission request failed:', error);
      return false;
    }
  }

  // BULLETPROOF: Enhanced start recording with queue integration
  async startRecording(): Promise<boolean> {
    // BULLETPROOF CHECK 1: Already recording
    if (this.state.isRecording) {
      return true;
    }

    // BULLETPROOF CHECK 2: Processing lock
    if (this.isProcessing) {
      console.error('[RecordingService] ❌ Recording already in progress');
      return false;
    }

    // BULLETPROOF CHECK 3: Error threshold
    if (this.errorCount >= this.maxRetries) {
      console.error('[RecordingService] ❌ Max recording errors reached, blocking further attempts');
      return false;
    }

    try {
      this.isProcessing = true;
      
      // Request permissions
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        this.isProcessing = false;
        return false;
      }

      // BULLETPROOF CLEANUP: Ensure clean state
      await this.safeCleanup();

      // Set audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // BULLETPROOF DELAY: Prevent race conditions
      await new Promise(resolve => setTimeout(resolve, 10));

      // Create and prepare recording
      const newRecording = new Audio.Recording();
      
      try {
        await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await newRecording.startAsync();
      } catch (prepareError) {
        // BULLETPROOF ERROR HANDLING: Clean up failed recording
        try {
          await newRecording.stopAndUnloadAsync();
        } catch (cleanupError) {
          // Ignore cleanup errors for failed recordings
        }
        throw prepareError;
      }

      // Update state
      this.state = {
        recording: newRecording,
        isRecording: true,
        duration: 0,
        startTime: Date.now()
      };

      // Start timer
      this.timer = setInterval(() => {
        this.state.duration = Math.floor((Date.now() - this.state.startTime) / 1000);
        this.notifyListeners();
      }, 1000);

      this.notifyListeners();
      this.errorCount = 0; // Reset error count on success
      this.lastError = null;
      
      // Only log success for queue recordings or first attempt
      if (this.isInQueue || this.errorCount === 0) {
        // Removed: console.log('[RecordingService] ✅ Recording started successfully');
      }
      
      return true;

    } catch (error) {
      this.errorCount++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Only log errors that are different from the last one
      if (errorMessage !== this.lastError) {
        console.error('[RecordingService] ❌ Recording failed:', errorMessage);
        this.lastError = errorMessage;
      }
      
      await this.safeCleanup();
      return false;
    } finally {
      this.isProcessing = false;
    }
  }

  async stopRecording(): Promise<string | null> {
    if (!this.state.recording || !this.state.isRecording) {
      return null;
    }

    if (this.isProcessing) {
      console.error('[RecordingService] ❌ Cannot stop - recording is processing');
      return null;
    }

    try {
      this.isProcessing = true;

      await this.state.recording.stopAndUnloadAsync();
      const uri = this.state.recording.getURI();

      if (!uri) {
        throw new Error('No recording URI available');
      }

      await this.cleanup();
      this.processPendingRecordings(uri);
      
      return uri;

    } catch (error) {
      console.error('[RecordingService] ❌ Failed to stop recording:', error);
      await this.cleanup();
      this.processPendingRecordings(null);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }

  async cancelRecording(): Promise<void> {
    if (!this.state.recording) return;

    try {
      await this.state.recording.stopAndUnloadAsync();
    } catch (error) {
      // Ignore errors when canceling
    }
    
    await this.cleanup();
  }

  // BULLETPROOF: Safe cleanup that never throws
  private async safeCleanup(): Promise<void> {
    try {
      if (this.state.recording) {
        await this.state.recording.stopAndUnloadAsync();
      }
    } catch (error) {
      // Ignore cleanup errors - recording might be in invalid state
    }
    
    this.state.recording = null;

    // Reset audio mode to playback mode (stereo speakers) even during errors
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('[RecordingService] Error resetting audio mode in safeCleanup:', error);
    }
  }

  private async cleanup(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.state = {
      recording: null,
      isRecording: false,
      duration: 0,
      startTime: 0
    };

    this.isInQueue = false; // Reset queue status
    this.notifyListeners();

    // Reset audio mode to playback mode (stereo speakers)
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('[RecordingService] Error resetting audio mode:', error);
    }
  }

  private processPendingRecordings(result: string | null): void {
    const pending = this.pendingRecordings.splice(0);
    pending.forEach(p => p.resolve(result));
  }

  isCurrentlyRecording(): boolean {
    return this.state.isRecording;
  }

  // BULLETPROOF: Reset error state
  resetErrorState(): void {
    this.errorCount = 0;
    this.lastError = null;
  }
}

export default RecordingService;
export type { RecordingState }; 