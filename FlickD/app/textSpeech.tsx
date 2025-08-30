import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Dimensions, ActivityIndicator, SafeAreaView } from 'react-native';
import { Stack } from 'expo-router';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { uploadAudioToS3, startTranscriptionJob, getTranscriptionResult, TranscriptionResult, startStreamingUpload } from '../utils/transcription';
import { FastTranscriptionOptimizer } from '../utils/fastTranscriptionOptimizer';
import TranscriptionDisplay from '../components/TranscriptionDisplay';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import { useAuth } from './context/AuthContext';
import { Message } from './context/GroupChatContext';
import { useRecording } from '../hooks/useRecording';

const API_URL = Constants.expoConfig?.extra?.API_URL;

/**
 * Ultra-fast transcription function with multiple optimization strategies.
 * Uses aggressive caching, preloading, and polling to make transcriptions appear much faster.
 * @param audioUri - The local URI of the audio file
 * @param senderId - The user ID of the sender
 * @param groupChatId - (Optional) The group chat ID if this is a group message
 * @returns The saved message object with transcript (if successful)
 */
export async function transcribeAndSaveRecording(
  audioUri: string | { audioUri: string; groupChatId: string; senderId: string },
  senderId?: string,
  groupChatId?: string
): Promise<Message> {
  try {
    // Handle both string and object input formats
    let cleanAudioUri: string;
    let finalSenderId: string;
    let finalGroupChatId: string;

    if (typeof audioUri === 'object' && audioUri !== null) {
      cleanAudioUri = audioUri.audioUri;
      finalSenderId = audioUri.senderId;
      finalGroupChatId = audioUri.groupChatId;
    } else {
      cleanAudioUri = audioUri;
      finalSenderId = senderId!;
      finalGroupChatId = groupChatId!;
    }

    // Validate required fields
    if (!cleanAudioUri || !finalSenderId || !finalGroupChatId) {
      throw new Error('Missing required fields');
    }

    // Ensure audioUri is a proper URL string
    cleanAudioUri = cleanAudioUri.toString().trim();

    // Validate the audio file exists
    const fileInfo = await FileSystem.getInfoAsync(cleanAudioUri);
    if (!fileInfo.exists) {
      throw new Error('Audio file does not exist');
    }

    console.log('Starting ultra-fast transcription process');

    // Use fast transcription optimizer for maximum speed
    const fastOptimizer = FastTranscriptionOptimizer.getInstance();
    const result = await fastOptimizer.fastTranscribe(
      cleanAudioUri,
      finalSenderId,
      finalGroupChatId
    );

    console.log('Fast transcription result:', result);

    // If we have instant transcription, return immediately
    if (result.status === 'cached' || result.status === 'preloaded') {
      console.log('Using instant transcription:', result.status);
      return {
        _id: result.messageId,
        audioUrl: '',
        duration: 0,
        transcription: result.transcription,
        senderId: finalSenderId,
        groupChatId: finalGroupChatId,
        type: 'voice',
        timestamp: new Date().toISOString(),
        isRead: false,
        isDelivered: true,
        processingStatus: 'ready'
      } as Message;
    }

    // Return the message immediately (aggressive background processing continues)
    return {
      _id: result.messageId,
      audioUrl: '',
      duration: 0,
      senderId: finalSenderId,
      groupChatId: finalGroupChatId,
      type: 'voice',
      timestamp: new Date().toISOString(),
      isRead: false,
      isDelivered: true,
      processingStatus: 'processing'
    } as Message;

  } catch (error) {
    console.error('Ultra-fast transcribeAndSaveRecording error:', error);
    throw error;
  }
}

export default function TextSpeechScreen() {
  const { user } = useAuth();
  const { isRecording, startRecording: startCentralizedRecording, stopRecording: stopCentralizedRecording } = useRecording();
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [latestTranscriptText, setLatestTranscriptText] = useState<string | null>(null);

  useEffect(() => {
    // Request permission to use the microphone
    const getPermission = async () => {
      try {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission required', 'Please grant permission to use the microphone');
        }
      } catch (error) {
        console.error('Error requesting microphone permission:', error);
      }
    };

    getPermission();

    // Cleanup function
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, []);

  // Update position while playing
  useEffect(() => {
    if (sound && isPlaying) {
      const interval = setInterval(async () => {
        const status = await sound.getStatusAsync();
        if (status.isLoaded) {
          setPosition(status.positionMillis);
          if (status.positionMillis >= status.durationMillis!) {
            setIsPlaying(false);
            setPosition(0);
            await sound.setPositionAsync(0);
          }
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [sound, isPlaying]);

  // Fetch the latest transcripted message for this user
  useEffect(() => {
    const fetchLatestTranscript = async () => {
      if (!user?.userId) return;
      try {
        const response = await fetch(`${API_URL}/messages/user/${user.userId}`);
        if (response.ok) {
          const messages = await response.json();
          if (messages.length > 0 && messages[0].transcription && messages[0].transcription.results?.transcripts?.[0]?.transcript) {
            setLatestTranscriptText(messages[0].transcription.results.transcripts[0].transcript);
          } else {
            setLatestTranscriptText(null);
          }
        } else {
          setLatestTranscriptText(null);
        }
      } catch (error) {
        setLatestTranscriptText(null);
      }
    };
    fetchLatestTranscript();
  }, [user, transcription]);

  const startRecording = async () => {
    try {
      // Reset playback state
      setSound(null);
      setDuration(0);
      setPosition(0);
      setRecordingUri(null);
      
      const success = await startCentralizedRecording();
      if (!success) {
        Alert.alert('Error', 'Failed to start recording');
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording');
    }
  };

  const startTranscription = async (uri: string) => {
    if (!uri) return;

    try {
      setIsTranscribing(true);
      setTranscription(null);

      // Generate a unique job name and file name
      const timestamp = Date.now();
      const jobName = `transcription-${timestamp}`;
      const fileName = `recording-${timestamp}`;

      console.log('Starting transcription process for:', uri);

      // Upload the audio file to S3 and get the S3 URI
      const s3Uri = await uploadAudioToS3(uri, fileName);
      console.log('File uploaded to S3, URI:', s3Uri);

      // Start the transcription job
      await startTranscriptionJob(s3Uri, jobName);

      // Poll for results
      const checkTranscription = async () => {
        const result = await getTranscriptionResult(jobName);
        if (result) {
          setTranscription(result);
          setIsTranscribing(false);
        } else {
          // Check again in 2 seconds
          setTimeout(checkTranscription, 2000);
        }
      };

      // Set up 15-second timeout for transcription
      const transcriptionStartTime = Date.now();
      const timeoutId = setTimeout(() => {
        console.log('Transcription timed out after 15 seconds, setting empty transcription');
        const emptyTranscription = {
          results: {
            transcripts: [{ transcript: '' }],
            items: []
          }
        };
        setTranscription(emptyTranscription);
        setIsTranscribing(false);
      }, 15000); // 15 seconds

      const checkTranscriptionWithTimeout = async () => {
        // Check if we've exceeded the 15-second timeout
        if (Date.now() - transcriptionStartTime > 15000) {
          clearTimeout(timeoutId);
          return;
        }

        const result = await getTranscriptionResult(jobName);
        if (result) {
          clearTimeout(timeoutId);
          setTranscription(result);
          setIsTranscribing(false);
        } else {
          // Check again in 2 seconds
          setTimeout(checkTranscriptionWithTimeout, 2000);
        }
      };

      checkTranscriptionWithTimeout();
    } catch (error) {
      console.error('Transcription error:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
      }
      Alert.alert('Error', 'Failed to transcribe audio');
      setIsTranscribing(false);
    }
  };

  const stopRecording = async () => {
    if (!user?.userId) return;

    try {
      const uri = await stopCentralizedRecording();
      if (!uri) return;
      
      setRecordingUri(uri);
      
      if (uri) {
        // Generate unique names for the recording
        const timestamp = Date.now();
        const fileName = `recording-${timestamp}`;
        const jobName = `transcription-${timestamp}`;

        // Upload to S3 and get the URL
        const s3Uri = await uploadAudioToS3(uri, fileName);
        
        // Get the duration of the recording
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false }
        );
        const status = await sound.getStatusAsync();
        const duration = status.isLoaded ? status.durationMillis : 0;
        await sound.unloadAsync();
        
        // Start transcription
        setIsTranscribing(true);
        await startTranscriptionJob(s3Uri, jobName);

        // Create message in database
        const response = await fetch(`${API_URL}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioUrl: s3Uri,
            duration: duration,
            senderId: user.userId,
            jobName: jobName
          }),
        });

        if (response.ok) {
          // Get the message data from response
          const messageData = await response.json();
          
          // Clear the local audio file
          try {
            await FileSystem.deleteAsync(uri);
          } catch (deleteError) {
            console.warn('Failed to delete local audio file:', deleteError);
          }

          // Start polling for transcription
          const pollStartTime = Date.now();
          const pollTimeoutId = setTimeout(() => {
            console.log('Transcription polling timed out after 15 seconds, setting empty transcription');
            const emptyTranscription = {
              results: {
                transcripts: [{ transcript: '' }],
                items: []
              }
            };
            setTranscription(emptyTranscription);
            setIsTranscribing(false);
          }, 15000); // 15 seconds

          const pollTranscription = async () => {
            // Check if we've exceeded the 15-second timeout
            if (Date.now() - pollStartTime > 15000) {
              clearTimeout(pollTimeoutId);
              return;
            }

            const result = await getTranscriptionResult(jobName);
            if (result) {
              clearTimeout(pollTimeoutId);
              setTranscription(result);
              setIsTranscribing(false);

              // Update message with transcription
              await fetch(`${API_URL}/messages/${messageData._id}/transcription`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  transcription: result
                }),
              });
            } else {
              // Check again in 2 seconds
              setTimeout(pollTranscription, 2000);
            }
          };

          pollTranscription();
        } else {
          const error = await response.json();
          Alert.alert('Error', error.error || 'Failed to save voice message');
        }
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Error', 'Failed to stop recording');
    }
  };

  const loadSound = async (uri: string) => {
    try {
      // Set audio mode for maximum volume output
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false, // Don't duck for maximum volume
        playThroughEarpieceAndroid: false,
      });

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri },
        { 
          progressUpdateIntervalMillis: 100,
          volume: 1.0,
          rate: 1.0,
          shouldCorrectPitch: true
        }
      );
      
      // Ensure maximum volume after creation
      await newSound.setVolumeAsync(1.0);
      setSound(newSound);
      
      // Get and set the duration
      const status = await newSound.getStatusAsync();
      if (status.isLoaded) {
        setDuration(status.durationMillis || 0);
      }
    } catch (error) {
      console.error('Failed to load sound:', error);
      Alert.alert('Error', 'Failed to load recording');
    }
  };

  const togglePlayback = async () => {
    if (!sound) return;

    try {
      if (isPlaying) {
        await sound.pauseAsync();
      } else {
        await sound.playAsync();
      }
      setIsPlaying(!isPlaying);
    } catch (error) {
      console.error('Failed to toggle playback:', error);
      Alert.alert('Error', 'Failed to play/pause recording');
    }
  };

  const seekTo = async (value: number) => {
    if (!sound) return;

    try {
      await sound.setPositionAsync(value);
      setPosition(value);
    } catch (error) {
      console.error('Failed to seek:', error);
    }
  };

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const skipBackward = async () => {
    if (!sound) return;
    try {
      const newPosition = Math.max(0, position - 10000); // Skip back 10 seconds
      await sound.setPositionAsync(newPosition);
      setPosition(newPosition);
    } catch (error) {
      console.error('Failed to skip backward:', error);
    }
  };

  const skipForward = async () => {
    if (!sound) return;
    try {
      const newPosition = Math.min(duration, position + 10000); // Skip forward 10 seconds
      await sound.setPositionAsync(newPosition);
      setPosition(newPosition);
    } catch (error) {
      console.error('Failed to skip forward:', error);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen 
        options={{ 
          title: 'Text to Speech',
          headerShown: true,
          headerStyle: {
            backgroundColor: '#282828',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }} 
      />
      <View style={styles.container}>
        <View style={styles.contentContainer}>
          <View style={styles.recordingSection}>
            <TouchableOpacity
              style={[styles.recordButton, isRecording && styles.recordingActive]}
              onPress={isRecording ? stopRecording : startRecording}
            >
              <Ionicons 
                name={isRecording ? "stop" : "mic"} 
                size={32} 
                color={isRecording ? "#fff" : "#282828"} 
              />
            </TouchableOpacity>
            <Text style={styles.recordingText}>
              {isRecording ? 'Recording...' : 'Tap to Record'}
            </Text>
          </View>

          {/* Display the latest transcripted text from MongoDB */}
          {latestTranscriptText && (
            <View style={styles.latestTranscriptContainer}>
              <Text style={styles.latestTranscriptTitle}>Latest Transcripted Text</Text>
              <Text style={styles.latestTranscriptText}>{latestTranscriptText}</Text>
            </View>
          )}

          {sound && (
            <View style={styles.playerSection}>
              <View style={styles.playerControls}>
                <TouchableOpacity 
                  style={styles.controlButton}
                  onPress={() => seekTo(Math.max(0, position - 10000))}
                >
                  <Ionicons name="play-back" size={24} color="#282828" />
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.playButton, isPlaying && styles.pauseButton]}
                  onPress={togglePlayback}
                >
                  <Ionicons 
                    name={isPlaying ? "pause" : "play"} 
                    size={32} 
                    color={isPlaying ? "#fff" : "#282828"} 
                  />
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.controlButton}
                  onPress={() => seekTo(Math.min(duration, position + 10000))}
                >
                  <Ionicons name="play-forward" size={24} color="#282828" />
                </TouchableOpacity>
              </View>

              <View style={styles.sliderContainer}>
                <Text style={styles.timeText}>{formatTime(position)}</Text>
                <Slider
                  style={styles.slider}
                  minimumValue={0}
                  maximumValue={duration}
                  value={position}
                  onSlidingComplete={seekTo}
                  minimumTrackTintColor="#282828"
                  maximumTrackTintColor="#D1D1D1"
                  thumbTintColor="#282828"
                />
                <Text style={styles.timeText}>{formatTime(duration)}</Text>
              </View>
            </View>
          )}

          {isTranscribing && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#282828" />
              <Text style={styles.loadingText}>Transcribing audio...</Text>
            </View>
          )}

          {transcription && (
            <View style={styles.transcriptionContainer}>
              <Text style={styles.transcriptionTitle}>Transcription</Text>
              <TranscriptionDisplay 
                transcription={transcription}
                currentPosition={position}
                isPlaying={isPlaying}
              />
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#282828',
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  contentContainer: {
    flex: 1,
    padding: 24,
  },
  recordingSection: {
    alignItems: 'center',
    marginVertical: 32,
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
    borderColor: '#6B2B8C',
  },
  recordingActive: {
    backgroundColor: '#6B2B8C',
    borderColor: '#fff',
  },
  recordingText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  playerSection: {
    marginTop: 24,
  },
  playerControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    marginBottom: 16,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    borderWidth: 2,
    borderColor: '#6B2B8C',
  },
  pauseButton: {
    backgroundColor: '#6B2B8C',
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  slider: {
    flex: 1,
    marginHorizontal: 8,
  },
  timeText: {
    fontSize: 12,
    color: '#666',
    minWidth: 40,
  },
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  transcriptionContainer: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
  },
  transcriptionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  latestTranscriptContainer: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    marginTop: 8,
  },
  latestTranscriptTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#6B2B8C',
    marginBottom: 8,
  },
  latestTranscriptText: {
    fontSize: 16,
    color: '#333',
  },
}); 