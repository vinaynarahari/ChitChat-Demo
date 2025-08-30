import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { CameraType, CameraView, FlashMode, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Image,
    Linking,
    Modal,
    Platform,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const isAndroid = Platform.OS === 'android';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');



interface ModernCameraModalProps {
  visible: boolean;
  onClose: () => void;
  onCapture: (media: any) => void;
  isRecording: boolean;
  recordingDuration: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  frequencyData?: Float32Array;
  audioRecordingUri?: string | null;
}

const THEME = {
  primary: '#282828',
  accentBlue: '#26A7DE',
  white: '#FFFFFF',
  black: '#000000',
  gray: '#666666',
  lightGray: '#EEEEEE'
};

export default function ModernCameraModal({
  visible,
  onClose,
  onCapture,
  isRecording,
  recordingDuration,
  onStartRecording,
  onStopRecording,
  frequencyData,
  audioRecordingUri
}: ModernCameraModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraType, setCameraType] = useState<CameraType>('back');
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [isPermissionLoading, setIsPermissionLoading] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const slideAnim = useRef(new Animated.Value(1000)).current;
  const captureButtonScale = useRef(new Animated.Value(1)).current;
  
  // Preview state
  const [previewMode, setPreviewMode] = useState(false);
  const [capturedMedia, setCapturedMedia] = useState<any>(null);
  const [additionalAudio, setAdditionalAudio] = useState<any>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [wasRecording, setWasRecording] = useState(false);
  const [isRecordingInPreview, setIsRecordingInPreview] = useState(false);
  const [lastRecordingDuration, setLastRecordingDuration] = useState(0);
  
  // Audio playback state
  const [audioSound, setAudioSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);


  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  // Handle audio recording completion
  useEffect(() => {
    if (wasRecording && !isRecording) {
      // Recording just stopped - capture the duration before it gets reset
      setLastRecordingDuration(recordingDuration);
      setWasRecording(false);
    } else if (isRecording && !wasRecording) {
      setWasRecording(true);
    }
  }, [isRecording, wasRecording, recordingDuration]);

  // Handle audio recording URI when provided
  useEffect(() => {
    if (audioRecordingUri && !isRecording) {
      const processAudioFile = async () => {
        try {
          // Add a small delay to ensure the file is fully written
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Get duration directly from the audio file
          const { sound } = await Audio.Sound.createAsync(
            { uri: audioRecordingUri },
            { shouldPlay: false }
          );
          
          const status = await sound.getStatusAsync();
          let actualDuration = status.isLoaded ? (status.durationMillis || 0) / 1000 : lastRecordingDuration;
          
          // If we still don't have a duration, try a retry with a longer delay
          if (actualDuration === 0 && lastRecordingDuration === 0) {
            await sound.unloadAsync();
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const { sound: retrySound } = await Audio.Sound.createAsync(
              { uri: audioRecordingUri },
              { shouldPlay: false }
            );
            
            const retryStatus = await retrySound.getStatusAsync();
            actualDuration = retryStatus.isLoaded ? (retryStatus.durationMillis || 0) / 1000 : 0;
            await retrySound.unloadAsync();
          } else {
            await sound.unloadAsync();
          }
          
          const audioMediaItem = {
            type: 'audio' as const,
            url: audioRecordingUri,
            duration: actualDuration,
            size: 0,
            mimeType: 'audio/m4a'
          };
          
          if (previewMode && capturedMedia?.type === 'image') {
            // Adding audio to existing photo
            setAdditionalAudio(audioMediaItem);
            setIsRecordingInPreview(false);
          } else if (!previewMode) {
            // Audio-only recording - only set if not already in preview mode
            setCapturedMedia(audioMediaItem);
            setPreviewMode(true);
          }
        } catch (error) {
          console.error('Error processing audio file:', error);
          // Fallback to using lastRecordingDuration if file processing fails
          const audioMediaItem = {
            type: 'audio' as const,
            url: audioRecordingUri,
            duration: lastRecordingDuration,
            size: 0,
            mimeType: 'audio/m4a'
          };
          
          if (previewMode && capturedMedia?.type === 'image') {
            setAdditionalAudio(audioMediaItem);
            setIsRecordingInPreview(false);
          } else if (!previewMode) {
            setCapturedMedia(audioMediaItem);
            setPreviewMode(true);
          }
        }
      };
      
      processAudioFile();
    }
  }, [audioRecordingUri, isRecording, lastRecordingDuration, previewMode]);

  const handleCapture = async () => {
    if (!cameraRef.current || !isCameraReady) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      // Animate button press
      Animated.sequence([
        Animated.timing(captureButtonScale, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(captureButtonScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
      });

      if (photo) {
        const fileInfo = await FileSystem.getInfoAsync(photo.uri);
        const mediaItem = {
          type: 'image' as const,
          url: photo.uri,
          size: fileInfo.exists ? (fileInfo as any).size || 0 : 0,
          mimeType: 'image/jpeg'
        };
        
        setCapturedMedia(mediaItem);
        setPreviewMode(true);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const handleImagePicker = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Sorry, we need camera roll permissions to access your photos.',
          [
            {
              text: 'Open Settings',
              onPress: async () => {
                try {
                  if (isAndroid) {
                    await Linking.openSettings();
                  } else {
                    await Linking.openURL('app-settings:');
                  }
                } catch (error) {
                  Alert.alert('Error', 'Could not open settings. Please manually enable media library access in your device settings.');
                }
              }
            },
            { text: 'Cancel', style: 'cancel' }
          ]
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const fileInfo = await FileSystem.getInfoAsync(asset.uri);
        
        const mediaItem = {
          type: 'image' as const,
          url: asset.uri,
          size: fileInfo.exists ? (fileInfo as any).size || 0 : 0,
          mimeType: 'image/jpeg'
        };
        
        setCapturedMedia(mediaItem);
        setPreviewMode(true);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const handleAudioRecording = () => {
    if (isRecording) {
      onStopRecording();
    } else {
      onStartRecording();
    }
  };

  const handlePreviewAudioRecording = () => {
    if (isRecording) {
      onStopRecording();
      setIsRecordingInPreview(false);
    } else {
      onStartRecording();
      setIsRecordingInPreview(true);
    }
  };

  const handleRemoveAudio = () => {
    setAdditionalAudio(null);
  };

  const handleRetake = () => {
    setCapturedMedia(null);
    setAdditionalAudio(null);
    setPreviewMode(false);
    setLastRecordingDuration(0);
    // Clean up audio playback
    if (audioSound) {
      audioSound.unloadAsync();
      setAudioSound(null);
    }
    setIsPlaying(false);
    setPlaybackPosition(0);
    setPlaybackDuration(0);
  };

  const handlePost = async () => {
    if (!capturedMedia) return;
    
    setIsPosting(true);
    try {
      if (additionalAudio) {
        // Post with both photo and audio
        await onCapture({
          type: 'combined',
          image: capturedMedia,
          audio: additionalAudio
        });
      } else {
        // Post single media
        await onCapture(capturedMedia);
      }
      
      setCapturedMedia(null);
      setAdditionalAudio(null);
      setPreviewMode(false);
      onClose();
    } catch (error) {
      console.error('Error posting:', error);
      Alert.alert('Error', 'Failed to post. Please try again.');
    } finally {
      setIsPosting(false);
    }
  };

  const handleClose = () => {
    setCapturedMedia(null);
    setAdditionalAudio(null);
    setPreviewMode(false);
    setLastRecordingDuration(0);
    // Clean up audio playback
    if (audioSound) {
      audioSound.unloadAsync();
      setAudioSound(null);
    }
    setIsPlaying(false);
    setPlaybackPosition(0);
    setPlaybackDuration(0);
    onClose();
  };



  const handleFlashToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFlashMode(flashMode === 'off' ? 'on' : 'off');
  };

  const handleCameraFlip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCameraType(cameraType === 'back' ? 'front' : 'back');
  };

  const handleRequestPermission = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await requestPermission();
    } catch (error) {
      console.error('Error requesting camera permission:', error);
    }
  };

  const handleCameraReady = () => {
    console.log('Camera is ready');
    setIsCameraReady(true);
  };

  // Audio playback functions
  const loadAudio = async (uri: string) => {
    try {
      // Unload any existing sound
      if (audioSound) {
        await audioSound.unloadAsync();
      }

      // Set audio mode for playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // Load the audio file
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
        onPlaybackStatusUpdate
      );

      setAudioSound(sound);
      return sound;
    } catch (error) {
      console.error('Error loading audio:', error);
      Alert.alert('Error', 'Failed to load audio file');
      return null;
    }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setPlaybackPosition(status.positionMillis || 0);
      setPlaybackDuration(status.durationMillis || 0);
      setIsPlaying(status.isPlaying || false);

      // Auto-stop when playback finishes and reset for replay
      if (status.didJustFinish) {
        setIsPlaying(false);
        setPlaybackPosition(0);
        // Reset the audio position for replay
        if (audioSound) {
          audioSound.setPositionAsync(0);
        }
      }
    }
  };

  const handlePlayPause = async (audioUri: string) => {
    try {
      if (!audioSound) {
        // Load audio for the first time
        const sound = await loadAudio(audioUri);
        if (sound) {
          await sound.playAsync();
        }
      } else {
        if (isPlaying) {
          // Currently playing, pause it
          await audioSound.pauseAsync();
        } else {
          // Not playing, check if we need to restart from beginning
          const status = await audioSound.getStatusAsync();
          if (status.isLoaded && status.didJustFinish) {
            // Audio finished, restart from beginning
            await audioSound.setPositionAsync(0);
          }
          await audioSound.playAsync();
        }
      }
    } catch (error) {
      console.error('Error playing/pausing audio:', error);
      // If there's an error, try to reload the audio
      try {
        if (audioSound) {
          await audioSound.unloadAsync();
          setAudioSound(null);
        }
        const sound = await loadAudio(audioUri);
        if (sound) {
          await sound.playAsync();
        }
      } catch (retryError) {
        console.error('Error retrying audio playback:', retryError);
        Alert.alert('Error', 'Failed to play audio');
      }
    }
  };

  const handleStopAudio = async () => {
    try {
      if (audioSound) {
        await audioSound.stopAsync();
        await audioSound.setPositionAsync(0);
        setIsPlaying(false);
        setPlaybackPosition(0);
      }
    } catch (error) {
      console.error('Error stopping audio:', error);
    }
  };

  // Cleanup audio when component unmounts or modal closes
  useEffect(() => {
    return () => {
      if (audioSound) {
        audioSound.unloadAsync();
      }
    };
  }, [audioSound]);

  // Cleanup audio when modal closes
  useEffect(() => {
    if (!visible && audioSound) {
      audioSound.unloadAsync();
      setAudioSound(null);
      setIsPlaying(false);
      setPlaybackPosition(0);
      setPlaybackDuration(0);
    }
  }, [visible]); // Removed audioSound from dependency array to prevent infinite loop


  const renderTopControls = () => (
    <View style={styles.topControls}>
      <TouchableOpacity style={styles.topButton} onPress={handleClose}>
        <Ionicons name="close" size={24} color={THEME.white} />
      </TouchableOpacity>
      
      <View style={{ flex: 1 }} />
      
      <TouchableOpacity style={styles.topButton} onPress={handleFlashToggle}>
        <Ionicons 
          name={flashMode === 'on' ? "flash" : "flash-off"} 
          size={24} 
          color={THEME.white} 
        />
      </TouchableOpacity>
    </View>
  );

  const renderSideControls = () => (
    <View style={styles.sideControls}>
      <TouchableOpacity style={styles.sideButton} onPress={handleCameraFlip}>
        <Ionicons name="camera-reverse" size={24} color={THEME.white} />
      </TouchableOpacity>
    </View>
  );

  const renderPreviewScreen = () => (
    <View style={styles.previewContainer}>
      {capturedMedia?.type === 'image' && (
        <>
          <Image
            source={{ uri: capturedMedia.url }}
            style={styles.previewImage}
            resizeMode="contain"
          />
          
          {/* Audio indicator if additional audio is recorded */}
          {additionalAudio && (
            <View style={styles.audioIndicator}>
              <Ionicons name="musical-notes" size={24} color={THEME.accentBlue} />
              <Text style={styles.audioIndicatorText}>
                Audio added ({Math.round(additionalAudio.duration || 0)}s)
              </Text>
              <TouchableOpacity 
                onPress={() => handlePlayPause(additionalAudio.url)} 
                style={styles.playButton}
              >
                <Ionicons 
                  name={isPlaying ? "pause" : "play"} 
                  size={20} 
                  color={THEME.white} 
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleRemoveAudio} style={styles.removeAudioButton}>
                <Ionicons name="close-circle" size={20} color={THEME.white} />
              </TouchableOpacity>
            </View>
          )}
          
          {/* Recording indicator in preview */}
          {isRecording && isRecordingInPreview && (
            <View style={styles.recordingInPreview}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingInPreviewText}>Recording...</Text>
              <TouchableOpacity 
                style={styles.stopRecordingButton} 
                onPress={handlePreviewAudioRecording}
              >
                <Ionicons name="stop" size={24} color={THEME.white} />
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
      
      {capturedMedia?.type === 'audio' && (
        <View style={styles.audioPreviewContainer}>
          <Ionicons name="musical-notes" size={80} color={THEME.white} />
          <Text style={styles.audioPreviewText}>Audio Recording</Text>
          <Text style={styles.audioPreviewDuration}>
            {Math.round(capturedMedia.duration || 0)}s
          </Text>
          
          {/* Audio playback controls - simplified without progress bar */}
          <View style={styles.audioPlaybackControls}>
            <TouchableOpacity 
              onPress={() => handlePlayPause(capturedMedia.url)} 
              style={styles.playPauseButton}
            >
              <Ionicons 
                name={isPlaying ? "pause" : "play"} 
                size={32} 
                color={THEME.white} 
              />
            </TouchableOpacity>
          </View>
        </View>
      )}
      
      {/* Preview Controls */}
      <View style={styles.previewControls}>
        <TouchableOpacity style={styles.previewButton} onPress={handleClose}>
          <Ionicons name="close" size={24} color={THEME.white} />
          <Text style={styles.previewButtonText}>Cancel</Text>
        </TouchableOpacity>
        
        {/* Add audio button for photos - only show if it's an image and no audio is added yet */}
        {capturedMedia?.type === 'image' && !additionalAudio && !isRecording && (
          <TouchableOpacity 
            style={styles.previewButton} 
            onPress={handlePreviewAudioRecording}
          >
            <Ionicons name="mic-outline" size={24} color={THEME.white} />
            <Text style={styles.previewButtonText}>Add Audio</Text>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity style={styles.previewButton} onPress={handleRetake}>
          <Ionicons name="refresh" size={24} color={THEME.white} />
          <Text style={styles.previewButtonText}>Retake</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.previewButton, styles.postButton]} 
          onPress={handlePost}
          disabled={isPosting || (isRecording && isRecordingInPreview)}
        >
          {isPosting ? (
            <ActivityIndicator size="small" color={THEME.white} />
          ) : (
            <Ionicons name="send" size={24} color={THEME.white} />
          )}
          <Text style={[styles.previewButtonText, styles.postButtonText]}>
            {isPosting ? 'Posting...' : 'Post'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderBottomControls = () => (
    <View style={styles.bottomControls}>
      {/* Capture Controls */}
      <View style={styles.captureControls}>
        <TouchableOpacity style={styles.galleryButton} onPress={handleImagePicker}>
          <Ionicons name="images" size={24} color={THEME.white} />
        </TouchableOpacity>
        
        <Animated.View style={[styles.captureButtonContainer, { transform: [{ scale: captureButtonScale }] }]}>
          <TouchableOpacity
            style={styles.captureButton}
            onPress={handleCapture}
          >
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>
        </Animated.View>
        
        <TouchableOpacity 
          style={[styles.audioButton, isRecording && styles.audioButtonRecording]} 
          onPress={handleAudioRecording}
        >
          <Ionicons 
            name={isRecording ? "stop" : "mic"} 
            size={24} 
            color={isRecording ? THEME.white : THEME.white} 
          />
        </TouchableOpacity>
      </View>
      
      {/* Recording timer */}
      {isRecording && (
        <View style={styles.recordingTimerContainer}>
          <Text style={styles.recordingTimer}>
            {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
          </Text>
        </View>
      )}
    </View>
  );

  const renderCameraView = () => {
    // Loading state - when permission is still being checked
    if (permission === null) {
      return (
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>Loading camera...</Text>
        </View>
      );
    }

    // Permission denied - show request button
    if (!permission.granted) {
      return (
        <View style={styles.permissionContainer}>
          <Ionicons name="camera" size={80} color={THEME.gray} />
          <Text style={styles.permissionText}>Camera access is required</Text>
          <TouchableOpacity 
            style={styles.permissionButton} 
            onPress={handleRequestPermission}
          >
            <Text style={styles.permissionButtonText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      );
    }



    return (
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={cameraType}
        flash={flashMode}
        mode="picture"
        onCameraReady={handleCameraReady}
      />
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={false}
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <StatusBar hidden />
      <Animated.View 
        style={[
          styles.container,
          { transform: [{ translateY: slideAnim }] }
        ]}
      >
        {previewMode ? renderPreviewScreen() : (
          <>
            {renderCameraView()}
            
            {/* Overlay Controls */}
            <View style={styles.overlay}>
              {renderTopControls()}
              {renderSideControls()}
              {renderBottomControls()}
            </View>
          </>
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.black,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: THEME.black,
  },
  permissionText: {
    color: THEME.white,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
  },
  permissionButton: {
    backgroundColor: THEME.accentBlue,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 20,
  },
  permissionButtonText: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  topButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  topButtonText: {
    color: THEME.white,
    fontSize: 14,
    marginLeft: 6,
    fontWeight: '500',
  },
  sideControls: {
    position: 'absolute',
    right: 20,
    top: '50%',
    transform: [{ translateY: -150 }],
    alignItems: 'center',
  },
  sideButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  durationButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  durationButtonActive: {
    backgroundColor: THEME.accentBlue,
  },
  durationText: {
    color: THEME.white,
    fontSize: 12,
    fontWeight: '600',
  },
  durationTextActive: {
    color: THEME.white,
  },
  bottomControls: {
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    paddingHorizontal: 20,
  },
  modeSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 30,
  },
  modeButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginHorizontal: 8,
  },
  modeButtonActive: {
    borderBottomWidth: 2,
    borderBottomColor: THEME.accentBlue,
  },
  modeText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '600',
  },
  modeTextActive: {
    color: THEME.white,
  },
  captureControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  galleryButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioButtonRecording: {
    backgroundColor: '#ff4444',
  },
  galleryPreview: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonContainer: {
    alignItems: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 6,
    borderColor: THEME.white,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  captureButtonRecording: {
    borderColor: '#ff4444',
  },
  captureButtonAudio: {
    borderColor: THEME.accentBlue,
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: THEME.white,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.22,
    shadowRadius: 2.22,
    elevation: 3,
  },
  captureButtonInnerRecording: {
    backgroundColor: '#ff4444',
    borderRadius: 8,
    width: 40,
    height: 40,
  },
  recordingIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: THEME.white,
  },
  recordingTimerOld: {
    color: THEME.white,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  audioMode: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioModeContent: {
    alignItems: 'center',
  },
  audioModeText: {
    color: THEME.white,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
  },
  textMode: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textModeContent: {
    alignItems: 'center',
  },
  textModeText: {
    color: THEME.white,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
  },
  audioVisualization: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioVisualizationLarge: {
    width: 200,
    height: 100,
    marginTop: 30,
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: THEME.black,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: '70%',
  },
  audioPreviewContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioPreviewText: {
    color: THEME.white,
    fontSize: 24,
    fontWeight: '600',
    marginTop: 20,
  },
  audioPreviewDuration: {
    color: THEME.white,
    fontSize: 18,
    marginTop: 10,
    opacity: 0.8,
  },
  previewControls: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 50 : 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  previewButton: {
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    minWidth: 80,
  },
  previewButtonText: {
    color: THEME.white,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  postButton: {
    backgroundColor: THEME.accentBlue,
  },
  postButtonText: {
    color: THEME.white,
  },
  recordingTimerContainer: {
    alignItems: 'center',
    marginTop: 10,
  },
  recordingTimer: {
    color: '#ff4444',
    fontSize: 16,
    fontWeight: '600',
  },
  audioIndicator: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
  },
  audioIndicatorText: {
    color: THEME.white,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  removeAudioButton: {
    marginLeft: 8,
  },
  addAudioButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
  },
  addAudioText: {
    color: THEME.white,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  recordingInPreview: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,68,68,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: THEME.white,
  },
  recordingInPreviewText: {
    color: THEME.white,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 12,
    flex: 1,
  },
  stopRecordingButton: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 20,
    padding: 8,
  },
  playButton: {
    marginLeft: 10,
    marginRight: 10,
  },
  audioPlaybackControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    width: '100%',
    paddingHorizontal: 20,
  },
  playPauseButton: {
    padding: 10,
  },
  progressContainer: {
    flex: 1,
    marginLeft: 10,
    width: '80%',
  },
  progressBar: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: THEME.white,
    borderRadius: 4,
  },
  progressText: {
    color: THEME.white,
    fontSize: 12,
    marginTop: 5,
    textAlign: 'center',
  },
}); 