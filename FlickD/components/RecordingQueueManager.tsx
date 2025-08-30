import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface QueuedUser {
  userId: string;
  userName: string;
  timestamp: number;
  position: number;
}

interface RecordingQueueManagerProps {
  groupChatId: string;
  currentUserId: string;
  groupMembers: Array<{ userId: string; name: string }>;
  isRecording: boolean;
  currentRecordingUser: string | null;
  onRequestRecording: () => void;
  onCancelRecordingRequest: () => void;
  onStartQueuedRecording: () => Promise<void>;
  socket: any;
  isVisible: boolean;
  isPlaying: string | null; // Current message being played
  onMessagePlaybackComplete?: () => void; // Callback when message playback completes
}

const THEME = {
  accentBlue: '#26A7DE',
  white: '#FFFFFF',
  darkGray: '#2C2C2E',
  lightGray: '#48484A',
};

export default function RecordingQueueManager({
  groupChatId,
  currentUserId,
  groupMembers,
  isRecording,
  currentRecordingUser,
  onRequestRecording,
  onCancelRecordingRequest,
  onStartQueuedRecording,
  socket,
  isVisible,
  isPlaying,
  onMessagePlaybackComplete,
}: RecordingQueueManagerProps) {
  const [recordingQueue, setRecordingQueue] = useState<QueuedUser[]>([]);
  const [isUserInQueue, setIsUserInQueue] = useState(false);
  const [userQueuePosition, setUserQueuePosition] = useState(0);
  const [isCurrentUserRecording, setIsCurrentUserRecording] = useState(false);
  const [pendingRecordingStart, setPendingRecordingStart] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const lastPlayingMessageRef = useRef<string | null>(null);
  const isStartingRecordingRef = useRef(false);

  useEffect(() => {
    if (lastPlayingMessageRef.current && !isPlaying && pendingRecordingStart) {
      setPendingRecordingStart(false);
      
      const nextInQueue = recordingQueue.find(user => user.position === 1);

      if (nextInQueue && nextInQueue.userId === currentUserId) {
        if (groupMembers.length >= 3) {
          // CRITICAL FIX: Add small delay to ensure playback states are fully cleared
          setTimeout(() => {
            onStartQueuedRecording();
          }, 50);
        }
      }
    }
    
    lastPlayingMessageRef.current = isPlaying;
  }, [isPlaying, pendingRecordingStart, recordingQueue, currentUserId, onStartQueuedRecording, groupMembers.length]);

  useEffect(() => {
    if (isVisible && (recordingQueue.length > 0 || currentRecordingUser)) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 8,
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
        Animated.timing(scaleAnim, {
          toValue: 0.8,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isVisible, recordingQueue.length, currentRecordingUser]);

  useEffect(() => {
    if (!socket) return;

    const handleQueueUpdate = (data: { groupId: string; queue: QueuedUser[] }) => {
      if (data.groupId === groupChatId) {
        setRecordingQueue(data.queue);
        
        const userInQueue = data.queue.find(user => user.userId === currentUserId);
        setIsUserInQueue(!!userInQueue);
        setUserQueuePosition(userInQueue?.position || 0);

        if (userInQueue?.position === 1 && isPlaying && !currentRecordingUser) {
          setPendingRecordingStart(true);
        }
      }
    };

    const handleRecordingEnded = (data: { groupId: string; userId: string }) => {
      if (data.groupId === groupChatId) {
        if (data.userId === currentUserId) {
          setIsCurrentUserRecording(false);
        }
        
        const nextInQueue = recordingQueue.find(user => user.position === 1 && user.userId !== data.userId);

        if (nextInQueue) {
          if (groupMembers.length >= 3) {
            if (nextInQueue.userId === currentUserId) {
              setPendingRecordingStart(true);
            }
            return;
          }
          if (isPlaying) {
            if (nextInQueue.userId === currentUserId) {
              setPendingRecordingStart(true);
            }
          } else {
            if (nextInQueue.userId === currentUserId) {
              if (isStartingRecordingRef.current) {
                return;
              }
              isStartingRecordingRef.current = true;
              onStartQueuedRecording().finally(() => {
                isStartingRecordingRef.current = false;
              });
            }
          }
        }
      }
    };

    socket.on('recording_queue_updated', handleQueueUpdate);
    socket.on('recording_ended', handleRecordingEnded);

    return () => {
      socket.off('recording_queue_updated', handleQueueUpdate);
      socket.off('recording_ended', handleRecordingEnded);
    };
  }, [socket, groupChatId, currentUserId, onRequestRecording, onStartQueuedRecording, recordingQueue, isPlaying, currentRecordingUser]);

  useEffect(() => {
    setIsCurrentUserRecording(currentRecordingUser === currentUserId);
  }, [currentRecordingUser, currentUserId]);

  const handleJoinQueue = () => {
    if (!socket || isUserInQueue) return;

    const currentUser = groupMembers.find(member => member.userId === currentUserId);
    if (!currentUser) return;

    socket.emit('join_recording_queue', {
      groupId: groupChatId,
      userId: currentUserId,
      userName: currentUser.name,
      timestamp: Date.now(),
      isAutoRecording: false,
    });
  };

  const handleLeaveQueue = () => {
    if (!socket || !isUserInQueue) return;

    socket.emit('leave_recording_queue', {
      groupId: groupChatId,
      userId: currentUserId,
    });
    
    setPendingRecordingStart(false);
    onCancelRecordingRequest();
  };

  const getUserName = (userId: string) => {
    const member = groupMembers.find(m => m.userId === userId);
    return member?.name || 'Unknown User';
  };

  const getQueueButtonText = () => {
    if (isCurrentUserRecording) {
      return 'Recording...';
    } else if (pendingRecordingStart) {
      return 'Recording after playback...';
    } else if (isUserInQueue) {
      if (userQueuePosition === 1 && isPlaying) {
        return 'Next (after playback)';
      }
      return `In Queue (${userQueuePosition})`;
    } else if (currentRecordingUser) {
      return 'Join Queue';
    } else {
      return 'Request Mic';
    }
  };

  const getQueueButtonIcon = () => {
    if (isCurrentUserRecording) {
      return 'mic';
    } else if (pendingRecordingStart) {
      return 'hourglass';
    } else if (isUserInQueue) {
      return 'time';
    } else {
      return 'hand-right';
    }
  };

  const getQueueButtonColor = () => {
    if (isCurrentUserRecording) {
      return '#ff6b6b';
    } else if (pendingRecordingStart) {
      return '#ffa726';
    } else if (isUserInQueue && userQueuePosition === 1) {
      return '#66bb6a';
    } else if (isUserInQueue) {
      return '#42a5f5';
    } else {
      return THEME.accentBlue;
    }
  };

  const canJoinQueue = () => {
    return !isUserInQueue && !isCurrentUserRecording && !pendingRecordingStart;
  };

  const shouldShowQueue = isVisible && (recordingQueue.length > 0 || currentRecordingUser || pendingRecordingStart);

  if (!shouldShowQueue) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.queueContainer,
        {
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      {currentRecordingUser && (
        <View style={styles.currentRecorderContainer}>
          <View style={styles.recordingIndicator}>
            <Animated.View style={[styles.recordingPulse, { opacity: fadeAnim }]} />
            <Ionicons name="mic" size={16} color="#ff6b6b" />
          </View>
          <Text style={styles.currentRecorderText}>
            {getUserName(currentRecordingUser)} is recording
          </Text>
        </View>
      )}

      {recordingQueue.length > 0 && (
        <View style={styles.queueListContainer}>
          <Text style={styles.queueTitle}>Recording Queue:</Text>
          {recordingQueue.slice(0, 3).map((user, index) => (
            <View key={user.userId} style={styles.queueUserItem}>
              <Text style={styles.queueUserPosition}>{user.position}</Text>
              <Text style={[
                styles.queueUserName,
                user.userId === currentUserId && styles.currentUserInQueue
              ]}>
                {groupMembers.length >= 3
                  ? (user.userId === currentUserId
                      ? `#${user.position} (You)${user.position === 1 && isPlaying ? ' - Next after playback' : user.position === 1 ? ' (Recording or Up Next)' : ''}`
                      : `#${user.position}${user.position === 1 && isPlaying ? ' - Next after playback' : user.position === 1 ? ' (Recording or Up Next)' : ''}`)
                  : `${user.userName}${user.userId === currentUserId ? ' (You)' : ''}${user.position === 1 && isPlaying ? ' - Next after playback' : user.position === 1 ? ' (Recording or Up Next)' : ''}`
                }
              </Text>
            </View>
          ))}
          {recordingQueue.length > 3 && (
            <Text style={styles.queueMoreText}>
              +{recordingQueue.length - 3} more waiting
            </Text>
          )}
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.queueButton,
          { backgroundColor: getQueueButtonColor() },
          !canJoinQueue() && isUserInQueue && styles.queueButtonDisabled
        ]}
        onPress={canJoinQueue() ? handleJoinQueue : handleLeaveQueue}
        disabled={pendingRecordingStart}
      >
        <Ionicons 
          name={getQueueButtonIcon()} 
          size={20} 
          color={THEME.white} 
        />
        <Text style={styles.queueButtonText}>
          {getQueueButtonText()}
        </Text>
      </TouchableOpacity>

      {isPlaying && isUserInQueue && userQueuePosition === 1 && (
        <View style={styles.playbackStatusContainer}>
          <Ionicons name="volume-high" size={14} color={THEME.accentBlue} />
          <Text style={styles.playbackStatusText}>
            Waiting for playback to finish...
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  queueContainer: {
    backgroundColor: 'rgba(40, 40, 43, 0.95)',
    borderRadius: 16,
    padding: 16,
    margin: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  currentRecorderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  recordingIndicator: {
    position: 'relative',
    marginRight: 8,
  },
  recordingPulse: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ff6b6b',
    opacity: 0.3,
    top: -4,
    left: -4,
  },
  currentRecorderText: {
    color: THEME.white,
    fontSize: 14,
    fontWeight: '600',
  },
  queueListContainer: {
    marginBottom: 12,
  },
  queueTitle: {
    color: THEME.white,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    opacity: 0.8,
  },
  queueUserItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  queueUserPosition: {
    color: THEME.accentBlue,
    fontSize: 12,
    fontWeight: 'bold',
    width: 20,
    textAlign: 'center',
  },
  queueUserName: {
    color: THEME.white,
    fontSize: 12,
    marginLeft: 8,
    flex: 1,
  },
  currentUserInQueue: {
    fontWeight: '600',
    color: THEME.accentBlue,
  },
  queueMoreText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 4,
  },
  queueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  queueButtonDisabled: {
    opacity: 0.6,
  },
  queueButtonText: {
    color: THEME.white,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  playbackStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(38, 167, 222, 0.2)',
    borderRadius: 8,
  },
  playbackStatusText: {
    color: THEME.accentBlue,
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
}); 