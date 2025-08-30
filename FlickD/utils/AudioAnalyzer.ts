import { Audio } from 'expo-av';

export class AudioAnalyzer {
  private bufferSize: number;
  private sound: Audio.Sound | null;
  private lastSamples: number[];
  private smoothingFactor: number = 0.3;
  private lastUpdateTime: number = 0;
  private phase: number = 0;

  constructor(bufferSize = 64) {
    this.bufferSize = bufferSize;
    this.sound = null;
    this.lastSamples = new Array(bufferSize).fill(0.1);
  }

  async setupAudio(sound: Audio.Sound) {
    this.sound = sound;
    this.lastSamples = new Array(this.bufferSize).fill(0.1);
    this.lastUpdateTime = Date.now();
    this.phase = 0;
    
    try {
      // Configure audio session for monitoring
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

  
    } catch (error) {
      console.error('Error setting up audio:', error);
      this.cleanup();
    }
  }

  async getFrequencyData(): Promise<Float32Array> {
    if (!this.sound) {
      return new Float32Array(this.bufferSize).fill(0.1);
    }

    try {
      const status = await this.sound.getStatusAsync();
      if (!status.isLoaded || !status.isPlaying) {
        return new Float32Array(this.bufferSize).fill(0.1);
      }

      // Calculate time-based phase
      const now = Date.now();
      const deltaTime = now - this.lastUpdateTime;
      this.lastUpdateTime = now;
      this.phase = (this.phase + deltaTime / 1000) % 1; // Update phase based on time

      // Create frequency bands with different characteristics
      const data = new Float32Array(this.bufferSize);
      for (let i = 0; i < this.bufferSize; i++) {
        // Calculate frequency characteristics
        const normalizedIndex = i / this.bufferSize;
        
        // Create multiple frequency components with more dynamic movement
        const lowFreq = Math.sin(2 * Math.PI * (this.phase + normalizedIndex * 0.5));
        const midFreq = Math.sin(4 * Math.PI * (this.phase + normalizedIndex * 0.7));
        const highFreq = Math.sin(8 * Math.PI * (this.phase + normalizedIndex * 0.9));
        
        // Enhanced weighting for more natural movement
        const weightedSum = 
          lowFreq * Math.pow(1 - normalizedIndex, 2) * 0.6 +
          midFreq * Math.pow(1 - Math.abs(normalizedIndex - 0.5), 2) * 0.3 +
          highFreq * Math.pow(normalizedIndex, 2) * 0.1;
        
        // Add controlled randomness with time-based variation
        const noise = (Math.random() - 0.5) * 0.15 * Math.sin(this.phase * Math.PI);
        
        // Enhanced smoothing with dynamic factor
        const dynamicSmoothing = this.smoothingFactor * (1 + Math.sin(this.phase * Math.PI) * 0.2);
        const smoothedValue = 
          dynamicSmoothing * (Math.abs(weightedSum) + noise) +
          (1 - dynamicSmoothing) * this.lastSamples[i];
        
        // Store for next frame
        this.lastSamples[i] = smoothedValue;
        
        // Enhanced scaling with non-linear transformation
        const scaledValue = Math.pow(smoothedValue, 1.5);
        data[i] = Math.max(0.1, Math.min(1.0, scaledValue));
      }

      return data;
    } catch (error) {
      console.error('Error getting frequency data:', error);
      return new Float32Array(this.bufferSize).fill(0.1);
    }
  }

  cleanup() {
    this.sound = null;
    this.lastSamples.fill(0.1);
  }
} 