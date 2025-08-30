import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Modal, PanResponder, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useGestureContext } from '../context/GestureContext';
import { Message } from '../context/GroupChatContext';
import { getAvatarColor, getInitials } from '../utils/avatarUtils';
import GroupChatMessage from './GroupChatMessage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface GroupChat {
  _id: string;
  name: string;
  description?: string;
  createdBy: string;
  members: any[];
  createdAt: string;
  lastMessageAt?: string;
  unreadCount?: number;
}

interface EavesdropViewProps {
  chat: GroupChat;
  messages: Message[];
  onExit: () => void;
  onPlayMessage: (message: Message) => Promise<void>;
  isPlaying: string | null;
  playbackPosition: { [key: string]: number };
  playbackDuration: { [key: string]: number };
  currentSound: any;
  onPause: () => void;
  onSeek: (messageIdOrPosition: string | number, position?: number) => Promise<void>;
  markMessageAsViewed?: (message: Message) => void;
  visible: boolean;
  getAudioUrl: (messageId: string) => Promise<string>;
}

export default function EavesdropView({
  chat,
  messages,
  onExit,
  onPlayMessage,
  isPlaying,
  playbackPosition,
  playbackDuration,
  currentSound,
  onPause,
  onSeek,
  markMessageAsViewed,
  visible,
  getAudioUrl,
}: EavesdropViewProps) {
  const { user } = useAuth();
  const { setDisableTabGestures } = useGestureContext();
  const [isClosing, setIsClosing] = useState(false);
  const [isModalClosing, setIsModalClosing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Use traditional Animated API for better stability (like comments modal)
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;

  // Create PanResponder for gesture handling - only for drag handle (like comments modal)
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to downward gestures with some threshold (exact like comments modal)
        return gestureState.dy > 10;
      },
      onPanResponderGrant: () => {
        // Reset drag state
        setIsDragging(true);
        // Stop any ongoing animations
        translateY.stopAnimation();
        opacity.stopAnimation();
        scale.stopAnimation();
      },
      onPanResponderMove: (_, gestureState) => {
        // Prevent gesture handling if closing
        if (isClosing || isModalClosing) return;
        
        console.log('[EavesdropView] onPanResponderMove dy:', gestureState.dy);
        if (gestureState.dy > 0) {
          // Add resistance for smoother feel (exact like comments modal)
          const resistance = 0.7;
          const dragDistance = gestureState.dy * resistance;
          
          translateY.setValue(dragDistance);
          // Smoother opacity transition
          const opacityValue = Math.max(0.3, 1 - (dragDistance / SCREEN_HEIGHT) * 0.8);
          opacity.setValue(opacityValue);
          // Subtle scale effect
          const scaleValue = Math.max(0.98, 1 - (dragDistance / (SCREEN_HEIGHT * 0.3)));
          scale.setValue(scaleValue);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        // Prevent gesture handling if closing
        if (isClosing || isModalClosing) return;
        
        // Reset dragging state
        setIsDragging(false);
        
        console.log('[EavesdropView] onPanResponderRelease dy:', gestureState.dy, 'vy:', gestureState.vy);
        
        // Use exact same logic as comments modal
        const shouldClose = gestureState.dy > SCREEN_HEIGHT * 0.2 || gestureState.vy > 800;
        
        if (shouldClose) {
          console.log('[EavesdropView] Closing modal');
          setIsClosing(true);
          setIsModalClosing(true);
          
          const finalVelocity = Math.max(gestureState.vy, 1000);
          
          Animated.parallel([
            Animated.timing(translateY, {
              toValue: SCREEN_HEIGHT,
              duration: Math.max(200, 400 - (finalVelocity / 10)),
              useNativeDriver: true,
              easing: Easing.out(Easing.cubic),
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: Math.max(150, 300 - (finalVelocity / 15)),
              useNativeDriver: true,
              easing: Easing.out(Easing.quad),
            }),
            Animated.timing(scale, {
              toValue: 0.96,
              duration: Math.max(200, 400 - (finalVelocity / 10)),
              useNativeDriver: true,
              easing: Easing.out(Easing.cubic),
            }),
          ]).start(() => {
            console.log('[EavesdropView] Animation completed, calling onExit');
            onExit();
          });
        } else {
          console.log('[EavesdropView] Returning to original position');
          
          Animated.parallel([
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
              damping: 25,
              stiffness: 300,
              mass: 0.8,
              velocity: gestureState.vy,
            }),
            Animated.spring(opacity, {
              toValue: 1,
              useNativeDriver: true,
              damping: 20,
              stiffness: 250,
              mass: 0.6,
            }),
            Animated.spring(scale, {
              toValue: 1,
              useNativeDriver: true,
              damping: 20,
              stiffness: 250,
              mass: 0.6,
            }),
          ]).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    // Disable tab gestures when modal is open
    setDisableTabGestures(true);
    
    // Reset modal closing state and animation values on open (exact like comments modal)
    setIsModalClosing(false);
    translateY.setValue(0);
    opacity.setValue(1);
    scale.setValue(1);
    
    return () => {
      // Re-enable tab gestures when modal closes
      setDisableTabGestures(false);
    };
  }, []);

  const handleExit = () => {
    console.log('[EavesdropView] handleExit called');
    
    // Prevent multiple exit calls
    if (isClosing || isModalClosing) return;
    setIsClosing(true);
    setIsModalClosing(true);
    
    // Just call onExit directly - animations are handled by gesture system
    onExit();
  };

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handlePlayMessage = async (message: Message) => {
    try {
      await onPlayMessage(message);
    } catch (error) {
      console.error('Error playing message:', error);
    }
  };

  // Filter messages to show only unread messages from other users
  const filteredMessages = useMemo(() => {
    return messages
      .filter(msg => 
        msg.groupChatId === chat._id && 
        !msg.isRead && 
        msg.senderId !== user?.userId
      )
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messages, chat._id, user?.userId]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleExit}
    >
      <TouchableWithoutFeedback onPress={handleExit}>
        <Animated.View style={[styles.modalOverlay, { opacity }]}>
          <TouchableWithoutFeedback>
            <Animated.View 
              style={[
                styles.modalContent, 
                {
                  transform: [
                    { translateY },
                    { scale },
                  ],
                }
              ]}
            >
              {/* Black and blue gradient background inside the popup */}
              <LinearGradient
                colors={["#050505", "#0a1a2f", "#1a3a6b", "#26A7DE"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              
              {/* Larger drag handle area with pan gestures (like comments modal) */}
              <View style={styles.dragHandleArea} {...panResponder.panHandlers}>
                <View style={styles.dragHandleContainer}>
                  <View style={styles.dragIndicator} />
                </View>
              </View>
              
              {/* Header with pan gestures to prevent conflicts near X button */}
              <View {...panResponder.panHandlers}>
                <BlurView intensity={20} style={styles.header}>
                  <TouchableOpacity onPress={handleExit} style={styles.backButton}>
                    <Ionicons name="close" size={24} color="#fff" />
                  </TouchableOpacity>
                  <View style={styles.headerContent}>
                    <View style={[
                      styles.avatar,
                      { backgroundColor: getAvatarColor(chat._id) }
                    ]}>
                      <Text style={styles.avatarText}>
                        {getInitials(chat.name)}
                      </Text>
                    </View>
                    <View style={styles.headerText}>
                      <Text style={styles.chatName}>{chat.name}</Text>
                      <Text style={styles.memberCount}>{`${chat.members.length} members`}</Text>
                    </View>
                  </View>
                </BlurView>
              </View>
              
              <ScrollView
                style={styles.messagesContainer}
                contentContainerStyle={styles.messagesContent}
                showsVerticalScrollIndicator={false}
                scrollEnabled={!isDragging && !isClosing && !isModalClosing}
              >
                {filteredMessages.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="ear-outline" size={48} color="rgba(255,255,255,0.6)" />
                    <Text style={styles.emptyStateText}>No new messages to eavesdrop</Text>
                  </View>
                ) : (
                  filteredMessages.map((message) => (
                    <GroupChatMessage
                      key={message._id}
                      item={message}
                      user={{ userId: user?.userId }}
                      isPlaying={isPlaying}
                      playbackPosition={playbackPosition}
                      playbackDuration={playbackDuration}
                      getAudioUrl={getAudioUrl}
                      pauseMessage={onPause}
                      playMessage={handlePlayMessage}
                      seekMessage={onSeek}
                      formatTime={formatTime}
                      isEavesdropMode={true}
                      groupMembers={chat.members}
                      markMessageAsViewed={markMessageAsViewed}
                    />
                  ))
                )}
              </ScrollView>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: 'rgba(18, 18, 23, 0.95)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    height: SCREEN_HEIGHT * 0.9,
    flexDirection: 'column',
    overflow: 'hidden',
  },
  dragHandleArea: {
    paddingVertical: 20,
    paddingHorizontal: 50,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginHorizontal: -16,
    marginTop: -16,
    paddingTop: 16,
  },
  dragHandleContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  dragIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: -16,
    marginTop: -16,
    paddingTop: 16,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  headerText: {
    flex: 1,
  },
  chatName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  memberCount: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
    marginTop: 16,
  },
}); 