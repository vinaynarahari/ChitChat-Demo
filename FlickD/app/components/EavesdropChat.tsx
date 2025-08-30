import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Pressable, Dimensions, FlatList, Modal, PanResponder, Animated, Easing } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '../../components/ThemedText';
import { ThemedView } from '../../components/ThemedView';
import GroupChatMessage from './GroupChatMessage';
import { useGroupChatContext } from '../context/GroupChatContext';
import { useEavesdrop } from '../context/EavesdropContext';
import { useGestureContext } from '../context/GestureContext';
import { BlurView } from 'expo-blur';
import { useAuth } from '../context/AuthContext';
import { 
  SPRING_CONFIG, 
  ANIMATION_DURATION, 
  GESTURE_THRESHOLDS, 
  SCREEN, 
  ANIMATION_VALUES 
} from '../../utils/animationConstants';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface EavesdropChatProps {
  chatId: string;
  onExit: () => void;
  getAudioUrl: (messageId: string) => Promise<string>;
  playbackPosition: { [key: string]: number };
  playbackDuration: { [key: string]: number };
  isPlaying: string | null;
  playMessage: (message: any) => void;
  pauseMessage: () => void;
  seekMessage: (messageId: string, position: number) => void;
  formatTime: (seconds: number) => string;
  prefetchedChatData?: any;
  prefetchedMessages?: any[];
}

export const EavesdropChat: React.FC<EavesdropChatProps> = ({ 
  chatId, 
  onExit,
  getAudioUrl,
  playbackPosition,
  playbackDuration,
  isPlaying,
  playMessage,
  pauseMessage,
  seekMessage,
  formatTime,
  prefetchedChatData,
  prefetchedMessages,
}) => {
  const router = useRouter();
  const { messages } = useGroupChatContext();
  const { user } = useAuth();
  const { setIsEavesdropOpen } = useEavesdrop();
  const { setDisableTabGestures } = useGestureContext();
  const [unreadMessages, setUnreadMessages] = useState<any[]>(prefetchedMessages || []);
  const [chatData, setChatData] = useState<any>(prefetchedChatData || null);
  const [isClosing, setIsClosing] = useState(false);
  const [isModalClosing, setIsModalClosing] = useState(false);
  const [hasDraggedDown, setHasDraggedDown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Use traditional Animated API for better stability (like comments modal)
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;

  // Create PanResponder for gesture handling - only for drag handle (like comments modal)
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isClosing && !isModalClosing,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to downward gestures with some threshold (exact like comments modal)
        return !isClosing && !isModalClosing && gestureState.dy > 10;
      },
      onPanResponderGrant: () => {
        // Reset drag state
        setHasDraggedDown(false);
        setIsDragging(true);
        // Stop any ongoing animations
        translateY.stopAnimation();
        opacity.stopAnimation();
        scale.stopAnimation();
      },
      onPanResponderMove: (_, gestureState) => {
        // Prevent gesture handling if closing
        if (isClosing || isModalClosing) return;
        
        console.log('[EavesdropChat] onPanResponderMove dy:', gestureState.dy);
        if (gestureState.dy > 0) {
          // Mark that user has dragged down
          setHasDraggedDown(true);
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
        
        console.log('[EavesdropChat] onPanResponderRelease dy:', gestureState.dy, 'vy:', gestureState.vy, 'hasDraggedDown:', hasDraggedDown);
        
        // Exact same logic as comments modal
        const shouldClose = gestureState.dy > SCREEN_HEIGHT * 0.2 || gestureState.vy > 800;
        
        if (shouldClose) {
          console.log('[EavesdropChat] Closing modal');
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
            console.log('[EavesdropChat] Animation completed, calling onExit');
            onExit();
          });
        } else {
          console.log('[EavesdropChat] Returning to original position');
          
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
    setIsEavesdropOpen(true);
    // Disable tab gestures when modal is open
    setDisableTabGestures(true);
    
    return () => {
      setIsEavesdropOpen(false);
      // Re-enable tab gestures when modal closes
      setDisableTabGestures(false);
    };
  }, []);

  useEffect(() => {
    // Reset animation values on open (exact like comments modal)
    translateY.setValue(0);
    opacity.setValue(1);
    scale.setValue(1);

    // Only fetch if not prefetched
    if (!prefetchedChatData) {
      const fetchChatData = async () => {
        try {
          const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/groupchats/${chatId}`);
          if (response.ok) {
            const chat = await response.json();
            setChatData(chat);
          }
        } catch (error) {
          console.error('Error fetching chat data:', error);
        }
      };
      fetchChatData();
    }
    if (!prefetchedMessages) {
      const unread = messages
        .filter(msg => 
          msg.groupChatId === chatId && 
          !msg.isRead && 
          msg.senderId !== user?.userId
        )
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setUnreadMessages(unread);
    }
  }, [messages, chatId, user?.userId]);

  const handleExit = () => {
    console.log('[EavesdropChat] handleExit called');
    
    // Prevent multiple exit calls
    if (isClosing || isModalClosing) return;
    setIsClosing(true);
    setIsModalClosing(true);
    
    // Just call onExit directly - animations are handled by gesture system
    onExit();
  };

  const renderMessage = ({ item: message }: { item: any }) => (
    <GroupChatMessage
      item={message}
      user={{ userId: user?.userId }}
      playbackPosition={playbackPosition}
      playbackDuration={playbackDuration}
      isPlaying={isPlaying}
      getAudioUrl={getAudioUrl}
      pauseMessage={pauseMessage}
      playMessage={playMessage}
      seekMessage={(messageId: string, position: number) => seekMessage(messageId, position)}
      formatTime={formatTime}
      isEavesdropMode={true}
      groupMembers={chatData?.members || []}
      markMessageAsViewed={() => {}}
    />
  );

  return (
    <Modal
      transparent={true}
      animationType="none"
      visible={true}
      onRequestClose={handleExit}
    >
      <Animated.View style={[styles.modalOverlay, { opacity }]}>
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
          {/* Header with pan gestures to prevent conflicts near X button */}
          <View {...panResponder.panHandlers}>
            <BlurView intensity={30} tint="dark" style={styles.glassHeader}>
              <Pressable onPress={handleExit} style={styles.exitButton}>
                <Ionicons name="close" size={24} color="#fff" />
              </Pressable>
              <ThemedText style={styles.title}>Eavesdrop Mode</ThemedText>
              <View style={styles.placeholder} />
            </BlurView>
          </View>
          
          {/* Larger drag handle area with pan gestures (like comments modal) */}
          <View style={styles.dragHandleArea} {...panResponder.panHandlers}>
            <View style={styles.dragHandleContainer}>
              <View style={styles.handle} />
            </View>
          </View>
          
          <BlurView intensity={40} tint="dark" style={styles.glassContainer}>
            {unreadMessages.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="ear-outline" size={48} color="rgba(255,255,255,0.6)" />
                <ThemedText style={styles.emptyStateText}>No new messages to eavesdrop</ThemedText>
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                data={unreadMessages}
                renderItem={renderMessage}
                keyExtractor={(item) => item._id}
                contentContainerStyle={styles.messagesContainer}
                showsVerticalScrollIndicator={true}
                bounces={true}
                scrollEnabled={!isDragging && !isClosing && !isModalClosing}
                removeClippedSubviews={true}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={10}
                onScrollToIndexFailed={() => {}}
                scrollEventThrottle={16}
              />
            )}
          </BlurView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    height: '85%',
    backgroundColor: 'rgba(18, 18, 23, 0.95)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  dragHandleArea: {
    paddingVertical: 20,
    paddingHorizontal: 50,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  dragHandleContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
  },
  glassContainer: {
    flex: 1,
    backgroundColor: 'rgba(30,30,40,0.35)',
    borderRadius: 24,
    margin: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    backdropFilter: 'blur(10px)',
  },
  glassHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(30,30,40,0.35)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    backdropFilter: 'blur(10px)',
  },
  exitButton: {
    padding: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
  },
  placeholder: {
    width: 40,
  },
  messagesContainer: {
    padding: 16,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyStateText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
  },
}); 