import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Animated } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import VoiceMessageWaveform from './VoiceMessageWaveform';
import { transcribeAndSaveRecording } from '../app/textSpeech';
import * as ImagePicker from 'expo-image-picker';
import { uploadMediaToS3 } from '../utils/mediaUpload';
import Constants from 'expo-constants';
import { useGroupChatContext } from '../app/context/GroupChatContext';
import { useSettings } from '../app/context/SettingsContext';
import { getSignedAudioUrl } from '../utils/transcription';

const API_URL = Constants.expoConfig?.extra?.API_URL;

interface RecordingControlsProps {
  selectedChat: any;
  user: any;
  fetchMessages: (chatId: string) => void;
  setGroupChats: (callback: (prev: any[]) => any[]) => void;
  currentAudioData?: Float32Array;
  isPlaying: boolean;
  currentPlayingMessageId?: string | null;
  isPlayingMessage?: boolean;
  isRobustQueueProcessing?: boolean;
  messages: any[];
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  onMessagePlayed: (messageId: string) => void;
  isRecording: boolean;
  setIsRecording: React.Dispatch<React.SetStateAction<boolean>>;
  stopRecording: () => Promise<void>;
  startRecording: () => Promise<void>;
  isTranscribing: boolean;
  getAudioUrl?: (messageId: string) => Promise<string>;
}

const RecordingControls: React.FC<RecordingControlsProps> = ({
  selectedChat,
  user,
  fetchMessages,
  setGroupChats,
  currentAudioData,
  isPlaying,
  currentPlayingMessageId,
  isPlayingMessage = false,
  isRobustQueueProcessing = false,
  messages,
  setMessages,
  onMessagePlayed,
  isRecording,
  setIsRecording,
  stopRecording,
  startRecording,
  isTranscribing,
  getAudioUrl,
}) => {
  const { socket, markMessageAsRead, recordingStates, emitRecordingStart, emitRecordingStop, isAnyoneRecording, getRecordingUsers } = useGroupChatContext();
  const { autoRecordingEnabled, setAutoRecordingEnabled } = useSettings();
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingStartTime, setRecordingStartTime] = useState(0);
  const hasAutoRecordedRef = useRef(false);
  const isManualPlaybackRef = useRef(false);
  const isProcessingRef = useRef(false);
  const playedMessageIdsRef = useRef(new Set<string>());

  const [isUploading, setIsUploading] = useState(false);
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [showRecordingBlockedAlert, setShowRecordingBlockedAlert] = useState(false);
  
  const [recordingQueue, setRecordingQueue] = useState<Array<{ userId: string; userName: string; position: number }>>([]);
  const [isUserInQueue, setIsUserInQueue] = useState(false);
  const [currentRecordingUser, setCurrentRecordingUser] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(10)).current;

  const recordingUsers = selectedChat ? getRecordingUsers(selectedChat._id) : [];
  const otherRecordingUsers = recordingUsers.filter(userId => userId !== user?.userId);
  const isAnyoneElseRecording = otherRecordingUsers.length > 0;
  
  const shouldUseQueue = selectedChat && selectedChat.members && selectedChat.members.length > 2;
  
  const isAnyPlaybackActive = isPlayingMessage || isRobustQueueProcessing || currentPlayingMessageId !== null;
  
  useEffect(() => {
    if (recordingUsers.length > 0) {
      setCurrentRecordingUser(recordingUsers[0]);
    } else {
      setCurrentRecordingUser(null);
    }
  }, [recordingUsers]);

  useEffect(() => {
    if (isUserInQueue) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 10,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isUserInQueue, fadeAnim, slideAnim]);

  useEffect(() => {
    if (!socket || !shouldUseQueue) return;

    const handleQueueUpdate = (data: { groupId: string; queue: Array<{ userId: string; userName: string; position: number }> }) => {
      if (data.groupId === selectedChat._id) {
        setRecordingQueue(data.queue);
        
        const userInQueue = data.queue.find(user => user.userId === user?.userId);
        const wasInQueue = isUserInQueue;
        setIsUserInQueue(!!userInQueue);
      }
    };

    socket.on('recording_queue_updated', handleQueueUpdate);

    return () => {
      socket.off('recording_queue_updated', handleQueueUpdate);
    };
  }, [socket, selectedChat?._id, shouldUseQueue, user?.userId]);

  useEffect(() => {
    if (showRecordingBlockedAlert) {
      const timer = setTimeout(() => {
        setShowRecordingBlockedAlert(false);
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [showRecordingBlockedAlert]);

  useEffect(() => {
    let isEffectActive = true;

    const handleInitialState = async () => {
      if (!isEffectActive || !selectedChat || !messages.length || isProcessingRef.current) {
        return;
      }
    };

    handleInitialState();

    return () => {
      isEffectActive = false;
    };
  }, [selectedChat, messages, user?.userId, isRecording, isPlayingMessage]);

  useEffect(() => {
    hasAutoRecordedRef.current = false;
    isProcessingRef.current = false;
  }, [selectedChat?._id]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleConnect = () => {
    };

    const handleDisconnect = () => {
    };

    const handleError = (error: any) => {
      console.error('[RecordingControls][Socket] Error:', error);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('error', handleError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('error', handleError);
    };
  }, [socket]);

  const onRecordingStatusUpdate = (status: any) => {
    if (status.isRecording) {
      setRecordingDuration(status.durationMillis || 0);
    }
  };

  const handleRecordingPress = async () => {
    if (isProcessingRef.current || isTranscribing || isUploading) {
      return;
    }

    if (isRecording) {
      setIsRecording(false);
      await stopRecording();
      if (selectedChat) {
        emitRecordingStop(selectedChat._id);
      }
    } else {
      if (!selectedChat || !user?.userId) {
        return;
      }

      if (isUserInQueue) {
        if (socket) {
          socket.emit('leave_recording_queue', {
            groupId: selectedChat._id,
            userId: user.userId,
          });
        }
        return;
      }

      if (isAnyPlaybackActive) {
        const unreadMessages = messages.filter(msg => 
          !msg.isRead && msg.senderId !== user.userId
        );
        
        for (const message of unreadMessages) {
          try {
            await markMessageAsRead(message);
          } catch (error) {
            console.warn('[RecordingControls] Failed to mark message as read:', error);
          }
        }
        
        if (shouldUseQueue && socket) {
          const currentUser = selectedChat.members?.find((member: any) => member.userId === user.userId);
          if (currentUser) {
            socket.emit('join_recording_queue', {
              groupId: selectedChat._id,
              userId: user.userId,
              userName: currentUser.name,
              timestamp: Date.now(),
              isAutoRecording: false,
            });
          }
        }
        return;
      }

      if (shouldUseQueue) {
        if (isAnyoneElseRecording) {
          const currentUser = selectedChat.members?.find((member: any) => member.userId === user.userId);
          if (currentUser && socket) {
            socket.emit('join_recording_queue', {
              groupId: selectedChat._id,
              userId: user.userId,
              userName: currentUser.name,
              timestamp: Date.now(),
              isAutoRecording: false,
            });
          }
          return;
        } else {
        }
      } else {
        if (isAnyoneElseRecording) {
          setShowRecordingBlockedAlert(true);
          return;
        }
      }
      
      setIsRecording(true);
      await startRecording();
    }
  };

  const getRecordingButtonStyle = () => {
    if (isRecording) {
      return [styles.recordButton, styles.recordingButton];
    } else if (isTranscribing || isUploading || isProcessingRef.current) {
      return [styles.recordButton, styles.recordButtonBlocked];
    } else if (isUserInQueue) {
      return [styles.recordButton, styles.queueButton];
    } else if (isAnyoneElseRecording && !isRecording && shouldUseQueue) {
      return [styles.recordButton, styles.recordButtonBlocked];
    } else if (isAnyoneElseRecording && !isRecording && !shouldUseQueue) {
      return [styles.recordButton, styles.recordButtonBlocked];
    } else {
      return [styles.recordButton];
    }
  };

  const getRecordingButtonText = () => {
    if (isRecording) {
      return 'Recording...';
    } else if (isUserInQueue) {
      const myQueueUser = recordingQueue.find(u => u.userId === user?.userId);
      if (myQueueUser) {
        if (myQueueUser.position === 2) {
          return 'You are next in the queue';
        } else if (myQueueUser.position > 2) {
          return `You are #${myQueueUser.position - 1} in the queue`;
        }
      }
    }
    return '';
  };

  const getRecordingButtonIcon = () => {
    if (isRecording) {
      return 'stop';
    } else if (isUserInQueue) {
      return 'time';
    } else if (isAnyoneElseRecording && !isRecording) {
      return 'mic-off';
    } else {
      return 'mic';
    }
  };

  const handleMediaUpload = async (type: 'image' | 'video') => {
    if (isUploading || isTranscribing || isProcessingRef.current) {
      return;
    }

    try {
      const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        const { status: newStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (newStatus !== 'granted') {
          Alert.alert('Permission Required', 'Please grant media library access to upload photos and videos.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: type === 'image' ? 
          ImagePicker.MediaTypeOptions.Images : 
          ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: type === 'image' ? 0.8 : 0.7,
        videoMaxDuration: 60,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setIsUploading(true);
        const asset = result.assets[0];
        
        const mediaUrl = await uploadMediaToS3(asset.uri, type);
        
        const messageData = {
          groupChatId: selectedChat._id,
          senderId: user.userId,
          type: type,
          mediaUrl: mediaUrl,
          timestamp: new Date().toISOString(),
          isRead: false,
          isDelivered: true,
          processingStatus: 'ready'
        };

        const response = await fetch(`${API_URL}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user.accessToken}`,
          },
          body: JSON.stringify(messageData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`Failed to save message: ${response.status}`);
        }

        const savedMessage = await response.json();

        await fetchMessages(selectedChat._id);
      }
    } catch (error) {
      Alert.alert(
        'Upload Failed',
        'Failed to upload media. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (selectedChat && user?.userId) {
      setIsUserInQueue(false);
      setRecordingQueue([]);
      setCurrentRecordingUser(null);
    }
  }, [selectedChat?._id, user?.userId]);

  // Recording state monitoring (debug logging removed to reduce console spam)

  return (
    <View style={styles.container}>
      {!shouldUseQueue && showRecordingBlockedAlert && (
        <View style={styles.recordingBlockedAlert}>
          <Ionicons name="mic-off" size={16} color="#fff" />
          <Text style={styles.recordingBlockedText}>
            Someone is using the mic
          </Text>
        </View>
      )}

      {!shouldUseQueue && isAnyoneElseRecording && !isRecording && (
        <View style={styles.otherRecordingIndicator}>
          <Ionicons name="mic" size={16} color="#ff6b6b" />
          <Text style={styles.otherRecordingText}>
            {otherRecordingUsers.length === 1 
              ? "Someone is recording..." 
              : `${otherRecordingUsers.length} people are recording...`}
          </Text>
        </View>
      )}

      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={styles.mediaButton}
          onPress={() => handleMediaUpload('image')}
          disabled={isRecording || isUploading || isAnyoneElseRecording}
        >
          <Ionicons name="image" size={24} color={isRecording || isUploading || isAnyoneElseRecording ? '#666' : '#26A7DE'} />
        </TouchableOpacity>

        <View style={styles.recordingButtonContainer}>
          {isUserInQueue && (() => {
            const myQueueUser = recordingQueue.find(u => u.userId === user?.userId);
            return myQueueUser && myQueueUser.position > 2;
          })() && (
            <Animated.Text
              style={[
                styles.queueStatusText,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              {getRecordingButtonText()}
            </Animated.Text>
          )}
          <TouchableOpacity
            style={getRecordingButtonStyle()}
            onPress={handleRecordingPress}
            disabled={isTranscribing || isUploading}
          >
            <Ionicons
              name={getRecordingButtonIcon()}
              size={28}
              color="#fff"
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.mediaButton}
          onPress={() => handleMediaUpload('video')}
          disabled={isRecording || isUploading || isAnyoneElseRecording}
        >
          <Ionicons name="videocam" size={24} color={isRecording || isUploading || isAnyoneElseRecording ? '#666' : '#26A7DE'} />
        </TouchableOpacity>
      </View>

      {shouldUseQueue && isUserInQueue && recordingQueue.length > 0 && (
        <View style={{ marginBottom: 8, alignItems: 'center' }}>
          <Text style={{ color: '#FFA500', fontWeight: '600', marginBottom: 2, fontSize: 13 }}>Queue:</Text>
          {recordingQueue.map((queueUser, idx) => (
            <Text
              key={queueUser.userId}
              style={{
                color: queueUser.userId === user?.userId ? '#26A7DE' : '#fff',
                fontWeight: queueUser.userId === user?.userId ? 'bold' : 'normal',
                fontSize: 13,
                backgroundColor: queueUser.userId === user?.userId ? 'rgba(38,167,222,0.13)' : 'transparent',
                borderRadius: 6,
                paddingHorizontal: 6,
                marginBottom: 1,
              }}
            >
              {queueUser.position === 1
                ? `#${queueUser.position} ${queueUser.userName}${queueUser.userId === user?.userId ? ' (You)' : ''} (Recording or Up Next)`
                : `#${queueUser.position - 1} ${queueUser.userName}${queueUser.userId === user?.userId ? ' (You)' : ''}`}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 30,
    backgroundColor: 'transparent',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  mediaButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(38,167,222,0.13)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(38,167,222,0.18)',
  },
  recordButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(38,167,222,0.13)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#26A7DE',
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  recordingButton: {
    borderColor: '#FF4444',
    backgroundColor: 'rgba(255,68,68,0.13)',
  },
  recordButtonBlocked: {
    borderColor: '#FF4444',
    backgroundColor: 'rgba(255,68,68,0.13)',
    shadowColor: '#FF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  recordingBlockedAlert: {
    position: 'absolute',
    top: -60,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 107, 107, 0.95)',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    shadowColor: '#FF6B6B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  recordingBlockedText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    textAlign: 'center',
  },
  otherRecordingIndicator: {
    position: 'absolute',
    top: -40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 107, 107, 0.9)',
    borderRadius: 8,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  otherRecordingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
  queueButton: {
    borderColor: '#FFA500',
    backgroundColor: 'rgba(255,165,0,0.2)',
    shadowColor: '#FFA500',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  recordingButtonContainer: {
    alignItems: 'center',
  },
  queueStatusText: {
    color: '#FFA500',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.2,
    fontFamily: 'System',
    backgroundColor: 'rgba(255,165,0,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,165,0,0.3)',
    overflow: 'visible',
  },
});

export default RecordingControls; 