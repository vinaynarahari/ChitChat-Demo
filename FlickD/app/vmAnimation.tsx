import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions, Alert } from 'react-native';
import Slider from '@react-native-community/slider';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { AudioAnalyzer } from '../utils/AudioAnalyzer';
import { useRecording } from '../hooks/useRecording';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Type definitions for expo-av
interface PlaybackStatus {
  isLoaded: boolean;
  error?: string;
}

interface PlaybackStatusError extends PlaybackStatus {
  isLoaded: false;
  error: string;
}

interface PlaybackStatusSuccess extends PlaybackStatus {
  isLoaded: true;
  isPlaying: boolean;
  positionMillis: number;
  durationMillis: number;
  didJustFinish?: boolean;
  isBuffering: boolean;
}

// Type guard for loaded status
function isPlaybackStatusSuccess(status: PlaybackStatus): status is PlaybackStatusSuccess {
  return status.isLoaded === true;
}

const WaveformVisualizer = ({ 
  frequencyData,
  isPlaying 
}: { 
  frequencyData: Float32Array;
  isPlaying: boolean;
}) => {
  const animatedValues = useRef<Animated.Value[]>(
    Array(64).fill(0).map(() => new Animated.Value(0.1))
  ).current;

  useEffect(() => {
    if (!isPlaying) {
      // Reset bars when paused with quick animation
      animatedValues.forEach((value: Animated.Value) => {
        Animated.spring(value, {
          toValue: 0.1,
          damping: 5,
          mass: 0.2,
          stiffness: 100,
          useNativeDriver: true,
        }).start();
      });
      return;
    }

    // Animate each bar based on frequency data
    frequencyData.forEach((value: number, idx: number) => {
      if (idx < animatedValues.length) {
        // Enhanced scaling for better visual response
        const scaledValue = Math.pow(value, 1.2); // Emphasize higher values
        
        Animated.spring(animatedValues[idx], {
          toValue: 0.1 + scaledValue * 1.4, // Increased range of motion
          damping: 14,    // More damping for smoother movement
          mass: 0.8,      // Increased mass for more natural motion
          stiffness: 180, // Higher stiffness for faster response
          useNativeDriver: true,
        }).start();
      }
    });
  }, [isPlaying, frequencyData]);

  return (
    <View style={styles.waveformContainer}>
      {animatedValues.map((animation, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              transform: [{ scaleY: animation }],
              backgroundColor: '#282828',
            },
          ]}
        />
      ))}
    </View>
  );
};

export default function VMAnimation() {
  const { isRecording, startRecording: startCentralizedRecording, stopRecording: stopCentralizedRecording } = useRecording();
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frequencyData, setFrequencyData] = useState<Float32Array>(new Float32Array(64).fill(0.1));
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  
  const audioAnalyzer = useRef<AudioAnalyzer>(new AudioAnalyzer());
  const animationFrame = useRef<number | null>(null);

  useEffect(() => {
    setupPermissions();
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
      if (audioAnalyzer.current) {
        audioAnalyzer.current.cleanup();
      }
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

  const setupPermissions = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        setError('Permission to access microphone is required.');
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
      setError('Failed to get microphone permissions');
    }
  };

  const startRecording = async () => {
    try {
      // Reset states
      if (sound) {
        await sound.unloadAsync();
        setSound(null);
      }
      setPosition(0);
      setDuration(0);
      setIsPlaying(false);

      const success = await startCentralizedRecording();
      if (!success) {
        setError('Failed to start recording');
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      setError('Failed to start recording');
    }
  };

  const stopRecording = async () => {
    try {
      const uri = await stopCentralizedRecording();
      if (uri) {
        setRecordingUri(uri);
        console.log('Setting up audio for recorded file');
        await setupAudio(uri);
      } else {
        throw new Error('No URI obtained from recording');
      }
    } catch (error: any) {
      console.error('Failed to stop recording:', error);
      setError(`Recording error: ${error.message}`);
    }
  };

  const updateFrequencyData = async () => {
    if (!audioAnalyzer.current) {
      console.log('No audio analyzer available');
      return;
    }

    try {
      // Always cancel the previous frame before requesting a new one
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }

      const newData = await audioAnalyzer.current.getFrequencyData();
      setFrequencyData(newData);
      
      // Request next frame before checking isPlaying to ensure smooth animation
      animationFrame.current = requestAnimationFrame(updateFrequencyData);
      
      // If we're not playing, cancel the just-requested frame
      if (!isPlaying) {
        console.log('Animation stopped - playback paused');
        if (animationFrame.current) {
          cancelAnimationFrame(animationFrame.current);
          animationFrame.current = null;
        }
      }
    } catch (error) {
      console.error('Error updating frequency data:', error);
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }
    }
  };

  const setupAudio = async (uri: string) => {
    try {
      console.log('Setting up audio for URI:', uri);
      
      if (!uri) {
        throw new Error('No audio URI provided');
      }

      if (sound) {
        console.log('Unloading existing sound');
        await sound.unloadAsync();
        setSound(null);
      }

      console.log('Setting up audio mode');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false, // Don't duck for maximum volume
        playThroughEarpieceAndroid: false,
      });

      setIsLoading(true);
      setError(null);

      console.log('Creating new sound instance');
      const { sound: audioSound } = await Audio.Sound.createAsync(
        { uri },
        { 
          progressUpdateIntervalMillis: 50,
          shouldPlay: false,
          volume: 1.0,
          positionMillis: 0,
          isLooping: false,
          rate: 1.0,
          shouldCorrectPitch: true,
        },
        onPlaybackStatusUpdate
      );
      
      // Ensure maximum volume after creation
      await audioSound.setVolumeAsync(1.0);
      
      const initialStatus = await audioSound.getStatusAsync();
      console.log('Initial sound status:', initialStatus);
      
      if (isPlaybackStatusSuccess(initialStatus)) {
        setSound(audioSound);
        setDuration(initialStatus.durationMillis || 0);
        setPosition(0);
        await audioAnalyzer.current.setupAudio(audioSound);
        console.log('Audio setup completed successfully');
      } else {
        throw new Error('Failed to initialize sound');
      }
    } catch (error: any) {
      console.error('Error in audio setup:', error);
      setError(`Failed to initialize audio: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const onPlaybackStatusUpdate = (status: PlaybackStatus) => {
    if (isPlaybackStatusSuccess(status)) {
      setPosition(status.positionMillis);
      
      // Handle buffering state
      if (status.isBuffering) {
        console.log('Audio is buffering...');
        return;
      }
      
      const wasPlaying = isPlaying;
      const nowPlaying = status.isPlaying;
      
      if (wasPlaying !== nowPlaying) {
        console.log('Playback status changed:', nowPlaying ? 'playing' : 'paused', 'at position:', status.positionMillis);
        setIsPlaying(nowPlaying);
        
        if (nowPlaying && !animationFrame.current) {
          console.log('Starting animation loop from status update');
          updateFrequencyData();
        }
      }

      if (status.didJustFinish) {
        console.log('Track finished');
        setIsPlaying(false);
        setPosition(0);
        if (animationFrame.current) {
          cancelAnimationFrame(animationFrame.current);
          animationFrame.current = null;
        }
      }
    } else if (status.error) {
      console.error('Playback error:', status.error);
      setError(`Playback error: ${status.error}`);
    }
  };

  const handlePlayPause = async () => {
    try {
      if (!sound) {
        console.error('No sound object available');
        if (recordingUri) {
          console.log('Attempting to reload sound from recording:', recordingUri);
          await setupAudio(recordingUri);
          return;
        }
        setError('No recording available to play');
        return;
      }

      const status = await sound.getStatusAsync();
      console.log('Current sound status:', status);

      if (!isPlaybackStatusSuccess(status)) {
        console.error('Sound not properly loaded');
        if (recordingUri) {
          console.log('Attempting to reload sound from:', recordingUri);
          await setupAudio(recordingUri);
          return;
        }
        setError('Failed to load recording');
        return;
      }

      if (isPlaying) {
        console.log('Attempting to pause');
        await sound.pauseAsync();
      } else {
        try {
          console.log('Attempting to play from position:', position);
          
          // Ensure audio mode is set correctly before playing
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            shouldDuckAndroid: false, // Don't duck for maximum volume
            playThroughEarpieceAndroid: false,
          });
          
          // Set position first
          await sound.setPositionAsync(position);
          
          // Start playback
          await sound.playAsync();
          
          // Don't set isPlaying here - let the status update callback handle it
          // This avoids race conditions with buffering
          console.log('Playback requested, waiting for status updates...');
          
        } catch (playError: any) {
          console.error('Playback error:', playError);
          setError(`Playback error: ${playError.message}`);
          
          // Try to recover by reloading the sound
          if (recordingUri) {
            console.log('Attempting to recover by reloading sound');
            await setupAudio(recordingUri);
          }
        }
      }
    } catch (e: any) {
      console.error('Error in playback control:', e);
      setError(`Playback error: ${e.message}`);
    }
  };

  const handleRewind = async () => {
    try {
      if (!sound) return;
      const newPosition = Math.max(0, position - 10000);
      await sound.setPositionAsync(newPosition);
    } catch (e) {
      console.error('Error rewinding:', e);
      setError('Failed to rewind');
    }
  };

  const handleForward = async () => {
    try {
      if (!sound) return;
      const newPosition = Math.min(duration, position + 10000);
      await sound.setPositionAsync(newPosition);
    } catch (e) {
      console.error('Error fast-forwarding:', e);
      setError('Failed to fast-forward');
    }
  };

  const handleSliderChange = async (value: number) => {
    try {
      if (!sound) return;
      await sound.setPositionAsync(value);
    } catch (e) {
      console.error('Error seeking:', e);
      setError('Failed to seek to position');
    }
  };

  const formatTime = (millis: number) => {
    const minutes = Math.floor(millis / 60000);
    const seconds = ((millis % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
  };

  // Add retry handler
  const handleRetry = async () => {
    setError(null);
    await setupAudio(recordingUri || '');
  };

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity 
          style={styles.retryButton}
          onPress={handleRetry}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>VM Animation Player</Text>
      
      {isLoading ? (
        <Text style={styles.loading}>Loading audio...</Text>
      ) : (
        <View style={styles.contentContainer}>
          <View style={styles.waveformWrapper}>
            <WaveformVisualizer 
              frequencyData={frequencyData}
              isPlaying={isPlaying}
            />
          </View>
          
          <View style={styles.recordingControls}>
            <TouchableOpacity
              style={[styles.recordButton, isRecording && styles.recordingActive]}
              onPress={isRecording ? stopRecording : startRecording}
            >
              <Ionicons 
                name={isRecording ? "stop" : "mic"} 
                size={32} 
                color={isRecording ? "#fff" : "#374A1F"} 
              />
            </TouchableOpacity>
            <Text style={styles.recordingText}>
              {isRecording ? 'Recording...' : 'Tap to Record'}
            </Text>
          </View>

          {recordingUri && (
            <View style={styles.playerContainer}>
              <View style={styles.sliderContainer}>
                <Text style={styles.time}>{formatTime(position)}</Text>
                <Slider
                  style={styles.slider}
                  minimumValue={0}
                  maximumValue={duration}
                  value={position}
                  onSlidingComplete={handleSliderChange}
                  minimumTrackTintColor="#FDA921"
                  maximumTrackTintColor="#D3D3D3"
                  thumbTintColor="#FC6621"
                />
                <Text style={styles.time}>{formatTime(duration)}</Text>
              </View>

              <View style={styles.controls}>
                <TouchableOpacity onPress={handleRewind} style={styles.controlButton}>
                  <Ionicons name="play-back" size={32} color="#374A1F" />
                </TouchableOpacity>
                
                <TouchableOpacity onPress={handlePlayPause} style={styles.playButton}>
                  <Ionicons 
                    name={isPlaying ? "pause" : "play"} 
                    size={40} 
                    color="#18210C" 
                  />
                </TouchableOpacity>
                
                <TouchableOpacity onPress={handleForward} style={styles.controlButton}>
                  <Ionicons name="play-forward" size={32} color="#374A1F" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#18210C',
    textAlign: 'center',
    marginTop: 20,
  },
  loading: {
    fontSize: 16,
    color: '#374A1F',
    textAlign: 'center',
  },
  errorText: {
    color: '#A4301E',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#FDA921',
    padding: 12,
    borderRadius: 8,
    alignSelf: 'center',
  },
  retryText: {
    color: '#18210C',
    fontSize: 16,
    fontWeight: 'bold',
  },
  waveformWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  waveformContainer: {
    width: SCREEN_WIDTH - 40,
    height: 200,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  bar: {
    width: 4, // Slightly wider bars
    height: 150,
    marginHorizontal: 1,
    backgroundColor: '#282828', // Dark purple to match UI
    borderRadius: 2,
  },
  playerContainer: {
    width: '100%',
    paddingBottom: 40,
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  slider: {
    flex: 1,
    marginHorizontal: 10,
  },
  time: {
    fontSize: 12,
    color: '#374A1F',
    minWidth: 40,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  controlButton: {
    padding: 20,
  },
  playButton: {
    padding: 20,
    marginHorizontal: 20,
    backgroundColor: '#FDA921',
    borderRadius: 40,
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingControls: {
    alignItems: 'center',
    marginVertical: 20,
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    borderWidth: 2,
    borderColor: '#374A1F',
  },
  recordingActive: {
    backgroundColor: '#374A1F',
    borderColor: '#fff',
  },
  recordingText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
});

/**
 * Worker function to analyze audio and return frequency data for visualization.
 * @param audioUri - The URI of the audio file (local or remote)
 * @returns Promise<Float32Array> - Frequency data array
 */
export async function analyzeAudioForVM(audioUri: string): Promise<Float32Array> {
  try {
    // Create a new AudioAnalyzer instance
    const analyzer = new AudioAnalyzer();
    
    // Load the audio file
    const { sound } = await Audio.Sound.createAsync(
      { uri: audioUri },
      { shouldPlay: false }
    );
    
    // Set up the analyzer with the sound
    await analyzer.setupAudio(sound);
    
    // Get initial frequency data
    const frequencyData = await analyzer.getFrequencyData();
    
    // Clean up
    await sound.unloadAsync();
    analyzer.cleanup();
    
    return frequencyData;
  } catch (error) {
    console.error('analyzeAudioForVM error:', error);
    throw error;
  }
} 