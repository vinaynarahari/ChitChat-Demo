import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Dimensions, Modal, Pressable, Linking, Animated, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import ChatTranscriptionDisplay from '../../components/ChatTranscriptionDisplay';
import { Message } from '../context/GroupChatContext';
import { TranscriptionResult } from '../../utils/transcription';
import { BlurView } from 'expo-blur';
import ImageViewing from 'react-native-image-viewing';
import { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withTiming,
  runOnJS,
  Easing
} from 'react-native-reanimated';
import { SPRING_CONFIG } from '../../utils/animationConstants';


const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MEDIA_WIDTH = SCREEN_WIDTH * 0.9;

// Theme colors
const THEME = {
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  readHighlight: '#26A7DE',
  readAccent: '#26A7DE',
};

// Enhanced smooth and polished processing animation with sophisticated easing
const AppleStyleProcessingAnimation = React.memo(() => {
  const dotAnimations = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0)
  ]).current;
  
  const breathingAnimation = useRef(new Animated.Value(1)).current;
  const glowAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Enhanced dot sequence animation with smoother, slower timing
    const createDotAnimation = () => {
      const animations = dotAnimations.map((anim, index) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(index * 180), // Increased delay for more graceful staggering
            Animated.timing(anim, {
              toValue: 1,
              duration: 400, // Slower, more elegant timing
              easing: Easing.out(Easing.ease), // Smooth ease-out curve
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 400, // Matching duration for symmetry
              easing: Easing.in(Easing.ease), // Smooth ease-in curve
              useNativeDriver: true,
            }),
            Animated.delay((2 - index) * 180), // Symmetrical delay pattern
          ])
        );
      });

      return animations;
    };

    // More subtle breathing animation with refined timing
    const createBreathingAnimation = () => {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(breathingAnimation, {
            toValue: 1.015, // Much more subtle scale change
            duration: 1800, // Slower, more natural breathing rhythm
            easing: Easing.inOut(Easing.ease), // Natural ease curve
            useNativeDriver: true,
          }),
          Animated.timing(breathingAnimation, {
            toValue: 1,
            duration: 1800, // Matching duration
            easing: Easing.inOut(Easing.ease), // Consistent easing
            useNativeDriver: true,
          }),
        ])
      );
    };

    // Subtle glow effect for enhanced polish
    const createGlowAnimation = () => {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnimation, {
            toValue: 1,
            duration: 2400, // Slow, ambient glow cycle
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnimation, {
            toValue: 0,
            duration: 2400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
    };

    const dotAnimationInstances = createDotAnimation();
    dotAnimationInstances.forEach(animation => animation.start());
    createBreathingAnimation().start();
    createGlowAnimation().start();

    // Cleanup function
    return () => {
      dotAnimationInstances.forEach(animation => animation.stop());
      breathingAnimation.stopAnimation();
      glowAnimation.stopAnimation();
    };
  }, []);

  return (
    <Animated.View style={[
      styles.processingContainer,
      { 
        transform: [{ scale: breathingAnimation }],
        opacity: glowAnimation.interpolate({
          inputRange: [0, 1],
          outputRange: [0.8, 1.0], // Subtle glow effect
        })
      }
    ]}>
      <View style={styles.dotsContainer}>
        {dotAnimations.map((anim, index) => (
          <Animated.View
            key={index}
            style={[
              styles.dotWrapper,
              {
                opacity: anim.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0.3, 0.8, 1.0], // Smoother opacity transition
                }),
                transform: [
                  {
                    scale: anim.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0.7, 1.05, 1.2], // More refined scale curve
                    })
                  },
                  {
                    translateY: anim.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0, -2, 0], // Subtle bounce effect
                    })
                  }
                ]
              }
            ]}
          >
            <Animated.Text style={[
              styles.dot,
              {
                textShadowColor: 'rgba(255, 255, 255, 0.3)',
                textShadowOffset: { width: 0, height: 0 },
                // Note: textShadowRadius is not supported in animated styles
                opacity: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.5, 1], // Use opacity for glow effect instead
                }),
              }
            ]}>
              •
            </Animated.Text>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
});

AppleStyleProcessingAnimation.displayName = 'AppleStyleProcessingAnimation';

// Enhanced Typewriter effect component with cycling text support
const CyclingTypewriterText = React.memo(({ 
  texts, 
  isCurrentUser, 
  isEavesdropMode, 
  cycleInterval = 3000,
  typeSpeed = 50,
  deleteSpeed = 25 
}: {
  texts: string[];
  isCurrentUser: boolean;
  isEavesdropMode: boolean;
  cycleInterval?: number;
  typeSpeed?: number;
  deleteSpeed?: number;
}) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (texts.length === 0) return;

    const currentText = texts[currentTextIndex % texts.length];
    
    const timer = setTimeout(() => {
      if (isPaused) {
        // Pause at the end of typing before starting to delete
        setIsPaused(false);
        setIsDeleting(true);
      } else if (isDeleting) {
        if (displayedText.length > 0) {
          // Delete character by character
          setDisplayedText(prev => prev.slice(0, -1));
        } else {
          // Finished deleting, move to next text
          setIsDeleting(false);
          setCurrentTextIndex(prev => (prev + 1) % texts.length);
        }
      } else {
        if (displayedText.length < currentText.length) {
          // Type character by character
          setDisplayedText(prev => prev + currentText[prev.length]);
        } else {
          // Finished typing, pause before deleting (only if more than one text)
          if (texts.length > 1) {
            setIsPaused(true);
          }
        }
      }
    }, isDeleting ? deleteSpeed : (isPaused ? cycleInterval : typeSpeed));

    return () => clearTimeout(timer);
  }, [displayedText, currentTextIndex, isDeleting, isPaused, texts, cycleInterval, typeSpeed, deleteSpeed]);

  // Reset when texts change
  useEffect(() => {
    setDisplayedText('');
    setCurrentTextIndex(0);
    setIsDeleting(false);
    setIsPaused(false);
  }, [texts]);

  const textStyle = [
    styles.typewriterText,
    isEavesdropMode
      ? styles.eavesdropText
      : (isCurrentUser ? styles.currentUserText : styles.otherUserText)
  ];

  return (
    <Text style={textStyle}>
      {displayedText}
      <Text style={[textStyle, styles.cursor]}>|</Text>
    </Text>
  );
});

CyclingTypewriterText.displayName = 'CyclingTypewriterText';

// Typewriter effect component for transcription display
const TypewriterText = React.memo(({ text, isCurrentUser, isEavesdropMode, onComplete }: {
  text: string;
  isCurrentUser: boolean;
  isEavesdropMode: boolean;
  onComplete?: () => void;
}) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayedText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, 30); // Adjust speed here (lower = faster)

      return () => clearTimeout(timer);
    } else if (currentIndex === text.length && onComplete) {
      // Small delay before calling onComplete to let the last character settle
      const completeTimer = setTimeout(onComplete, 100);
      return () => clearTimeout(completeTimer);
    }
  }, [currentIndex, text, onComplete]);

  // Reset when text changes
  useEffect(() => {
    setDisplayedText('');
    setCurrentIndex(0);
  }, [text]);

  const textStyle = [
    styles.typewriterText,
    isEavesdropMode
      ? styles.eavesdropText
      : (isCurrentUser ? styles.currentUserText : styles.otherUserText)
  ];

  return (
    <Text style={textStyle}>
      {displayedText}
      {currentIndex < text.length && (
        <Text style={[textStyle, styles.cursor]}>|</Text>
      )}
    </Text>
  );
});

TypewriterText.displayName = 'TypewriterText';

interface GroupChatMessageProps {
  item: Message;
  user: { userId?: string };
  playbackPosition: { [key: string]: number };
  playbackDuration: { [key: string]: number };
  isPlaying: string | null;
  getAudioUrl: (url: string) => Promise<string>;
  pauseMessage: () => void;
  playMessage: (message: Message) => void;
  seekMessage: (messageId: string, position: number) => void;
  formatTime: (seconds: number) => string;
  isEavesdropMode?: boolean;
  showSenderName?: boolean;
  groupMembers?: { userId: string; name?: string }[];
  markMessageAsViewed?: (message: Message) => void;
  isNewMessage?: boolean;
  skipMessage?: () => void;
  skipToMessage?: (messageId: string) => Promise<void>;
}

// Utility function for preprocessing message data
const precomputeMessageData = (item: Message, groupMembers: any[]) => {
  if (!item || !groupMembers) {
    return {
      senderName: item?.senderId || 'Unknown',
      transcriptionResult: null,
      hasTranscription: false,
      isVoiceMessage: item?.type === 'voice',
      isTextMessage: item?.type === 'text',
      isImageMessage: item?.type === 'image',
      isVideoMessage: item?.type === 'video',
      hasContent: !!item?.content,
    };
  }
  
  // Precompute sender name
  const senderName = groupMembers.find(member => member.userId === item.senderId)?.name || item.senderId;
  
  // Precompute transcription result
  let transcriptionResult = null;
  if (item.transcription) {
    try {
      transcriptionResult = typeof item.transcription === 'string' 
        ? JSON.parse(item.transcription) as TranscriptionResult
        : item.transcription as TranscriptionResult;
    } catch (error) {
      console.error('Error parsing transcription:', error);
    }
  }
  
  return {
    senderName,
    transcriptionResult,
    hasTranscription: !!transcriptionResult,
    isVoiceMessage: item.type === 'voice',
    isTextMessage: item.type === 'text',
    isImageMessage: item.type === 'image',
    isVideoMessage: item.type === 'video',
    hasContent: !!item.content,
  };
};

// Memoized component for better performance
const GroupChatMessage = React.memo(function GroupChatMessage({ 
  item, 
  user, 
  playbackPosition, 
  playbackDuration, 
  isPlaying, 
  getAudioUrl, 
  pauseMessage, 
  playMessage, 
  seekMessage, 
  formatTime, 
  isEavesdropMode, 
  showSenderName = true, 
  groupMembers, 
  markMessageAsViewed, 
  isNewMessage = false, 
  skipMessage, 
  skipToMessage 
}: GroupChatMessageProps) {
  // Precompute expensive operations with specific transcription dependency
  const messageData = useMemo(() => 
    precomputeMessageData(item, groupMembers || []), 
    [item._id, item.transcription, item.processingStatus, item.type, item.content, item.mediaUrl, groupMembers]
  );

  // Remove or comment out the debug log to avoid excessive logging
  // console.log('GroupChatMessage item:', item, 'Current user:', user);
  const isCurrentUser = item.senderId === user?.userId;
  const messagePosition = playbackPosition[item._id] || 0;
  const messageDuration = playbackDuration[item._id] || item.duration || 0;
  const isPlayingThis = isPlaying === item._id;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const lastTapRef = useRef<number>(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const videoRef = useRef<Video>(null);
  const [isImageFullscreen, setIsImageFullscreen] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);
  const [videoAspectRatio, setVideoAspectRatio] = useState(16 / 9);
  const [showReadByNames, setShowReadByNames] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const translateYAnim = useRef(new Animated.Value(20)).current;

  // Animation values for slide-in effect
  const slideAnim = useSharedValue(isNewMessage ? 1 : 0); // 1 = off-screen, 0 = on-screen
  const opacityAnim = useSharedValue(isNewMessage ? 0 : 1); // Start invisible for new messages
  
  // Transcription animation values removed for simpler loading
  
  // Animation values for read receipts
  const checkmarkOpacity = useSharedValue(0);
  const checkmarkScale = useSharedValue(0.5);
  const doubleCheckOpacity = useSharedValue(0);
  
  // Optimized read status calculation with proper 2-person chat support
  const readReceiptStatus = useMemo(() => {
    // Only log for current user's messages in 2-person chats to reduce noise
    if (isCurrentUser && groupMembers?.length === 2) {
      // Removed debug log
    }

    // FIXED: Don't return early for missing readBy - still need to show delivered checkmark
    if (!groupMembers || !isCurrentUser) {
      return { allOtherUsersRead: false, isDelivered: false, otherUserCount: 0 };
    }

    // Get all other users (excluding sender)
    const otherUserIds = groupMembers
      .filter((member: { userId: string }) => member.userId !== item.senderId)
      .map((member: { userId: string }) => member.userId);
    
    if (otherUserIds.length === 0) {
      return { allOtherUsersRead: false, isDelivered: false, otherUserCount: 0 };
    }

    // Check if all other users have read the message
    // FIXED: Only count as read if other users (not the sender) have actually read the message
    let allOtherUsersRead = false;
    if (item.readBy) {
      const readChecks = otherUserIds.map((uid: string) => {
        const readTimestamp = item.readBy?.[uid];
        const hasRead = readTimestamp && (typeof readTimestamp === 'string' ? readTimestamp.length > 0 : true);
        return hasRead;
      });
      
      allOtherUsersRead = readChecks.every(Boolean);
    }

    // Message is considered delivered if it exists (we assume delivery by default)
    // FIXED: For proper single vs double checkmarks, delivered means the message has been sent
    // but not necessarily read by recipients yet
    const isDelivered = item.isDelivered !== false;

    return { 
      allOtherUsersRead, 
      isDelivered, 
      otherUserCount: otherUserIds.length 
    };
  }, [item.readBy, item.senderId, item.isDelivered, groupMembers, isCurrentUser, user?.userId]);
  
  const doubleCheckScale = useSharedValue(0.5); // Initialize to hidden state, will be set by useEffect

  // Check if this is a large group (for message status display logic)
  const isLargeGroup = groupMembers && groupMembers.length > 2;

  // Initialize read receipts animation values based on current state
  useEffect(() => {
    // Only set initial values for 2-person chats
    if (readReceiptStatus.otherUserCount === 1 && isCurrentUser) {
      if (readReceiptStatus.allOtherUsersRead) {
        // Message is read - show double checkmark immediately without animation on mount
        checkmarkOpacity.value = 0;
        checkmarkScale.value = 0.5;
        doubleCheckOpacity.value = 1;
        doubleCheckScale.value = 1;
      } else if (readReceiptStatus.isDelivered) {
        // Message is delivered but not read - show single checkmark immediately without animation on mount
        checkmarkOpacity.value = 1;
        checkmarkScale.value = 1;
        doubleCheckOpacity.value = 0;
        doubleCheckScale.value = 0.5;
      } else {
        // Message not yet delivered - hide all checkmarks
        checkmarkOpacity.value = 0;
        checkmarkScale.value = 0.5;
        doubleCheckOpacity.value = 0;
        doubleCheckScale.value = 0.5;
      }
    } else {
      // Not a 2-person chat or not current user - hide read receipts
      checkmarkOpacity.value = 0;
      doubleCheckOpacity.value = 0;
    }
  }, [item._id, readReceiptStatus.otherUserCount, readReceiptStatus.allOtherUsersRead, readReceiptStatus.isDelivered, isCurrentUser]);

  // FIXED: Remove automatic marking of messages as viewed to prevent flickering
  // Messages should only be marked as viewed through explicit user interactions:
  // 1. Voice messages: marked after playback completion
  // 2. Text/Image/Video messages: marked when user scrolls to them (handled by parent component)
  // This prevents the infinite loop of markMessageAsViewed -> socket update -> re-render -> markMessageAsViewed

  useEffect(() => {
    if (showReadByNames) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }).start();
    }
  }, [showReadByNames]);

  // Trigger animation when message is new - REDUCED LOGGING
  useEffect(() => {
    if (isNewMessage) {
      // Start animation after a small delay to ensure component is mounted
      const timer = setTimeout(() => {
        // Use a more organic spring animation
        slideAnim.value = withSpring(0, {
          damping: 25,
          stiffness: 80,
          mass: 1.2,
          overshootClamping: false,
          restDisplacementThreshold: 0.01,
          restSpeedThreshold: 0.01,
        });
        
        // Use a more natural fade-in with custom easing
        opacityAnim.value = withTiming(1, {
          duration: 800, // Even longer for more fluid feel
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94), // Custom bezier for organic feel
        });
      }, 150); // Slightly longer delay for more natural timing

      return () => clearTimeout(timer);
    }
  }, [isNewMessage, slideAnim, opacityAnim, item._id]);

  // Animated styles for slide-in effect
  const animatedStyle = useAnimatedStyle(() => {
    const translateX = slideAnim.value * (isCurrentUser ? 60 : -60); // Even more subtle slide
    const scale = 0.95 + (1 - slideAnim.value) * 0.05; // Very subtle scale for organic feel
    
    return {
      transform: [
        { translateX },
        { scale },
      ],
      opacity: opacityAnim.value,
    };
  });

  const handleDoubleTap = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    
    if (lastTapRef.current && (now - lastTapRef.current) < DOUBLE_TAP_DELAY) {
      // This is a double-tap
      console.log('[GroupChatMessage] 🎯 Double tap detected!');
      if (item.type === 'voice') {
        // Double tap on voice message: use enhanced skip functionality
        if (skipToMessage) {
          console.log('[GroupChatMessage] 🚀 Double tap on voice message - calling enhanced skipToMessage() with ID:', item._id);
          skipToMessage(item._id);
        } else if (skipMessage) {
          console.log('[GroupChatMessage] 🔄 Double tap on voice message - falling back to skipMessage()');
          skipMessage();
        } else {
          console.log('[GroupChatMessage] ❌ No skip functions available');
        }
      } else if (item.type === 'video' && videoRef.current) {
        videoRef.current.presentFullscreenPlayer();
        setIsVideoPlaying(true);
        videoRef.current.playAsync();
      } else if (item.type === 'image') {
        setIsImageFullscreen(true);
      }
      // Reset the last tap time to prevent multiple double-tap executions
      lastTapRef.current = now - DOUBLE_TAP_DELAY - 1;
    } else {
      // This is a single tap, set up a timeout to wait for potential double-tap
      lastTapRef.current = now;
      
      // Set a timeout to execute single tap if no double-tap occurs
      setTimeout(() => {
        if (lastTapRef.current === now) {
          // No double-tap occurred, execute single tap
          handleSingleTap();
        }
      }, DOUBLE_TAP_DELAY);
    }
  };

  const handleSingleTap = () => {
    if (item.type === 'voice') {
      if (isPlayingThis) {
        // Single tap on currently playing message: pause it
        console.log('[GroupChatMessage] Single tap on playing message - pausing');
        pauseMessage();
      } else {
        // Single tap on non-playing message: play it
        console.log('[GroupChatMessage] Single tap on non-playing message - playing');
        playMessage(item);
      }
    }
  };

  const handleMessageTap = () => {
    handleDoubleTap();
  };

  const handleVideoPlay = async () => {
    if (item.type === 'video' && videoRef.current) {
      await videoRef.current.presentFullscreenPlayer();
      setIsVideoPlaying(true);
      await videoRef.current.playAsync();
    }
  };

  const handleImageTap = () => {
    if (item.type === 'image' && item.mediaUrl) {
      setIsImageFullscreen(true);
    }
  };

  // Set image aspect ratio when image loads
  useEffect(() => {
    if (item.type === 'image') {
      // For now, we don't have mediaUrl support, so we'll use a default aspect ratio
      setImageAspectRatio(4 / 3);
    }
  }, [item.type]);

  // Set video aspect ratio when video loads
  useEffect(() => {
    if (item.type === 'video') {
      // For now, we don't have mediaUrl support, so we'll use a default aspect ratio
      setVideoAspectRatio(16 / 9);
    }
  }, [item.type]);

  // Handle video seek
  const handleVideoSeek = async (value: number) => {
    if (videoRef.current) {
      // For now, we don't have mediaUrl support
      console.log('Video seek not supported yet');
    }
  };

  const handleVideoProgress = (status: AVPlaybackStatus) => {
    if (status.isLoaded && status.durationMillis) {
      setVideoProgress(status.positionMillis / status.durationMillis);
    }
  };

  const handlePlayMessage = async () => {
    if (item.type === 'voice') {
      try {
        playMessage(item);
      } catch (error) {
        console.error('Error playing message:', error);
      }
    }
  };

  const renderVideoControls = () => {
    if (item.type !== 'video') return null;

    return (
      <View style={styles.videoControls}>
        <TouchableOpacity onPress={handleVideoPlay} style={styles.playButton}>
          <Ionicons 
            name="play" 
            size={32} 
            color="#fff" 
          />
        </TouchableOpacity>
      </View>
    );
  };

  // Animation effects for read receipts - LIVE UPDATES when read status changes
  useEffect(() => {
    // Only animate for 2-person chats
    if (readReceiptStatus.otherUserCount !== 1) {
      return;
    }

    // Update animation values to trigger smooth transitions when read status changes
    if (readReceiptStatus.allOtherUsersRead) {
      // Message was read - set up for double checkmark
      checkmarkOpacity.value = withTiming(0, { duration: 150 });
      checkmarkScale.value = withTiming(0.5, { duration: 150 });
      doubleCheckOpacity.value = withTiming(1, { duration: 200 });
      doubleCheckScale.value = withSpring(1, {
        damping: 15,
        stiffness: 300,
        mass: 0.8,
      });
    } else if (readReceiptStatus.isDelivered) {
      // Message is delivered but not read - set up for single checkmark
      doubleCheckOpacity.value = withTiming(0, { duration: 150 });
      doubleCheckScale.value = withTiming(0.5, { duration: 150 });
      checkmarkOpacity.value = withTiming(1, { duration: 200 });
      checkmarkScale.value = withSpring(1, {
        damping: 15,
        stiffness: 300,
        mass: 0.8,
      });
    } else {
      // Not delivered yet - hide all checkmarks
      checkmarkOpacity.value = withTiming(0, { duration: 150 });
      checkmarkScale.value = withTiming(0.5, { duration: 150 });
      doubleCheckOpacity.value = withTiming(0, { duration: 150 });
      doubleCheckScale.value = withTiming(0.5, { duration: 150 });
    }
  }, [readReceiptStatus.allOtherUsersRead, readReceiptStatus.isDelivered, readReceiptStatus.otherUserCount]);

  const animatedCheckmarkStyle = useAnimatedStyle(() => {
    return {
      opacity: checkmarkOpacity.value,
      transform: [{ scale: checkmarkScale.value }],
    };
  });

  const animatedDoubleCheckStyle = useAnimatedStyle(() => {
    return {
      opacity: doubleCheckOpacity.value,
      transform: [{ scale: doubleCheckScale.value }],
    };
  });

  // FIXED: Enhanced read receipts render function for 2-person chats
  const renderMessageStatus = () => {
    // Reduced checkmark debug logging to minimize noise
    // Only show status for current user's sent messages
    if (!isCurrentUser) {
      return null;
    }
    
    // FIXED: Only show read receipts for 2-person chats (otherUserCount === 1)
    // Hide for single-user chats (otherUserCount === 0) and group chats (otherUserCount > 1)
    if (readReceiptStatus.otherUserCount !== 1) {
      return null;
    }

    // Keep checkmarks white for both delivered and read states
    const statusColor = THEME.white;

    return (
      <View style={styles.statusContainer}>
        {/* Conditionally render the appropriate checkmark based on read status */}
        {readReceiptStatus.allOtherUsersRead ? (
          // Show double checkmark when message is read
          <Animated.View style={[animatedDoubleCheckStyle]}>
            <Ionicons 
              name="checkmark-done" 
              size={16} 
              color={statusColor}
            />
          </Animated.View>
        ) : readReceiptStatus.isDelivered ? (
          // Show single checkmark when message is delivered but not read
          <Animated.View style={[animatedCheckmarkStyle]}>
            <Ionicons 
              name="checkmark" 
              size={16} 
              color={statusColor}
            />
          </Animated.View>
        ) : null}
      </View>
    );
  };

  // State for typewriter effect during message sending
  const [showSendingTypewriter, setShowSendingTypewriter] = useState(false);
  const [typewriterTexts, setTypewriterTexts] = useState<string[]>([]);

  // Enhanced typewriter effect logic with cycling texts
  useEffect(() => {
    if (messageData.isVoiceMessage && isCurrentUser) {
      // Handle both official and client-side status values
      const status = item.processingStatus;
      
      let textOptions: string[] = [];
      
      if ((status as any) === 'pending') {
        textOptions = [
          'Preparing message...',
          'Getting ready...',
          'Processing audio...'
        ];
      } else if (status === 'processing') {
        textOptions = [
          'Sending voice message...',
          'Uploading audio...',
          'Connecting to server...',
          'Processing request...'
        ];
      } else if (status === 'ready' && !messageData.hasTranscription) {
        textOptions = [
          'Transcribing audio...',
          'Converting speech to text...',
          'Analyzing voice patterns...',
          'Processing transcription...',
          'Almost ready...'
        ];
      } else if (status === 'failed') {
        textOptions = [
          'Message failed to send...',
          'Please try again...',
          'Connection error...'
        ];
      }

      if (textOptions.length > 0) {
        setShowSendingTypewriter(true);
        setTypewriterTexts(textOptions);
      } else {
        setShowSendingTypewriter(false);
        setTypewriterTexts([]);
      }
    } else {
      setShowSendingTypewriter(false);
      setTypewriterTexts([]);
    }
  }, [item.processingStatus, messageData.isVoiceMessage, messageData.hasTranscription, isCurrentUser]);

  const renderTranscription = (isEavesdropMode: boolean) => {
    // PRIORITY 1: Show actual transcription if it exists (regardless of processing status)
    if (messageData.hasTranscription && messageData.transcriptionResult) {
      return (
        <View style={styles.transcriptionContainer}>
          <ChatTranscriptionDisplay
            transcription={messageData.transcriptionResult}
            currentPosition={messagePosition}
            isCurrentUser={isCurrentUser}
            isEavesdropMode={isEavesdropMode}
          />
        </View>
      );
    }

    // PRIORITY 2: Show typewriter effect only when no transcription exists yet
    if (showSendingTypewriter && typewriterTexts.length > 0) {
      return (
        <View style={styles.transcriptionContainer}>
          <CyclingTypewriterText
            texts={typewriterTexts}
            isCurrentUser={isCurrentUser}
            isEavesdropMode={isEavesdropMode}
            cycleInterval={1500}
            typeSpeed={60}
            deleteSpeed={30}
          />
        </View>
      );
    }

    // PRIORITY 3: No transcription and no typewriter effect - show nothing
    return null;
  };

  const renderProcessingIndicator = () => {
    // Enhanced 3 dots display - show for more processing states to be more engaging
    const status = item.processingStatus;
    if (item.type === 'voice' && 
        ((status as any) === 'pending' ||
         status === 'processing' || 
         (status === 'ready' && !messageData.hasTranscription))) {
      return <AppleStyleProcessingAnimation />;
    }
    return null;
  };

  const renderMedia = () => {
    // Handle image messages
    if (item.type === 'image' && item.mediaUrl) {
      return (
        <TouchableOpacity onPress={handleImageTap} activeOpacity={0.9}>
          <View style={styles.mediaContainer}>
            <Image
              source={{ uri: item.mediaUrl }}
              style={styles.mediaContent}
              resizeMode="cover"
            />
          </View>
        </TouchableOpacity>
      );
    }
    
    // Handle video messages
    if (item.type === 'video' && item.mediaUrl) {
      return (
        <View style={styles.mediaContainer}>
          <Video
            ref={videoRef}
            source={{ uri: item.mediaUrl }}
            style={styles.mediaContent}
            resizeMode={ResizeMode.COVER}
            onPlaybackStatusUpdate={handleVideoProgress}
          />
          {renderVideoControls()}
        </View>
      );
    }
    
    // Handle voice messages (existing functionality)
    if (item.type === 'voice' && item.audioUrl) {
      // For now, we only handle audio messages
      // Image and video support can be added later when mediaUrl is added to the Message interface
      return null;
    }
    
    return null;
  };

  // Check if this is a media-only message (no text content)
  const isMediaOnlyMessage = (item.type === 'image' || item.type === 'video') && 
    item.mediaUrl && 
    (!item.content || item.content.trim() === '');

  return (
    <>
      {/* Fullscreen Image Modal */}
      {item.type === 'image' && item.mediaUrl && (
        <ImageViewing
          images={[{ uri: item.mediaUrl }]}
          imageIndex={0}
          visible={isImageFullscreen}
          onRequestClose={() => setIsImageFullscreen(false)}
          swipeToCloseEnabled={true}
          doubleTapToZoomEnabled={true}
        />
      )}
      
      <View style={[
        styles.messageWrapper,
        { justifyContent: isCurrentUser ? 'flex-end' : 'flex-start' }
      ]}>
        {!isCurrentUser && showSenderName && (
          <Text style={[
            styles.messageSender,
            isEavesdropMode && styles.eavesdropText
          ]}>
            {messageData.senderName}
          </Text>
        )}
        <Animated.View style={animatedStyle}>
          {messageData.isVoiceMessage ? (
            <TouchableOpacity
              onPress={handleMessageTap}
              activeOpacity={0.7}
              style={[
                styles.messageContainer,
                isCurrentUser ? styles.currentUserMessage : styles.otherUserMessage,
                isEavesdropMode && styles.eavesdropMessage,
                isPlayingThis && styles.playingMessageHighlight
              ]}
            >
              {renderMedia()}
              {renderTranscription(!!isEavesdropMode)}
              <View style={[styles.messageFooter, isCurrentUser && { justifyContent: 'flex-end' }]}> 
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[
                    styles.timeText,
                    isEavesdropMode ? styles.eavesdropText : { color: isCurrentUser ? "#fff" : "rgba(255, 255, 255, 0.8)" }
                  ]}>
                    {formatTime ? formatTime(messagePosition) : ''} / {formatTime ? formatTime(messageDuration || item.duration || 0) : ''}
                  </Text>
                  {renderProcessingIndicator && renderProcessingIndicator()}
                  {isCurrentUser && renderMessageStatus && renderMessageStatus()}
                </View>
              </View>
            </TouchableOpacity>
          ) : isMediaOnlyMessage ? (
            // Media-only messages without bubble styling
            <View style={[
              styles.mediaOnlyContainer,
              isCurrentUser && { alignSelf: 'flex-end' },
              isPlayingThis && styles.playingMessageHighlight
            ]}>
              {renderMedia()}
              {renderTranscription(!!isEavesdropMode)}
              <View style={[styles.messageFooter, isCurrentUser && { justifyContent: 'flex-end' }]}> 
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[
                    styles.timeText,
                    isEavesdropMode ? styles.eavesdropText : { color: isCurrentUser ? "#fff" : "rgba(255, 255, 255, 0.8)" }
                  ]}>
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {renderProcessingIndicator && renderProcessingIndicator()}
                  {isCurrentUser && renderMessageStatus && renderMessageStatus()}
                </View>
              </View>
            </View>
          ) : (
            // Regular messages with bubble styling
            <View style={[
              styles.messageContainer,
              isCurrentUser ? styles.currentUserMessage : styles.otherUserMessage,
              isEavesdropMode && styles.eavesdropMessage,
              isCurrentUser && { alignSelf: 'flex-end' },
              isPlayingThis && styles.playingMessageHighlight
            ]}>
              {renderMedia()}
              {renderTranscription(!!isEavesdropMode)}
              {(messageData.isTextMessage || messageData.isImageMessage || messageData.isVideoMessage) && messageData.hasContent && (
                <Text style={[
                  styles.messageText,
                  isEavesdropMode ? styles.eavesdropText : (isCurrentUser ? { color: "#fff" } : { color: "rgba(255, 255, 255, 0.9)" }),
                  { textAlign: isCurrentUser ? 'right' : 'left', alignSelf: isCurrentUser ? 'flex-end' : 'flex-start' }
                ]}>
                  {item.content}
                </Text>
              )}
              <View style={[styles.messageFooter, isCurrentUser && { justifyContent: 'flex-end' }]}> 
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[
                    styles.timeText,
                    isEavesdropMode ? styles.eavesdropText : { color: isCurrentUser ? "#fff" : "rgba(255, 255, 255, 0.8)" },

                  ]}>
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {renderProcessingIndicator && renderProcessingIndicator()}
                  {isCurrentUser && renderMessageStatus && renderMessageStatus()}
                </View>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
    </>
  );
});

// Custom comparison function for React.memo to prevent unnecessary re-renders
const areEqual = (prevProps: GroupChatMessageProps, nextProps: GroupChatMessageProps) => {
  // Check if critical props have changed
  if (prevProps.item._id !== nextProps.item._id) return false;
  if (prevProps.item.transcription !== nextProps.item.transcription) return false;
  if (prevProps.item.processingStatus !== nextProps.item.processingStatus) return false;
  if (prevProps.item.mediaUrl !== nextProps.item.mediaUrl) return false;
  
  // FIXED: Deep comparison of readBy object for proper read receipt tracking
  // This ensures that read receipt changes are properly detected for consecutive messages
  const prevReadBy = prevProps.item.readBy || {};
  const nextReadBy = nextProps.item.readBy || {};
  const prevReadByKeys = Object.keys(prevReadBy);
  const nextReadByKeys = Object.keys(nextReadBy);
  
  if (prevReadByKeys.length !== nextReadByKeys.length) return false;
  
  for (const key of prevReadByKeys) {
    if (prevReadBy[key] !== nextReadBy[key]) return false;
  }
  
  if (prevProps.isPlaying !== nextProps.isPlaying) return false;
  if (prevProps.playbackPosition[prevProps.item._id] !== nextProps.playbackPosition[nextProps.item._id]) return false;
  if (prevProps.isEavesdropMode !== nextProps.isEavesdropMode) return false;
  if (prevProps.isNewMessage !== nextProps.isNewMessage) return false;
  
  // Compare group members (shallow comparison for performance)
  if (prevProps.groupMembers?.length !== nextProps.groupMembers?.length) return false;
  
  return true;
};

// Export the memoized component with custom comparison
export default React.memo(GroupChatMessage, areEqual);

const styles = StyleSheet.create({
  messageWrapper: {
    marginVertical: 2,
    width: '100%',
    flexDirection: 'column',
    paddingBottom: 0,
  },
  messageContainer: {
    maxWidth: '80%',
    borderRadius: 20,
    padding: 12,
    marginHorizontal: 8,
    marginBottom: 0,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  mediaMessageContainer: {
    backgroundColor: 'transparent',
    padding: 0,
    marginHorizontal: 8,
    maxWidth: '80%',
  },
  currentUserMessage: {
    backgroundColor: THEME.accentBlue,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  otherUserMessage: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  eavesdropMessage: {
    backgroundColor: '#23242a',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  playingMessageBubble: {
    borderWidth: 2,
    borderColor: '#282828',
  },
  messageSender: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    marginBottom: 4,
    alignSelf: 'flex-start',
    marginLeft: 24,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    marginBottom: 0,
    paddingBottom: 0,
    minHeight: 24,
  },
  timeText: {
    fontSize: 12,
    opacity: 0.7,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },
  mediaContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 8,
    width: '100%',
    aspectRatio: 3/4,
    backgroundColor: '#000',
  },
  mediaContent: {
    width: '100%',
    height: '100%',
  },
  coverVideoContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
  },
  transcriptionContainer: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: 'transparent',
    padding: 6,
  },
  transcriptionLoadingContainer: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
  },
  fullscreenCloseButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 1,
    padding: 8,
  },
  videoControls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  eavesdropText: {
    color: '#fff',
  },
  processingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    fontSize: 16,
    color: '#fff',
    marginHorizontal: 2,
  },
  // Typewriter styles for transcription
  typewriterText: {
    fontSize: 14,
    lineHeight: 20,
    marginRight: 1,
  },
  currentUserText: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  otherUserText: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  cursor: {
    opacity: 0.8,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 2,
    marginTop: 2,
    paddingHorizontal: 2,
  },
  playingMessageHighlight: {
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  sendingMessageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sendingIndicatorContainer: {
    marginLeft: 8,
  },
  mediaOnlyContainer: {
    maxWidth: '80%',
    padding: 0,
    marginHorizontal: 8,
    marginBottom: 0,
    backgroundColor: 'transparent',
  },
}); 