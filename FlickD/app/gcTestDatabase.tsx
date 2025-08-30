import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, Easing, FlatList, KeyboardAvoidingView, Modal, Platform, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView, PanGestureHandler, PanGestureHandlerGestureEvent, State } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { v4 as uuidv4 } from 'uuid';
import AnimatedSVGBackground from '../components/AnimatedSVGBackground';
import GradientWavesBackground from '../components/GradientWavesBackground';
import GroupReadReceipts from '../components/GroupReadReceipts';
import PulsatingBackground from '../components/PulsatingBackground';
import RecordingControls from '../components/RecordingControls';
import { useScalableQueue } from '../components/ScalableMessageQueueProvider';
import ScalableQueueIntegration from '../components/ScalableQueueIntegration';
import { FastPlaybackManager } from '../services/FastPlaybackManager';
import RecordingService from '../services/recordingService';
import { AudioAnalyzer } from '../utils/AudioAnalyzer';
import FastTranscriptionOptimizer from '../utils/fastTranscriptionOptimizer';
import AnimatedWaveform from './components/AnimatedWaveform';
import EavesdropView from './components/EavesdropView';
import GroupChatList from './components/GroupChatList';
import GroupChatListItem from './components/GroupChatListItem';
import GroupChatMessage from './components/GroupChatMessage';
import GroupInfoModal from './components/GroupInfoModal';
import UnreadMessagesPopup from './components/UnreadMessagesPopup';
import { useAuth } from './context/AuthContext';
import { useGestureContext } from './context/GestureContext';
import { Message, useGroupChatContext } from './context/GroupChatContext';
import { useSettings } from './context/SettingsContext';

const API_URL = Constants.expoConfig?.extra?.API_URL;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Theme colors
const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
};

// Type definitions
interface GroupChatMember {
  userId: string;
  name: string;
  joinedAt: string;
}

interface GroupChat {
  _id: string;
  name: string;
  description?: string;
  createdBy: string;
  members: GroupChatMember[];
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  unreadCount?: number;
}

interface User {
  _id: string;
  userId?: string;
  name: string;
  email: string;
}

interface SearchUser extends User {
  _id: string;
}

interface GroupChatMessageProps {
  item: Message;
  user: {
    userId?: string;
  };
  playbackPosition: { [key: string]: number };
  playbackDuration: { [key: string]: number };
  isPlaying: string | null;
  getAudioUrl: (messageId: string) => Promise<string>;
  pauseMessage: () => void;
  playMessage: (message: Message) => void;
  seekMessage: (messageId: string, position: number) => void;
  formatTime: (seconds: number) => string;
  markMessageAsViewed: (message: Message) => void;
}

export default function GCTestDatabase() {
  const router = useRouter();
  const { user, accessToken, isLoading, isAuthenticated, refreshAccessToken, logout } = useAuth();
  const { setDisableTabGestures } = useGestureContext();
  const { autoRecordingEnabled } = useSettings();
  const {
    groupChats,
    selectedChat,
    messages,
    socket,
    isNavigating,
    setIsNavigating,
    fetchGroupChats,
    fetchMessages,
    fetchOlderMessages,
    selectGroupChat,
    markMessageAsRead,
    markMessageAsViewed,
    markMessageAsDelivered,
    updateUnreadCount,
    setGroupChats,
    setSelectedChat,
    setMessages,
    isLoadingMessages,
    currentFetchingGroupId,
    isAnyoneRecording,
    getRecordingUsers,
    resetRecordingState,
  } = useGroupChatContext();

  // Scalable Queue Integration
  const {
    isQueueProcessing,
    currentQueueStatus,
    queueMetrics,
    pauseQueueProcessing,
    resumeQueueProcessing,
    clearQueueForGroup
  } = useScalableQueue();

  const [newMessage, setNewMessage] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [currentRecording, setCurrentRecording] = useState<Audio.Recording | null>(null);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const [playbackPosition, setPlaybackPosition] = useState<{ [key: string]: number }>({});
  const [playbackDuration, setPlaybackDuration] = useState<{ [key: string]: number }>({});
  const [signedUrls, setSignedUrls] = useState<{ [key: string]: string }>({});
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [hasAutoPlayed, setHasAutoPlayed] = useState(false);
  const [playedMessageIds, setPlayedMessageIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
  const playedMessageIdsRef = useRef(new Set<string>());
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const hasAutoRecordedRef = useRef(false);
  const [isGroupInfoVisible, setIsGroupInfoVisible] = useState(false);
  const [searchUserName, setSearchUserName] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addMemberModalVisible, setAddMemberModalVisible] = useState(false);
  const [currentAudioData, setCurrentAudioData] = useState<Float32Array | undefined>();
  const audioAnalyzer = useRef<AudioAnalyzer | null>(null);
  const isManualPlaybackRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingStartTime, setRecordingStartTime] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isPlayingMessage, setIsPlayingMessage] = useState(false);
  const [isEavesdropping, setIsEavesdropping] = useState(false);
  const [eavesdropChat, setEavesdropChat] = useState<GroupChat | null>(null);
  const prevSelectedChatRef = useRef<GroupChat | null>(null);
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const rotateY = useRef(new Animated.Value(0)).current;
  const listTranslateX = useRef(new Animated.Value(-SCREEN_WIDTH)).current;
  const listOpacity = useRef(new Animated.Value(0)).current;
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);
  const [showUnreadPopup, setShowUnreadPopup] = useState(false); // Don't show immediately, wait for unread check
  const [unreadCount, setUnreadCount] = useState(0);
  const [checkingUnread, setCheckingUnread] = useState(true);
  const [hasShownUnreadPopup, setHasShownUnreadPopup] = useState(false);
  
  // Add leaving groups tracker to prevent race conditions
  const [leavingGroups, setLeavingGroups] = useState<Set<string>>(new Set());
  
  const [incomingMessagesToPlay, setIncomingMessagesToPlay] = useState<Set<string>>(new Set());
  const incomingMessagesToPlayRef = useRef(new Set<string>());
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const isAutoPlayingRef = useRef(false);
  const justFinishedRecordingRef = useRef(false);
  const [externalModalTrigger, setExternalModalTrigger] = useState(false);
  // Add a ref to track the last processed message to prevent echo
  const lastProcessedMessageRef = useRef<string | null>(null);
  
  // Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Add a ref to track if we've received and played any messages in this chat session
  const hasReceivedAndPlayedMessageRef = useRef(false);
  
  // Message queue system for playing unread messages - BULLETPROOF VERSION
  const messageQueueRef = useRef<Message[]>([]);
  const isQueueProcessingRef = useRef(false);
  const queueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // BULLETPROOF tracking - prevent any possibility of duplicates
  const queuedMessageIdsRef = useRef(new Set<string>());
  const processedMessageIdsRef = useRef(new Set<string>());
  const currentlyPlayingMessageIdRef = useRef<string | null>(null);
  const queueProcessingStartTimeRef = useRef<number>(0);
  
  // NEW ROBUST QUEUE SYSTEM - Simple and bulletproof with user-specific storage
  const robustQueueRef = useRef<{
    messages: Message[];
    isProcessing: boolean;
    processingMessageId: string | null;
    lastProcessedTime: number;
    blockedRecording: boolean; // Blocks recording until queue is completely empty
    processedMessageIds: Set<string>; // Track processed messages to prevent re-queueing
    userId: string | null; // Track which user this queue belongs to
    retryCount: number; // Track retry attempts to prevent infinite loops
    maxRetries: number; // Maximum number of retries before giving up
    processingTimeout: ReturnType<typeof setTimeout> | null; // Timeout for processing
  }>({
    messages: [],
    isProcessing: false,
    processingMessageId: null,
    lastProcessedTime: 0,
    blockedRecording: false,
    processedMessageIds: new Set(),
    userId: null,
    retryCount: 0,
    maxRetries: 5,
    processingTimeout: null
  });

  // Queue monitoring toggle
  const [showQueueMonitoring, setShowQueueMonitoring] = useState(false);

  // State management for recording
  const recordingStateRef = useRef({
    isRecording: false,
    isProcessingQueue: false,
    isPlayingMessage: false,
    hasAutoRecorded: false,
    lastRecordingTime: 0
  });

  // Add a ref to track if we're in an ongoing conversation (vs. initial entry)
  const isInOngoingConversationRef = useRef(false);
  
  // Add a ref to track paused recording state
  const pausedRecordingRef = useRef<{
    recording: Audio.Recording | null;
    wasRecording: boolean;
  }>({ recording: null, wasRecording: false });

  // Add a ref to track the last played audio duration for proper timing
  const lastAudioDurationRef = useRef<number>(0);

  // Add a ref to prevent multiple recording sessions
  const isStartingRecordingRef = useRef(false);
  
  // Add a ref to track if this is the first time opening a group chat
  const isFirstChatOpenRef = useRef(true);

  // Add a ref to prevent multiple recording sessions
  const recordingLockRef = useRef(false);
  const lastRecordingAttemptRef = useRef(0);
  const lastRecordingStartEmitRef = useRef(0);
  const lastStartRecordingCallRef = useRef(0);

  // Add a ref to track auto-recording state
  const autoRecordingStateRef = useRef({
    hasAutoRecordedInThisChat: false,
    isWaitingForQueueCompletion: false,
    lastAutoRecordTime: 0,
    // NEW: Add more robust state tracking
    isAutoRecordingInProgress: false,
    autoRecordingTriggered: false,
    lastProcessingResetTime: 0,
    shouldTriggerAfterQueueComplete: false,
    isWaitingForPlaybackCompletion: false,
    skipToLastMessage: false, // NEW: Track when multilevel skip goes to last message
    // BULLETPROOF: Add queue state tracking
    isInRecordingQueue: false,
    queueJoinTimestamp: 0,
    queuePosition: 0,
    isWaitingForQueueGrant: false,
    lastQueueStateCheck: 0,
    preventMultipleAutoRecording: false,
    shouldStartAfterPlayback: false, // NEW: Track deferred recording start
    pendingAutoRecordingAfterReset: false,
    pendingAutoRecordingReason: null as 'playback_ended' | 'queue_completed' | null,
  });

  // Add debounce mechanism for auto-recording to prevent race conditions
  const autoRecordDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSocketMessageTimeRef = useRef(0);
  const socketMessageCooldownRef = useRef(false);
  const lastAutoRecordTimeRef = useRef(0);
  const autoRecordCooldownDuration = 10000; // 10 second cooldown between auto-recordings

  // NEW: Add a ref to track processing state more reliably
  const processingStateRef = useRef({
    isProcessing: false,
    lastProcessingStart: 0,
    processingMessageId: null as string | null,
    processingTimeout: null as ReturnType<typeof setTimeout> | null,
    lastProcessingResetTime: 0
  });

  // Enhanced spam detection and rate limiting
  const messageSpamDetectionRef = useRef({
    recentMessages: [] as { timestamp: number; senderId: string; messageId: string }[],
    spamThreshold: 5, // Max 5 messages per window
    spamWindowMs: 10000, // 10 second window
    isSpamDetected: false,
    lastSpamDetectionTime: 0,
    spamCooldownMs: 30000, // 30 second cooldown after spam detection
    blockedSenders: new Set<string>()
  });

  // Enhanced queue management with priority and batching
  const queueManagementRef = useRef({
    maxQueueSize: 10, // Maximum messages in queue
    batchProcessingDelay: 2000, // Delay between processing batches
    priorityMessages: new Set<string>(), // High priority messages
    isProcessingBatch: false,
    lastBatchProcessTime: 0,
    queueOverflowCount: 0
  });

  // Recording session management
  const recordingSessionRef = useRef({
    maxRecordingDuration: 600000, // 10 minutes max recording (increased to prevent auto-stops)
    recordingStartTime: 0,
    recordingTimeoutId: null as ReturnType<typeof setTimeout> | null,
    forcedStopCount: 0,
    lastForcedStopTime: 0
  });

  // Sequential queue processing for batch operations
  const sequentialQueueRef = useRef({
    isProcessingSequentialMessages: false,
    totalMessagesInBatch: 0,
    processedMessagesInBatch: 0,
    shouldAutoRecordAfterBatch: false,
    batchStartTime: 0,
    batchTimeout: null as ReturnType<typeof setTimeout> | null
  });

  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set()); // Track new messages for animation

  // Initialize animation values based on selected chat
  useEffect(() => {
    if (selectedChat) {
      // Chat is selected - position chat on screen and list off-screen
      listTranslateX.setValue(-SCREEN_WIDTH);
      listOpacity.setValue(0);
      translateX.setValue(0);
      opacity.setValue(1);
      scale.setValue(1);
      rotateY.setValue(0);
    } else {
      // No chat selected - position list on screen
      listTranslateX.setValue(0);
      listOpacity.setValue(1);
      translateX.setValue(0);
      opacity.setValue(1);
      scale.setValue(1);
      rotateY.setValue(0);
    }
  }, [selectedChat]);

  // CRITICAL FIX: Reset all recording locks and service state when user changes (login/logout)
  useEffect(() => {
    if (user?.userId) {
      console.log('[USER CHANGE] 🧹 User logged in, clearing all recording locks and service state');
      
      // Clear all recording locks that could be stuck from previous sessions
      isStartingRecordingRef.current = false;
      recordingLockRef.current = false;
      lastStartRecordingCallRef.current = 0;
      lastRecordingAttemptRef.current = 0;
      lastRecordingStartEmitRef.current = 0;
      
      // CRITICAL: Reset auto-recording state flags that persist across user sessions
      autoRecordingStateRef.current = {
        hasAutoRecordedInThisChat: false,
        isWaitingForQueueCompletion: false,
        lastAutoRecordTime: 0,
        isAutoRecordingInProgress: false,
        autoRecordingTriggered: false,
        lastProcessingResetTime: 0,
        shouldTriggerAfterQueueComplete: false,
        isWaitingForPlaybackCompletion: false,
        skipToLastMessage: false,
        isInRecordingQueue: false,
        queueJoinTimestamp: 0,
        queuePosition: 0,
        isWaitingForQueueGrant: false,
        lastQueueStateCheck: 0,
        preventMultipleAutoRecording: false,
        shouldStartAfterPlayback: false,
        pendingAutoRecordingAfterReset: false,
        pendingAutoRecordingReason: null,
      };
      
      // Reset other auto-recording refs
      hasAutoRecordedRef.current = false;
      isProcessingRef.current = false;
      lastProcessedMessageRef.current = null;
      hasReceivedAndPlayedMessageRef.current = false;
      
      // Reset any pending "start after playback" grants when the user changes
      pendingRecordingGrantRef.current = false;
      
      // Reset RecordingService singleton to clean state
      const recordingService = RecordingService.getInstance();
      recordingService.cancelRecording().catch(() => {
        // Ignore errors during cleanup
      });
      recordingService.resetErrorState();
      
      // Clear any stuck recording UI state
      setIsRecording(false);
      setCurrentRecording(null);
      setRecordingDuration(0);
      setRecordingStartTime(0);
      setIsTranscribing(false);
      
      // CRITICAL FIX: Reset *playback* manager + UI state on user login
      cleanupAudio().catch(() => {
        /* ignore cleanup errors */
      });

      // Reset your robust in-memory queue
      robustQueueRef.current.messages = [];
      robustQueueRef.current.isProcessing = false;
      robustQueueRef.current.processingMessageId = null;

      // Reset the FastPlaybackManager cache + queue
      fastPlaybackManager.clearQueue();
      fastPlaybackManager.cleanup().catch(() => {
        /* ignore cleanup errors */ 
      });

      // Reset playback UI state
      setIsPlayingMessage(false);
      setCurrentSound(null);
      setPlaybackPosition({});
      setPlaybackDuration({});
      setCurrentMessageId(null);
      setCurrentPosition(0);
      setDuration(0);
      setHasAutoPlayed(false);
      setPlayedMessageIds(new Set());
      setIsAutoPlaying(false);
      isManualPlaybackRef.current = false;

      console.log('[USER CHANGE] ✅ Recording state reset complete for user:', user.userId);
    } else {
      console.log('[USER CHANGE] 🚪 User logged out, clearing all recording state');
      
      // User logged out - clear everything
      isStartingRecordingRef.current = false;
      recordingLockRef.current = false;
      lastStartRecordingCallRef.current = 0;
      
      // Reset auto-recording state on logout too
      autoRecordingStateRef.current = {
        hasAutoRecordedInThisChat: false,
        isWaitingForQueueCompletion: false,
        lastAutoRecordTime: 0,
        isAutoRecordingInProgress: false,
        autoRecordingTriggered: false,
        lastProcessingResetTime: 0,
        shouldTriggerAfterQueueComplete: false,
        isWaitingForPlaybackCompletion: false,
        skipToLastMessage: false,
        isInRecordingQueue: false,
        queueJoinTimestamp: 0,
        queuePosition: 0,
        isWaitingForQueueGrant: false,
        lastQueueStateCheck: 0,
        preventMultipleAutoRecording: false,
        shouldStartAfterPlayback: false,
        pendingAutoRecordingAfterReset: false,
        pendingAutoRecordingReason: null,
      };
      
      hasAutoRecordedRef.current = false;
      isProcessingRef.current = false;
      lastProcessedMessageRef.current = null;
      hasReceivedAndPlayedMessageRef.current = false;
      
      // Reset any pending "start after playback" grants when the user changes
      pendingRecordingGrantRef.current = false;
      
      // FIXED: Synchronous recording state cleanup to prevent race conditions
      // Reset RecordingService synchronously
      const recordingService = RecordingService.getInstance();
      recordingService.cancelRecording().catch(() => {
        // Ignore errors during cleanup
      });
      recordingService.resetErrorState();
      
      // CRITICAL FIX: Reset *playback* manager + UI state on user logout
      cleanupAudio().catch(() => {
        /* ignore cleanup errors */
      });

      // Reset your robust in-memory queue synchronously
      robustQueueRef.current.messages = [];
      robustQueueRef.current.isProcessing = false;
      robustQueueRef.current.processingMessageId = null;

      // Reset the FastPlaybackManager cache + queue synchronously
      fastPlaybackManager.clearQueue();
      fastPlaybackManager.cleanup().catch(() => {
        /* ignore cleanup errors */ 
      });

      // Reset playback UI state
      setIsPlayingMessage(false);
      setCurrentSound(null);
      setPlaybackPosition({});
      setPlaybackDuration({});
      setCurrentMessageId(null);
      setCurrentPosition(0);
      setDuration(0);
      setHasAutoPlayed(false);
      setPlayedMessageIds(new Set());
      setIsAutoPlaying(false);
      isManualPlaybackRef.current = false;

      // Clear UI state
      setIsRecording(false);
      setCurrentRecording(null);
      setRecordingDuration(0);
      setRecordingStartTime(0);
      setIsTranscribing(false);
    }
  }, [user?.userId]);

  // Reset auto recorded flag when chat changes
  useEffect(() => {
    hasAutoRecordedRef.current = false;
    isProcessingRef.current = false;
    lastProcessedMessageRef.current = null; // Reset last processed message
    hasReceivedAndPlayedMessageRef.current = false; // Reset received message flag
    clearQueue(); // Clear the message queue and reset tracking
    
    // NEW: Reset enhanced auto-recording state
    autoRecordingStateRef.current = {
      hasAutoRecordedInThisChat: false,
      isWaitingForQueueCompletion: false,
      lastAutoRecordTime: 0,
      isAutoRecordingInProgress: false,
      autoRecordingTriggered: false,
      lastProcessingResetTime: 0,
      shouldTriggerAfterQueueComplete: false,
      isWaitingForPlaybackCompletion: false,
      skipToLastMessage: false, // NEW: Track when multilevel skip goes to last message
      isInRecordingQueue: false,
      queueJoinTimestamp: 0,
      queuePosition: 0,
      isWaitingForQueueGrant: false,
      lastQueueStateCheck: 0,
      preventMultipleAutoRecording: false,
      shouldStartAfterPlayback: false, // NEW: Track deferred recording start
      pendingAutoRecordingAfterReset: false,
      pendingAutoRecordingReason: null,
    };
    
    // NEW: Reset processing state
    processingStateRef.current = {
      isProcessing: false,
      lastProcessingStart: 0,
      processingMessageId: null,
      processingTimeout: null,
      lastProcessingResetTime: 0
    };
    
    // Clear debounce timers
    if (autoRecordDebounceRef.current) {
      clearTimeout(autoRecordDebounceRef.current);
      autoRecordDebounceRef.current = null;
    }
    socketMessageCooldownRef.current = false;
    lastSocketMessageTimeRef.current = 0;
    lastAutoRecordTimeRef.current = 0; // Reset auto-record cooldown timer
    
    // Reset spam detection for new chat (but keep recent message history for cross-chat spam detection)
    const spamDetection = messageSpamDetectionRef.current;
    spamDetection.isSpamDetected = false;
    spamDetection.lastSpamDetectionTime = 0;
    // Don't clear blockedSenders - keep them blocked across chats for better spam protection
    
    // Reset queue management state
    const queueMgmt = queueManagementRef.current;
    queueMgmt.isProcessingBatch = false;
    queueMgmt.lastBatchProcessTime = 0;
    queueMgmt.queueOverflowCount = 0;
    queueMgmt.priorityMessages.clear();
    
    // Reset sequential batch processing state
    const sequentialQueue = sequentialQueueRef.current;
    if (sequentialQueue.batchTimeout) {
      clearTimeout(sequentialQueue.batchTimeout);
      sequentialQueue.batchTimeout = null;
    }
    sequentialQueue.isProcessingSequentialMessages = false;
    sequentialQueue.totalMessagesInBatch = 0;
    sequentialQueue.processedMessagesInBatch = 0;
    sequentialQueue.batchStartTime = 0;
    sequentialQueue.shouldAutoRecordAfterBatch = false;
    
  }, [selectedChat?._id]);

  // FIXED: Auto-recording when entering chat with no unread messages
  // Removed isRecording from dependencies to prevent re-triggering when recording stops
  useEffect(() => {
    if (!selectedChat || !user?.userId || !autoRecordingEnabled) {
      return;
    }

    // CRITICAL FIX: Enhanced state checking to prevent double triggers
    const autoState = autoRecordingStateRef.current;
    const now = Date.now();
    
    // Check if we're in any recording-related state
    if (isRecording || 
        autoState.isAutoRecordingInProgress || 
        autoState.isInRecordingQueue ||
        autoState.autoRecordingTriggered ||
        autoState.hasAutoRecordedInThisChat) {
      return;
    }

    // ENHANCED: Check cooldown to prevent rapid re-triggers
    if (autoState.lastAutoRecordTime > 0 && (now - autoState.lastAutoRecordTime < 3000)) {
      return;
    }

    // Wait for messages to be loaded
    if (isLoadingMessages || currentFetchingGroupId === selectedChat._id) {
      return;
    }

    // Check if there are any unread messages from other users
    const unreadMessages = messages.filter(msg => {
      if (msg.senderId === user.userId) return false; // Skip own messages
      if (msg.groupChatId !== selectedChat._id) return false; // Skip wrong chat
      if (msg.type !== 'voice') return false; // Skip non-voice messages
      if (msg.isRead) return false; // Skip read messages
      return true;
    });

    // CRITICAL FIX: Also check robust queue for pending messages from other users
    // This prevents autorecording when there are messages waiting to be played
    const robustQueue = robustQueueRef.current;
    const pendingMessagesFromOthers = robustQueue.messages.filter(msg => {
      if (msg.senderId === user.userId) return false; // Skip own messages
      if (msg.groupChatId !== selectedChat._id) return false; // Skip wrong chat
      // Note: robust queue typically contains voice messages, so we don't need to filter by type
      return true;
    });

    // CASE 1: No unread messages AND no pending messages from others AND queue not processing - trigger auto-recording immediately
    if (unreadMessages.length === 0 && pendingMessagesFromOthers.length === 0 && !robustQueue.isProcessing) {
      
      // NEW: Check if someone is already recording in this group chat BEFORE triggering auto-recording
      const shouldUseQueue = selectedChat.members && selectedChat.members.length > 2;
      if (shouldUseQueue && getRecordingUsers && socket && user?.userId) {
        const recordingUsers = getRecordingUsers(selectedChat._id) || [];
        const currentUserId = user.userId;
        const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
        
        // If others are recording, automatically add user to queue
        if (otherRecordingUsers.length > 0) {
          
          const currentUser = selectedChat.members.find(member => member.userId === currentUserId);
          if (!currentUser) {
            return;
          }
          
          // Set queue state flags
          autoState.isInRecordingQueue = true;
          autoState.isWaitingForQueueGrant = true;
          autoState.queueJoinTimestamp = Date.now();
          autoState.autoRecordingTriggered = true;
          autoState.hasAutoRecordedInThisChat = true; // Mark as attempted to prevent future triggers
          
          socket.emit('join_recording_queue', {
            groupId: selectedChat._id,
            userId: currentUserId,
            userName: currentUser.name,
            timestamp: Date.now(),
            isAutoRecording: true,
          });
          
          return;
        }
      }
      
      // No one else recording, proceed with normal auto-recording
      
      // Set flag immediately to prevent double triggers
      autoState.autoRecordingTriggered = true;
      
      // FIXED: Reduced delay for much more responsive auto-recording
      setTimeout(() => {
        // FIXED: Check if auto-recording is allowed before triggering WITH 'chat_entry' reason
        if (canAutoRecord('chat_entry')) {
          triggerAutoRecording('chat_entry');
        } else {
          // Reset flag if we can't auto-record
          autoState.autoRecordingTriggered = false;
          // FIXED: Only retry if we haven't already attempted auto-recording in this chat
          if (!autoState.hasAutoRecordedInThisChat) {
            setTimeout(() => {
              if (canAutoRecord('chat_entry') && !autoState.hasAutoRecordedInThisChat && !autoState.autoRecordingTriggered) {
                autoState.autoRecordingTriggered = true;
                triggerAutoRecording('chat_entry');
              } else {
                // CRITICAL FIX: Mark as attempted even if disabled to prevent future auto-recording attempts
                autoState.hasAutoRecordedInThisChat = true;
                autoState.autoRecordingTriggered = false;
              }
            }, 500); // Reduced from 2000ms to 500ms for faster response
          }
        }
      }, 200); // Reduced from 1000ms to 200ms for much more responsive auto-recording
    } else {
      // CASE 2: Has unread messages - auto-recording will be triggered when queue completes
      autoState.isWaitingForQueueCompletion = true;
      
      // CRITICAL FIX: Reset auto-recording flags when there are unread messages
      // This prevents auto-recording from triggering incorrectly
      autoState.hasAutoRecordedInThisChat = false;
      autoState.isAutoRecordingInProgress = false;
      autoState.autoRecordingTriggered = false;
      autoState.lastAutoRecordTime = 0;
      
    }
  }, [selectedChat?._id, messages, user?.userId, isLoadingMessages, currentFetchingGroupId]); // REMOVED isRecording from dependencies

  // Load played messages when chat changes
  useEffect(() => {
    const loadPlayedMessages = async () => {
      if (selectedChat?._id) {
        try {
          const storedPlayedMessages = await AsyncStorage.getItem(`played_messages_${selectedChat._id}`);
          if (storedPlayedMessages) {
            const messageIds = JSON.parse(storedPlayedMessages);
            playedMessageIdsRef.current = new Set(messageIds);
          }
          setIsStorageLoaded(true);
        } catch (error) {
          console.error('Error loading played messages:', error);
          setIsStorageLoaded(true);
        }
      }
    };
    setIsStorageLoaded(false);
    loadPlayedMessages();
  }, [selectedChat?._id]);

  const savePlayedMessages = async (messageId: string) => {
    if (selectedChat?._id) {
      try {
        playedMessageIdsRef.current.add(messageId);
        const messageIds = Array.from(playedMessageIdsRef.current);
        await AsyncStorage.setItem(
          `played_messages_${selectedChat._id}`,
          JSON.stringify(messageIds)
        );
      } catch (error) {
        console.error('Error saving played messages:', error);
      }
    }
  };

  useEffect(() => {
    if (user && user.userId) {
      fetchGroupChats(user.userId);
    }
  }, [user]);

  const getPermission = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant permission to use the microphone');
      }
      return status === 'granted';
    } catch (error) {
      console.error('Error requesting microphone permission:', error);
      return false;
    }
  };

  useEffect(() => {
    getPermission();
    return () => {
      if (currentSound) {
        currentSound.unloadAsync();
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      // Cleanup audio resources
      if (currentSound) {
        currentSound.unloadAsync();
      }
      // Clear all cached signed URLs
      setSignedUrls({});
    };
  }, [currentSound, selectedChat?._id]);

  useEffect(() => {
    setHasAutoPlayed(false);
    setPlayedMessageIds(new Set());
    if (currentSound) {
      currentSound.unloadAsync();
    }
    setCurrentSound(null);
    setIsPlaying(null);
    setCurrentMessageId(null);
  }, [selectedChat]);

  const handleNetworkError = (error: any, message: string) => {
    console.error(message, error);
    Alert.alert(
      'Network Error',
      'Please check your internet connection and try again.',
      [{ text: 'OK' }]
    );
  };

  const createGroupChat = async (name: string, memberUsernames: string[]) => {
   /* console.log('[CreateGroupChat] Starting group chat creation:', {
      name,
      memberUsernames,
      currentUserId: user?.userId,
      currentUserName: user?.name,
      timestamp: new Date().toISOString()
    });*/

    if (!user || !user.userId) {
      console.error('[CreateGroupChat] Missing user data:', {
        hasUser: !!user,
        hasUserId: !!user?.userId
      });
      return;
    }

    try {
      //console.log('[CreateGroupChat] Step 1: Converting usernames to user IDs');
      
      // Convert usernames to user IDs
      const memberIds: string[] = [];
      for (const username of memberUsernames) {
        if (username === user.name) {
          // Skip creator, they'll be added automatically
         // console.log('[CreateGroupChat] Skipping creator username:', username);
          continue;
        }
        
        try {
         // console.log('[CreateGroupChat] Looking up user ID for username:', username);
          const userResponse = await fetch(`${API_URL}/users?name=${encodeURIComponent(username)}`);
          
          if (!userResponse.ok) {
            console.error('[CreateGroupChat] Failed to lookup user:', username);
            continue;
          }
          
          const users = await userResponse.json();
          if (users.length > 0) {
            const userId = users[0]._id;
           // console.log('[CreateGroupChat] Found user ID:', { username, userId });
            memberIds.push(userId);
          } else {
            console.error('[CreateGroupChat] User not found:', username);
          }
        } catch (error) {
          console.error('[CreateGroupChat] Error looking up user:', { username, error });
        }
      }

      /*console.log('[CreateGroupChat] Converted usernames to user IDs:', {
        originalUsernames: memberUsernames,
        convertedUserIds: memberIds,
        count: memberIds.length
      });


      */
      // 1. Create the group chat with the creator as the only member
      const createRequest = {
        name,
        createdBy: user.userId
      };

      //console.log('[CreateGroupChat] Create group request:', createRequest);

      const response = await fetch(`${API_URL}/groupchats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createRequest),
      });

      /*console.log('[CreateGroupChat] Create group response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });*/

      if (!response.ok) {
        const error = await response.json();
        console.error('[CreateGroupChat] Create group failed:', error);
        throw new Error(error.error || 'Failed to create group chat');
      }

      const group = await response.json();
      /*console.log('[CreateGroupChat] Group created successfully:', {
        groupId: group._id,
        groupName: group.name,
        initialMembers: group.members,
        memberCount: group.members.length
      });*/

      // Filter out the creator from memberIds to avoid duplicates
      const membersToAdd = memberIds.filter(id => id !== user.userId);
      /*console.log('[CreateGroupChat] ⚡ OPTIMIZED: Preparing batch member addition:', {
        originalMemberIds: memberIds,
        creatorId: user.userId,
        membersToAdd,
        count: membersToAdd.length
      });*/

      // OPTIMIZATION: Use new batch endpoint for fast member addition
      if (membersToAdd.length > 0) {
        //console.log('[CreateGroupChat] ⚡ Adding all members in single batch request...');
        
        const batchAddRequest = {
          memberIds: membersToAdd
        };

        //console.log('[CreateGroupChat] ⚡ Batch add request:', batchAddRequest);

        const batchResponse = await fetch(`${API_URL}/groupchats/${group._id}/members/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batchAddRequest),
        });

        /*console.log('[CreateGroupChat] ⚡ Batch add response:', {
          status: batchResponse.status,
          statusText: batchResponse.statusText,
          ok: batchResponse.ok
        });*/

        if (batchResponse.ok) {
          const batchResult = await batchResponse.json();
          /*console.log('[CreateGroupChat] ⚡ FAST batch addition completed:', {
            addedCount: batchResult.addedCount,
            finalMemberCount: batchResult.finalMemberCount,
            addedMembers: batchResult.addedMembers?.map((m: any) => m.name) || [],
            allUsersAlreadyMembers: batchResult.allUsersAlreadyMembers
          });*/

          // Handle case where all users were already members
          if (batchResult.allUsersAlreadyMembers) {
            //console.log('[CreateGroupChat] ⚡ All users were already members - no additional work needed');
          }
        } else {
          let errorData;
          try {
            errorData = await batchResponse.json();
          } catch (jsonError) {
            console.error('[CreateGroupChat] ⚡ Failed to parse batch error response as JSON:', jsonError);
            errorData = { error: `HTTP ${batchResponse.status}: ${batchResponse.statusText}` };
          }
          console.warn('[CreateGroupChat] ⚡ Batch addition failed, falling back to individual requests:', errorData);
          
          // Fallback to individual requests if batch fails
          for (const memberId of membersToAdd) {
            try {
              const addMemberRequest = { memberIds: [memberId] };
              const addMemberResponse = await fetch(`${API_URL}/groupchats/${group._id}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(addMemberRequest),
              });
              
              if (!addMemberResponse.ok) {
                console.warn('[CreateGroupChat] Failed to add member in fallback:', memberId);
              }
            } catch (fallbackError) {
              console.warn('[CreateGroupChat] Fallback member addition error:', fallbackError);
            }
          }
        }
      } else {
       //console.log('[CreateGroupChat] ⚡ No additional members to add - group creation complete');
      }

      //console.log('[CreateGroupChat] All members processed, refreshing group chats');
      setNewGroupName('');
      setModalVisible(false);
      await fetchGroupChats(user.userId);
      
      //console.log('[CreateGroupChat] Group chat creation completed successfully');
      Alert.alert('Success', 'Group chat created successfully');
    } catch (error: any) {
      console.error('[CreateGroupChat] Error in group chat creation:', {
        error: error.message,
        stack: error.stack,
        type: error.constructor.name,
        name,
        memberUsernames
      });
      handleNetworkError(error, 'Error creating group chat:');
    }
  };

  const deleteGroupChat = async (groupId: string) => {
    if (!user || !user.userId) return;
    try {
      const response = await fetch(`${API_URL}/groupchats/${groupId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterId: user.userId
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete group chat');
      }
      await fetchGroupChats(user.userId);
      Alert.alert('Success', 'Group chat deleted successfully');
      if (selectedChat && selectedChat._id === groupId) {
        setSelectedChat(null);
        setMessages([]);
      }
    } catch (error) {
      handleNetworkError(error, 'Error deleting group chat:');
    }
  };

  const fetchSingleGroupChat = async (groupId: string) => {
    try {
      const response = await fetch(`${API_URL}/groupchats/${groupId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to fetch group chat');
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching single group chat:', error);
      return null;
    }
  };

  const addMemberToGroup = async (username: string) => {
    /*console.log('[AddMember][AddMemberToGroup] Starting member addition process:', {
      username,
      selectedChatId: selectedChat?._id,
      selectedChatName: selectedChat?.name,
      currentUserId: user?.userId,
      selectedUser: selectedUser ? {
        _id: selectedUser._id,
        name: selectedUser.name,
        email: selectedUser.email
      } : null,
      timestamp: new Date().toISOString()
    });*/

    if (!selectedChat || !user?.userId || !selectedUser) {
      console.error('[AddMember][AddMemberToGroup] Missing required data:', {
        hasSelectedChat: !!selectedChat,
        hasUserId: !!user?.userId,
        hasSelectedUser: !!selectedUser
      });
      Alert.alert('Error', 'Missing required data');
      return;
    }

    try {
      const requestUrl = `${API_URL}/groupchats/${selectedChat._id}/members`;
      const requestBody = {
        memberIds: [selectedUser._id]
      };

      /*console.log('[AddMember][AddMemberToGroup] Making API request:', {
        url: requestUrl,
        method: 'POST',
        body: requestBody,
        headers: {
          'Content-Type': 'application/json'
        }
      });*/

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      /*console.log('[AddMember][AddMemberToGroup] Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });*/

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[AddMember][AddMemberToGroup] API error response:', errorData);
        throw new Error(errorData.error || 'Failed to add member to group');
      }

      const responseData = await response.json();
      //console.log('[AddMember][AddMemberToGroup] Success response:', responseData);

      // Handle case where user was already a member
      if (responseData.alreadyMember) {
  
        Alert.alert('Info', `${selectedUser.name} is already a member of this group`);
        setSearchUserName('');
        setAddMemberModalVisible(false);
        return;
      }

      //console.log('[AddMember][AddMemberToGroup] Applying optimistic update...');
      
      // Optimistic update: Add the member immediately to the UI
      const newMember = {
        userId: selectedUser._id,
        name: selectedUser.name,
        joinedAt: new Date().toISOString()
      };
      
      setSelectedChat(prev => {
        if (!prev) return prev;
        // Check if member already exists to avoid duplicates
        const memberExists = prev.members.some(m => m.userId === selectedUser._id);
        if (!memberExists) {
          return {
            ...prev,
            members: [...prev.members, newMember]
          };
        }
        return prev;
      });
      
      // Also update group chats list
      setGroupChats(prevChats => 
        prevChats.map(chat => {
          if (chat._id === selectedChat._id) {
            const memberExists = chat.members.some(m => m.userId === selectedUser._id);
            if (!memberExists) {
              return {
                ...chat,
                members: [...chat.members, newMember]
              };
            }
          }
          return chat;
        })
      );
      
      //console.log('[AddMember][AddMemberToGroup] Optimistic update applied - member will be confirmed by socket event');

      //console.log('[AddMember][AddMemberToGroup] Cleaning up UI state...');
      setSearchUserName('');
      setAddMemberModalVisible(false);
      
      //console.log('[AddMember][AddMemberToGroup] Member addition completed successfully');
      Alert.alert('Success', `${username} has been added to the group`);
    } catch (error: any) {
      console.error('[AddMember][AddMemberToGroup] Error in member addition process:', {
        error: error.message,
        stack: error.stack,
        type: error.constructor.name,
        username,
        selectedChatId: selectedChat?._id
      });
      Alert.alert('Error', error.message || 'Failed to add member to group');
    }
  };

  const removeMemberFromGroup = async (userId: string) => {
    if (!selectedChat || !user?.userId) return;

    try {
      const memberToRemove = selectedChat.members.find(m => m.userId === userId);
      if (!memberToRemove) return;

      //console.log('[Frontend][RemoveMember] ⚡ FAST removal for:', memberToRemove.name);
      
      // OPTIMIZATION: Optimistic update - remove member immediately from UI
      setSelectedChat(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          members: prev.members.filter(member => member.userId !== userId)
        };
      });
      
      // Also update group chats list instantly
      setGroupChats(prevChats => 
        prevChats.map(chat => {
          if (chat._id === selectedChat._id) {
            return {
              ...chat,
              members: chat.members.filter(member => member.userId !== userId)
            };
          }
          return chat;
        })
      );
      
      // Make API call in background without waiting
      const token = await AsyncStorage.getItem('accessToken');
      const requestUrl = `${API_URL}/groupchats/${selectedChat._id}/members/${userId}`;
      
      fetch(requestUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requesterId: user.userId })
      }).then(response => {
        if (!response.ok) {
          console.error('[Frontend][RemoveMember] API failed, reverting optimistic update');
          // Revert optimistic update on error
          setSelectedChat(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              members: [...prev.members, memberToRemove]
            };
          });
          
          setGroupChats(prevChats => 
            prevChats.map(chat => {
              if (chat._id === selectedChat._id) {
                return {
                  ...chat,
                  members: [...chat.members, memberToRemove]
                };
              }
              return chat;
            })
          );
          
          Alert.alert('Error', 'Failed to remove member');
        } else {
          //console.log('[Frontend][RemoveMember] ⚡ Server confirmed removal');
        }
      }).catch(error => {
        console.error('[Frontend][RemoveMember] Network error:', error);
        // Revert on network error
        setSelectedChat(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            members: [...prev.members, memberToRemove]
          };
        });
      });

      //console.log('[Frontend][RemoveMember] ⚡ Instant UI update completed');
      
    } catch (error: any) {
      console.error('[Frontend][RemoveMember] Error:', error);
      Alert.alert('Error', 'Failed to remove member from group');
    }
  };

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || !selectedChat || !user) return;

    const tempId = `temp_${Date.now()}`;
    const tempMessage: Message = {
      _id: tempId,
      content: messageText,
      senderId: user.userId,
      groupChatId: selectedChat._id,
      timestamp: new Date().toISOString(),
      type: 'text',
      isRead: false,
      isDelivered: true,
      readBy: { [user.userId]: new Date().toISOString() },
      deliveredTo: [user.userId]
    };

    setMessages((prev: Message[]) => [tempMessage, ...prev]);
    setNewMessage('');

    try {
      const token = await AsyncStorage.getItem('accessToken');
      let response = await fetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          text: messageText,
          senderId: user.userId,
          groupChatId: selectedChat._id,
          type: 'text'
        }),
      });

      // Handle 401 error with token refresh
      if (response.status === 401) {
        console.log('[sendMessage] 401 received, attempting token refresh...');
        try {
          await refreshAccessToken();
          const newToken = await AsyncStorage.getItem('accessToken');
          response = await fetch(`${API_URL}/messages`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${newToken}`
            },
            body: JSON.stringify({
              text: messageText,
              senderId: user.userId,
              groupChatId: selectedChat._id,
              type: 'text'
            }),
          });
        } catch (refreshError) {
          console.error('[sendMessage] Token refresh failed:', refreshError);
          Alert.alert('Authentication Error', 'Please log in again');
          router.replace('/login');
          return;
        }
      }

      if (response.ok) {
        // OPTIMIZATION: Don't call fetchMessages - rely on socket events for immediate updates
        //console.log('[sendMessage] Message sent successfully, waiting for socket confirmation');
      } else {
        const error = await response.json();
        Alert.alert('Error', error.error || 'Failed to send message');
        setMessages((prev: Message[]) => prev.filter(msg => msg._id !== tempId));
        // OPTIMIZATION: Restore input text on error
        setNewMessage(messageText);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message');
      setMessages((prev: Message[]) => prev.filter(msg => msg._id !== tempId));
      // OPTIMIZATION: Restore input text on error
      setNewMessage(messageText);
    }
  };

import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, Easing, FlatList, KeyboardAvoidingView, Modal, Platform, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView, PanGestureHandler, PanGestureHandlerGestureEvent, State } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { v4 as uuidv4 } from 'uuid';
import AnimatedSVGBackground from '../components/AnimatedSVGBackground';
import GradientWavesBackground from '../components/GradientWavesBackground';
import GroupReadReceipts from '../components/GroupReadReceipts';
import PulsatingBackground from '../components/PulsatingBackground';
import RecordingControls from '../components/RecordingControls';
import { useScalableQueue } from '../components/ScalableMessageQueueProvider';
import ScalableQueueIntegration from '../components/ScalableQueueIntegration';
import { FastPlaybackManager } from '../services/FastPlaybackManager';
import { AudioAnalyzer } from '../utils/AudioAnalyzer';
import FastTranscriptionOptimizer from '../utils/fastTranscriptionOptimizer';
import AnimatedWaveform from './components/AnimatedWaveform';
import EavesdropView from './components/EavesdropView';
import GroupChatList from './components/GroupChatList';
import GroupChatListItem from './components/GroupChatListItem';
import GroupChatMessage from './components/GroupChatMessage';
import GroupInfoModal from './components/GroupInfoModal';
import UnreadMessagesPopup from './components/UnreadMessagesPopup';
import { useAuth } from './context/AuthContext';
import { useGestureContext } from './context/GestureContext';
import { Message, useGroupChatContext } from './context/GroupChatContext';
import { useSettings } from './context/SettingsContext';
import { useVideoCall } from './context/VideoCallContext';
import { useTheme } from './theme';

const API_URL = Constants.expoConfig?.extra?.API_URL;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Helper functions for avatar colors and initials
const getAvatarColor = (id: string): string => {
  const colors = ['#26A7DE', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
  const index = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
  return colors[index];
};

const getInitials = (name: string): string => {
  return name
    .split(' ')
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// Theme colors
const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
};

// Type definitions
interface GroupChatMember {
  userId: string;
  name: string;
  joinedAt: string;
}

interface GroupChat {
  _id: string;
  name: string;
  description?: string;
  createdBy: string;
  members: GroupChatMember[];
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  unreadCount?: number;
  groupIcon?: string;
}

interface User {
  _id?: string;
  userId?: string;
  name: string;
  email: string;
}

interface SearchUser extends User {
  _id?: string;
  userId: string;
}

interface GroupChatMessageProps {
  item: Message;
  user: {
    userId?: string;
  };
  playbackPosition: { [key: string]: number };
  playbackDuration: { [key: string]: number };
  isPlaying: string | null;
  getAudioUrl: (messageId: string) => Promise<string>;
  pauseMessage: () => void;
  playMessage: (message: Message) => void;
  seekMessage: (messageId: string, position: number) => void;
  formatTime: (seconds: number) => string;
  markMessageAsViewed: (message: Message) => void;
}

export default function GCTestDatabase() {
  const router = useRouter();
  const { user, accessToken, isLoading, isAuthenticated, refreshAccessToken, logout } = useAuth();
  const theme = useTheme();
  const { setDisableTabGestures } = useGestureContext();
  const { autoRecordingEnabled } = useSettings();
  const { startCall } = useVideoCall();
  const {
    groupChats,
    selectedChat,
    messages,
    socket,
    isNavigating,
    setIsNavigating,
    fetchGroupChats,
    fetchMessages,
    fetchOlderMessages,
    selectGroupChat,
    markMessageAsRead,
    markMessageAsViewed,
    markMessageAsDelivered,
    updateUnreadCount,
    setGroupChats,
    setSelectedChat,
    setMessages,
    isLoadingMessages,
    currentFetchingGroupId,
    isAnyoneRecording,
    getRecordingUsers,
    resetRecordingState,
  } = useGroupChatContext();

  // Scalable Queue Integration
  const {
    isQueueProcessing,
    currentQueueStatus,
    queueMetrics,
    pauseQueueProcessing,
    resumeQueueProcessing,
    clearQueueForGroup
  } = useScalableQueue();

  const [newMessage, setNewMessage] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [currentRecording, setCurrentRecording] = useState<Audio.Recording | null>(null);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const [playbackPosition, setPlaybackPosition] = useState<{ [key: string]: number }>({});
  const [playbackDuration, setPlaybackDuration] = useState<{ [key: string]: number }>({});
  const [signedUrls, setSignedUrls] = useState<{ [key: string]: string }>({});
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [hasAutoPlayed, setHasAutoPlayed] = useState(false);
  const [playedMessageIds, setPlayedMessageIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
  const playedMessageIdsRef = useRef(new Set<string>());
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const hasAutoRecordedRef = useRef(false);
  const [isGroupInfoVisible, setIsGroupInfoVisible] = useState(false);
  const [searchUserName, setSearchUserName] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addMemberModalVisible, setAddMemberModalVisible] = useState(false);
  const [currentAudioData, setCurrentAudioData] = useState<Float32Array | undefined>();
  const audioAnalyzer = useRef<AudioAnalyzer | null>(null);
  const isManualPlaybackRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingStartTime, setRecordingStartTime] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isPlayingMessage, setIsPlayingMessage] = useState(false);
  const [isEavesdropping, setIsEavesdropping] = useState(false);
  const [eavesdropChat, setEavesdropChat] = useState<GroupChat | null>(null);
  const prevSelectedChatRef = useRef<GroupChat | null>(null);
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const rotateY = useRef(new Animated.Value(0)).current;
  const listTranslateX = useRef(new Animated.Value(-SCREEN_WIDTH)).current;
  const listOpacity = useRef(new Animated.Value(0)).current;
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);
  // Reply system state
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [showUnreadPopup, setShowUnreadPopup] = useState(false); // Don't show immediately, wait for unread check
  const flatListRef = useRef<FlatList>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [checkingUnread, setCheckingUnread] = useState(true);
  const [hasShownUnreadPopup, setHasShownUnreadPopup] = useState(false);
  
  // Add leaving groups tracker to prevent race conditions
  const [leavingGroups, setLeavingGroups] = useState<Set<string>>(new Set());
  
  const [incomingMessagesToPlay, setIncomingMessagesToPlay] = useState<Set<string>>(new Set());
  const incomingMessagesToPlayRef = useRef(new Set<string>());
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const isAutoPlayingRef = useRef(false);
  const justFinishedRecordingRef = useRef(false);
  const [externalModalTrigger, setExternalModalTrigger] = useState(false);
  // Add a ref to track the last processed message to prevent echo
  const lastProcessedMessageRef = useRef<string | null>(null);
  
  // Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Add a ref to track if we've received and played any messages in this chat session
  const hasReceivedAndPlayedMessageRef = useRef(false);
  
  // Message queue system for playing unread messages - BULLETPROOF VERSION
  const messageQueueRef = useRef<Message[]>([]);
  const isQueueProcessingRef = useRef(false);
  const queueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // BULLETPROOF tracking - prevent any possibility of duplicates
  const queuedMessageIdsRef = useRef(new Set<string>());
  const processedMessageIdsRef = useRef(new Set<string>());
  const currentlyPlayingMessageIdRef = useRef<string | null>(null);
  const queueProcessingStartTimeRef = useRef<number>(0);
  
  // NEW ROBUST QUEUE SYSTEM - Simple and bulletproof with user-specific storage
  const robustQueueRef = useRef<{
    messages: Message[];
    isProcessing: boolean;
    processingMessageId: string | null;
    lastProcessedTime: number;
    blockedRecording: boolean; // Blocks recording until queue is completely empty
    processedMessageIds: Set<string>; // Track processed messages to prevent re-queueing
    userId: string | null; // Track which user this queue belongs to
    retryCount: number; // Track retry attempts to prevent infinite loops
    maxRetries: number; // Maximum number of retries before giving up
    processingTimeout: ReturnType<typeof setTimeout> | null; // Timeout for processing
  }>({
    messages: [],
    isProcessing: false,
    processingMessageId: null,
    lastProcessedTime: 0,
    blockedRecording: false,
    processedMessageIds: new Set(),
    userId: null,
    retryCount: 0,
    maxRetries: 5,
    processingTimeout: null
  });

  // Queue monitoring toggle
  const [showQueueMonitoring, setShowQueueMonitoring] = useState(false);

  // State management for recording
  const recordingStateRef = useRef({
    isRecording: false,
    isProcessingQueue: false,
    isPlayingMessage: false,
    hasAutoRecorded: false,
    lastRecordingTime: 0
  });

  // Add a ref to track if we're in an ongoing conversation (vs. initial entry)
  const isInOngoingConversationRef = useRef(false);
  
  // Add a ref to track paused recording state
  const pausedRecordingRef = useRef<{
    recording: Audio.Recording | null;
    wasRecording: boolean;
  }>({ recording: null, wasRecording: false });

  // Add a ref to track the last played audio duration for proper timing
  const lastAudioDurationRef = useRef<number>(0);

  // Add a ref to prevent multiple recording sessions
  const isStartingRecordingRef = useRef(false);
  
  // Add a ref to track if this is the first time opening a group chat
  const isFirstChatOpenRef = useRef(true);

  // Add a ref to prevent multiple recording sessions
  const recordingLockRef = useRef(false);
  const lastRecordingAttemptRef = useRef(0);

  // Add a ref to track auto-recording state
  const autoRecordingStateRef = useRef({
    hasAutoRecordedInThisChat: false,
    isWaitingForQueueCompletion: false,
    lastAutoRecordTime: 0,
    // NEW: Add more robust state tracking
    isAutoRecordingInProgress: false,
    autoRecordingTriggered: false,
    lastProcessingResetTime: 0,
    shouldTriggerAfterQueueComplete: false,
    isWaitingForPlaybackCompletion: false,
    skipToLastMessage: false, // NEW: Track when multilevel skip goes to last message
    // BULLETPROOF: Add queue state tracking
    isInRecordingQueue: false,
    queueJoinTimestamp: 0,
    queuePosition: 0,
    isWaitingForQueueGrant: false,
    lastQueueStateCheck: 0,
    preventMultipleAutoRecording: false,
    shouldStartAfterPlayback: false, // NEW: Track deferred recording start
    pendingAutoRecordingAfterReset: false,
    pendingAutoRecordingReason: null as 'playback_ended' | 'queue_completed' | null,
  });

  // NEW: Centralized Audio Playback Coordinator to prevent echo/double playback
  const audioPlaybackCoordinatorRef = useRef({
    currentlyPlayingMessageId: null as string | null,
    playbackStartTime: 0,
    isPlaybackInProgress: false,
    playbackLockTimeout: null as ReturnType<typeof setTimeout> | null,
    // Track which system is currently playing to prevent conflicts
    activePlaybackSystem: null as 'fastPlayback' | 'scalableQueue' | 'robustQueue' | 'manual' | null,
    // iOS compatibility: Track audio session state
    audioSessionState: 'idle' as 'idle' | 'playing' | 'paused',
    // Echo prevention: Track recently played messages to prevent immediate replay
    recentlyPlayedMessages: new Set<string>(),
    lastPlaybackEndTime: 0,
    echoPreventionWindow: 2000, // 2 second window to prevent echo
  });

  // Add debounce mechanism for auto-recording to prevent race conditions
  const autoRecordDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSocketMessageTimeRef = useRef(0);
  const socketMessageCooldownRef = useRef(false);
  const lastAutoRecordTimeRef = useRef(0);
  const autoRecordCooldownDuration = 10000; // 10 second cooldown between auto-recordings

  // NEW: Add a ref to track processing state more reliably
  const processingStateRef = useRef({
    isProcessing: false,
    lastProcessingStart: 0,
    processingMessageId: null as string | null,
    processingTimeout: null as ReturnType<typeof setTimeout> | null,
    lastProcessingResetTime: 0
  });

  // Enhanced spam detection and rate limiting
  const messageSpamDetectionRef = useRef({
    recentMessages: [] as { timestamp: number; senderId: string; messageId: string }[],
    spamThreshold: 5, // Max 5 messages per window
    spamWindowMs: 10000, // 10 second window
    isSpamDetected: false,
    lastSpamDetectionTime: 0,
    spamCooldownMs: 30000, // 30 second cooldown after spam detection
    blockedSenders: new Set<string>()
  });

  // Enhanced queue management with priority and batching
  const queueManagementRef = useRef({
    maxQueueSize: 10, // Maximum messages in queue
    batchProcessingDelay: 2000, // Delay between processing batches
    priorityMessages: new Set<string>(), // High priority messages
    isProcessingBatch: false,
    lastBatchProcessTime: 0,
    queueOverflowCount: 0
  });

  // Recording session management
  const recordingSessionRef = useRef({
    maxRecordingDuration: 600000, // 10 minutes max recording (increased to prevent auto-stops)
    recordingStartTime: 0,
    recordingTimeoutId: null as ReturnType<typeof setTimeout> | null,
    forcedStopCount: 0,
    lastForcedStopTime: 0
  });

  // Sequential queue processing for batch operations
  const sequentialQueueRef = useRef({
    isProcessingSequentialMessages: false,
    totalMessagesInBatch: 0,
    processedMessagesInBatch: 0,
    shouldAutoRecordAfterBatch: false,
    batchStartTime: 0,
    batchTimeout: null as ReturnType<typeof setTimeout> | null
  });

  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set()); // Track new messages for animation

  // Helper function for comprehensive logging of playback state
  const logPlaybackState = (context: string) => {
    const queue = robustQueueRef.current;
    const coordinator = audioPlaybackCoordinatorRef.current;
    /*console.log(`[DEBUG][${context}] Playback State:`, {
      queueMessageIds: queue.messages.map(m => m._id),
      processedMessageIds: Array.from(queue.processedMessageIds),
      playedMessageIds: Array.from(playedMessageIdsRef.current),
      isProcessing: queue.isProcessing,
      processingMessageId: queue.processingMessageId,
      isPlayingMessage,
      currentlyPlaying: currentlyPlayingMessageIdRef.current,
      isRecording,
      isInRecordingQueue: autoRecordingStateRef.current.isInRecordingQueue,
      isWaitingForQueueGrant: autoRecordingStateRef.current.isWaitingForQueueGrant,
      totalMessages: messages.length,
      unreadMessages: messages.filter(m => !m.isRead && m.senderId !== user?.userId).length
    });*/
  };

  // Initialize animation values based on selected chat
  useEffect(() => {
    if (selectedChat) {
      // Chat is selected - position chat on screen and list off-screen
      listTranslateX.setValue(-SCREEN_WIDTH);
      listOpacity.setValue(0);
      translateX.setValue(0);
      opacity.setValue(1);
      scale.setValue(1);
      rotateY.setValue(0);
    } else {
      // No chat selected - position list on screen
      listTranslateX.setValue(0);
      listOpacity.setValue(1);
      translateX.setValue(0);
      opacity.setValue(1);
      scale.setValue(1);
      rotateY.setValue(0);
    }
  }, [selectedChat]);

  // Reset auto recorded flag when chat changes
  useEffect(() => {
    hasAutoRecordedRef.current = false;
    isProcessingRef.current = false;
    lastProcessedMessageRef.current = null; // Reset last processed message
    hasReceivedAndPlayedMessageRef.current = false; // Reset received message flag
    clearQueue(); // Clear the message queue and reset tracking
    
    // NEW: Reset enhanced auto-recording state
    autoRecordingStateRef.current = {
      hasAutoRecordedInThisChat: false,
      isWaitingForQueueCompletion: false,
      lastAutoRecordTime: 0,
      isAutoRecordingInProgress: false,
      autoRecordingTriggered: false,
      lastProcessingResetTime: 0,
      shouldTriggerAfterQueueComplete: false,
      isWaitingForPlaybackCompletion: false,
      skipToLastMessage: false, // NEW: Track when multilevel skip goes to last message
      isInRecordingQueue: false,
      queueJoinTimestamp: 0,
      queuePosition: 0,
      isWaitingForQueueGrant: false,
      lastQueueStateCheck: 0,
      preventMultipleAutoRecording: false,
      shouldStartAfterPlayback: false, // NEW: Track deferred recording start
      pendingAutoRecordingAfterReset: false,
      pendingAutoRecordingReason: null,
    };
    
    // NEW: Reset processing state
    processingStateRef.current = {
      isProcessing: false,
      lastProcessingStart: 0,
      processingMessageId: null,
      processingTimeout: null,
      lastProcessingResetTime: 0
    };
    
    // Clear debounce timers
    if (autoRecordDebounceRef.current) {
      clearTimeout(autoRecordDebounceRef.current);
      autoRecordDebounceRef.current = null;
    }
    socketMessageCooldownRef.current = false;
    lastSocketMessageTimeRef.current = 0;
    lastAutoRecordTimeRef.current = 0; // Reset auto-record cooldown timer
    
    // Reset spam detection for new chat (but keep recent message history for cross-chat spam detection)
    const spamDetection = messageSpamDetectionRef.current;
    spamDetection.isSpamDetected = false;
    spamDetection.lastSpamDetectionTime = 0;
    // Don't clear blockedSenders - keep them blocked across chats for better spam protection
    
    // Reset queue management state
    const queueMgmt = queueManagementRef.current;
    queueMgmt.isProcessingBatch = false;
    queueMgmt.lastBatchProcessTime = 0;
    queueMgmt.queueOverflowCount = 0;
    queueMgmt.priorityMessages.clear();
    
    // Reset sequential batch processing state
    const sequentialQueue = sequentialQueueRef.current;
    if (sequentialQueue.batchTimeout) {
      clearTimeout(sequentialQueue.batchTimeout);
      sequentialQueue.batchTimeout = null;
    }
    sequentialQueue.isProcessingSequentialMessages = false;
    sequentialQueue.totalMessagesInBatch = 0;
    sequentialQueue.processedMessagesInBatch = 0;
    sequentialQueue.batchStartTime = 0;
    sequentialQueue.shouldAutoRecordAfterBatch = false;
    
  }, [selectedChat?._id]);

  // Load played messages when chat changes
  useEffect(() => {
    const loadPlayedMessages = async () => {
      if (selectedChat?._id) {
        try {
          const storedPlayedMessages = await AsyncStorage.getItem(`played_messages_${selectedChat._id}`);
          if (storedPlayedMessages) {
            const messageIds = JSON.parse(storedPlayedMessages);
            playedMessageIdsRef.current = new Set(messageIds);
          }
          setIsStorageLoaded(true);
        } catch (error) {
          console.error('Error loading played messages:', error);
          setIsStorageLoaded(true);
        }
      }
    };
    setIsStorageLoaded(false);
    loadPlayedMessages();
  }, [selectedChat?._id]);

  const savePlayedMessages = async (messageId: string) => {
    if (selectedChat?._id) {
      try {
        playedMessageIdsRef.current.add(messageId);
        const messageIds = Array.from(playedMessageIdsRef.current);
        await AsyncStorage.setItem(
          `played_messages_${selectedChat._id}`,
          JSON.stringify(messageIds)
        );
      } catch (error) {
        console.error('Error saving played messages:', error);
      }
    }
  };

  useEffect(() => {
    if (user && user.userId) {
      fetchGroupChats(user.userId);
    }
  }, [user]);

  const getPermission = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant permission to use the microphone');
      }
      return status === 'granted';
    } catch (error) {
      console.error('Error requesting microphone permission:', error);
      return false;
    }
  };

  useEffect(() => {
    getPermission();
    return () => {
      if (currentSound) {
        currentSound.unloadAsync();
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      // Cleanup audio resources
      if (currentSound) {
        currentSound.unloadAsync();
      }
      // Clear all cached signed URLs
      setSignedUrls({});
    };
  }, [currentSound, selectedChat?._id]);

  useEffect(() => {
    setHasAutoPlayed(false);
    setPlayedMessageIds(new Set());
    if (currentSound) {
      currentSound.unloadAsync();
    }
    setCurrentSound(null);
    setIsPlaying(null);
    setCurrentMessageId(null);
  }, [selectedChat]);

  const handleNetworkError = (error: any, message: string) => {
    console.error(message, error);
    Alert.alert(
      'Network Error',
      'Please check your internet connection and try again.',
      [{ text: 'OK' }]
    );
  };

  const createGroupChat = async (name: string, memberEmails: string[]) => {
   /* console.log('[CreateGroupChat] Starting group chat creation:', {
      name,
      memberUsernames,
      currentUserId: user?.userId,
      currentUserName: user?.name,
      timestamp: new Date().toISOString()
    });*/

    if (!user || !user.userId) {
      console.error('[CreateGroupChat] Missing user data:', {
        hasUser: !!user,
        hasUserId: !!user?.userId
      });
      return;
    }

    try {
      //console.log('[CreateGroupChat] Step 1: Converting usernames to user IDs');
      
      // Convert emails to user IDs
      const memberIds: string[] = [];
      for (const email of memberEmails) {
        if (email === user.email) {
          // Skip creator, they'll be added automatically
         // console.log('[CreateGroupChat] Skipping creator email:', email);
          continue;
        }
        
        try {
         // console.log('[CreateGroupChat] Looking up user ID for email:', email);
          const userResponse = await fetch(`${API_URL}/users?email=${encodeURIComponent(email)}`);
          
          if (!userResponse.ok) {
            console.error('[CreateGroupChat] Failed to lookup user:', email);
            continue;
          }
          
          const users = await userResponse.json();
          if (users.length > 0) {
            const userId = users[0].userId; // Use userId field, not _id
           // console.log('[CreateGroupChat] Found user ID:', { email, userId });
            memberIds.push(userId);
          } else {
            console.error('[CreateGroupChat] User not found:', email);
          }
        } catch (error) {
          console.error('[CreateGroupChat] Error looking up user:', { email, error });
        }
      }

      /*console.log('[CreateGroupChat] Converted usernames to user IDs:', {
        originalUsernames: memberUsernames,
        convertedUserIds: memberIds,
        count: memberIds.length
      });


      */
      // 1. Create the group chat with the creator as the only member
      const createRequest = {
        name,
        createdBy: user.userId
      };

      //console.log('[CreateGroupChat] Create group request:', createRequest);

      const token = await AsyncStorage.getItem('accessToken');
      if (!token) {
        Alert.alert('Error', 'Authentication token not found. Please log in again.');
        return;
      }
      
      const response = await fetch(`${API_URL}/groupchats`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(createRequest),
      });

      /*console.log('[CreateGroupChat] Create group response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });*/

      if (!response.ok) {
        const error = await response.json();
        console.error('[CreateGroupChat] Create group failed:', error);
        throw new Error(error.error || 'Failed to create group chat');
      }

      const group = await response.json();
      /*console.log('[CreateGroupChat] Group created successfully:', {
        groupId: group._id,
        groupName: group.name,
        initialMembers: group.members,
        memberCount: group.members.length
      });*/

      // Filter out the creator from memberIds to avoid duplicates
      const membersToAdd = memberIds.filter(id => id !== user.userId);
      /*console.log('[CreateGroupChat] ⚡ OPTIMIZED: Preparing batch member addition:', {
        originalMemberIds: memberIds,
        creatorId: user.userId,
        membersToAdd,
        count: membersToAdd.length
      });*/

      // OPTIMIZATION: Use new batch endpoint for fast member addition
      if (membersToAdd.length > 0) {
        //console.log('[CreateGroupChat] ⚡ Adding all members in single batch request...');
        
        const batchAddRequest = {
          memberIds: membersToAdd
        };

        //console.log('[CreateGroupChat] ⚡ Batch add request:', batchAddRequest);

        const token = await AsyncStorage.getItem('accessToken');
        if (!token) {
          Alert.alert('Error', 'Authentication token not found. Please log in again.');
          return;
        }
        
        const batchResponse = await fetch(`${API_URL}/groupchats/${group._id}/members/batch`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(batchAddRequest),
        });

        /*console.log('[CreateGroupChat] ⚡ Batch add response:', {
          status: batchResponse.status,
          statusText: batchResponse.statusText,
          ok: batchResponse.ok
        });*/

        if (batchResponse.ok) {
          const batchResult = await batchResponse.json();
          /*console.log('[CreateGroupChat] ⚡ FAST batch addition completed:', {
            addedCount: batchResult.addedCount,
            finalMemberCount: batchResult.finalMemberCount,
            addedMembers: batchResult.addedMembers?.map((m: any) => m.name) || [],
            allUsersAlreadyMembers: batchResult.allUsersAlreadyMembers
          });*/

          // Handle case where all users were already members
          if (batchResult.allUsersAlreadyMembers) {
            //console.log('[CreateGroupChat] ⚡ All users were already members - no additional work needed');
          }
        } else {
          let errorData;
          try {
            errorData = await batchResponse.json();
          } catch (jsonError) {
            console.error('[CreateGroupChat] ⚡ Failed to parse batch error response as JSON:', jsonError);
            errorData = { error: `HTTP ${batchResponse.status}: ${batchResponse.statusText}` };
          }
          console.warn('[CreateGroupChat] ⚡ Batch addition failed, falling back to individual requests:', errorData);
          
          // Fallback to individual requests if batch fails
          for (const memberId of membersToAdd) {
            try {
              const addMemberRequest = { memberIds: [memberId] };
              const addMemberResponse = await fetch(`${API_URL}/groupchats/${group._id}/members`, {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(addMemberRequest),
              });
              
              if (!addMemberResponse.ok) {
                console.warn('[CreateGroupChat] Failed to add member in fallback:', memberId);
              }
            } catch (fallbackError) {
              console.warn('[CreateGroupChat] Fallback member addition error:', fallbackError);
            }
          }
        }
      } else {
       //console.log('[CreateGroupChat] ⚡ No additional members to add - group creation complete');
      }

      //console.log('[CreateGroupChat] All members processed, refreshing group chats');
      setNewGroupName('');
      setModalVisible(false);
      await fetchGroupChats(user.userId);
      
      //console.log('[CreateGroupChat] Group chat creation completed successfully');
      Alert.alert('Success', 'Group chat created successfully');
    } catch (error: any) {
      console.error('[CreateGroupChat] Error in group chat creation:', {
        error: error.message,
        stack: error.stack,
        type: error.constructor.name,
        name,
        memberEmails
      });
      handleNetworkError(error, 'Error creating group chat:');
    }
  };

  const deleteGroupChat = async (groupId: string) => {
    if (!user || !user.userId) return;
    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (!token) {
        Alert.alert('Error', 'Authentication token not found. Please log in again.');
        return;
      }
      
      const response = await fetch(`${API_URL}/groupchats/${groupId}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          requesterId: user.userId
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete group chat');
      }
      await fetchGroupChats(user.userId);
      Alert.alert('Success', 'Group chat deleted successfully');
      if (selectedChat && selectedChat._id === groupId) {
        setSelectedChat(null);
        setMessages([]);
      }
    } catch (error) {
      handleNetworkError(error, 'Error deleting group chat:');
    }
  };

  const fetchSingleGroupChat = async (groupId: string) => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (!token) {
        console.error('No authentication token found');
        return null;
      }
      
      const response = await fetch(`${API_URL}/groupchats/${groupId}`, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
      });
      if (!response.ok) throw new Error('Failed to fetch group chat');
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching single group chat:', error);
      return null;
    }
  };

  const addMemberToGroup = async (username: string, userToAdd?: SearchUser) => {
    /*console.log('[AddMember][AddMemberToGroup] Starting member addition process:', {
      username,
      selectedChatId: selectedChat?._id,
      selectedChatName: selectedChat?.name,
      currentUserId: user?.userId,
      selectedUser: selectedUser ? {
        _id: selectedUser._id,
        name: selectedUser.name,
        email: selectedUser.email
      } : null,
      userToAdd: userToAdd ? {
        _id: userToAdd._id,
        name: userToAdd.name,
        email: userToAdd.email
      } : null,
      timestamp: new Date().toISOString()
    });*/

    // Use the passed userToAdd parameter if available, otherwise fall back to selectedUser state
    const targetUser = userToAdd || selectedUser;

    if (!selectedChat || !user?.userId || !targetUser) {
      console.error('[AddMember][AddMemberToGroup] Missing required data:', {
        hasSelectedChat: !!selectedChat,
        hasUserId: !!user?.userId,
        hasSelectedUser: !!selectedUser,
        hasUserToAdd: !!userToAdd,
        hasTargetUser: !!targetUser
      });
      Alert.alert('Error', 'Missing required data');
      return;
    }

    // Validate that targetUser._id is a valid MongoDB ObjectId
    if (!targetUser._id || typeof targetUser._id !== 'string' || targetUser._id.length !== 24) {
      console.error('[AddMember][AddMemberToGroup] Invalid user ID format:', {
        userId: targetUser._id,
        type: typeof targetUser._id,
        length: targetUser._id?.length
      });
      Alert.alert('Error', 'Invalid user ID format');
      return;
    }

    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (!token) {
        Alert.alert('Error', 'Authentication token not found. Please log in again.');
        return;
      }
      
      const requestUrl = `${API_URL}/groupchats/${selectedChat._id}/members`;
      const requestBody = {
        memberIds: [targetUser._id]
      };

      /*console.log('[AddMember][AddMemberToGroup] Making API request:', {
        url: requestUrl,
        method: 'POST',
        body: requestBody,
        targetUser: {
          _id: targetUser._id,
          name: targetUser.name,
          email: targetUser.email
        },
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer [REDACTED]'
        }
      });*/

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody),
      });

      /*console.log('[AddMember][AddMemberToGroup] Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });*/

      // Handle 401 error with token refresh
      if (response.status === 401) {
        try {
          await refreshAccessToken();
          const newToken = await AsyncStorage.getItem('accessToken');
          if (!newToken) {
            Alert.alert('Authentication Error', 'Please log in again');
            router.replace('/login');
            return;
          }
          
          const retryResponse = await fetch(requestUrl, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${newToken}`
            },
            body: JSON.stringify(requestBody),
          });
          
          if (!retryResponse.ok) {
            const errorData = await retryResponse.json();
            console.error('[AddMember][AddMemberToGroup] Retry API error response:', errorData);
            throw new Error(errorData.error || 'Failed to add member to group');
          }
          
          const responseData = await retryResponse.json();
          
          // Handle case where user was already a member
          if (responseData.alreadyMember) {
            Alert.alert('Info', `${targetUser.name} is already a member of this group`);
            setSearchUserName('');
            setAddMemberModalVisible(false);
            return;
          }
          
          // Continue with success flow
          const newMember = {
            userId: targetUser._id,
            name: targetUser.name,
            joinedAt: new Date().toISOString()
          };
          
          setSelectedChat(prev => {
            if (!prev) return prev;
            const memberExists = prev.members.some(m => m.userId === targetUser._id);
            if (!memberExists) {
              return {
                ...prev,
                members: [...prev.members, newMember]
              };
            }
            return prev;
          });
          
          setGroupChats(prevChats => 
            prevChats.map(chat => {
              if (chat._id === selectedChat._id) {
                const memberExists = chat.members.some(m => m.userId === targetUser._id);
                if (!memberExists) {
                  return {
                    ...chat,
                    members: [...chat.members, newMember]
                  };
                }
              }
              return chat;
            })
          );
          
          setSearchUserName('');
          setAddMemberModalVisible(false);
          Alert.alert('Success', `${username} has been added to the group`);
          return;
          
        } catch (refreshError) {
          console.error('[AddMember][AddMemberToGroup] Token refresh failed:', refreshError);
          Alert.alert('Authentication Error', 'Please log in again');
          router.replace('/login');
          return;
        }
      }
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('[AddMember][AddMemberToGroup] API error response:', errorData);
        throw new Error(errorData.error || 'Failed to add member to group');
      }

      const responseData = await response.json();
      //console.log('[AddMember][AddMemberToGroup] Success response:', responseData);

      // Handle case where user was already a member
      if (responseData.alreadyMember) {
  
        Alert.alert('Info', `${targetUser.name} is already a member of this group`);
        setSearchUserName('');
        setAddMemberModalVisible(false);
        return;
      }

      //console.log('[AddMember][AddMemberToGroup] Applying optimistic update...');
      
      // Optimistic update: Add the member immediately to the UI
      const newMember = {
        userId: targetUser._id,
        name: targetUser.name,
        joinedAt: new Date().toISOString()
      };
      
      setSelectedChat(prev => {
        if (!prev) return prev;
        // Check if member already exists to avoid duplicates
        const memberExists = prev.members.some(m => m.userId === targetUser._id);
        if (!memberExists) {
          return {
            ...prev,
            members: [...prev.members, newMember]
          };
        }
        return prev;
      });
      
      // Also update group chats list
      setGroupChats(prevChats => 
        prevChats.map(chat => {
          if (chat._id === selectedChat._id) {
            const memberExists = chat.members.some(m => m.userId === targetUser._id);
            if (!memberExists) {
              return {
                ...chat,
                members: [...chat.members, newMember]
              };
            }
          }
          return chat;
        })
      );
      
      //console.log('[AddMember][AddMemberToGroup] Optimistic update applied - member will be confirmed by socket event');

      //console.log('[AddMember][AddMemberToGroup] Cleaning up UI state...');
      setSearchUserName('');
      setAddMemberModalVisible(false);
      
      //console.log('[AddMember][AddMemberToGroup] Member addition completed successfully');
      Alert.alert('Success', `${username} has been added to the group`);
    } catch (error: any) {
      console.error('[AddMember][AddMemberToGroup] Error in member addition process:', {
        error: error.message,
        stack: error.stack,
        type: error.constructor.name,
        username,
        selectedChatId: selectedChat?._id
      });
      Alert.alert('Error', error.message || 'Failed to add member to group');
    }
  };

  const removeMemberFromGroup = async (userId: string) => {
    if (!selectedChat || !user?.userId) return;

    try {
      const memberToRemove = selectedChat.members.find(m => m.userId === userId);
      if (!memberToRemove) return;

      //console.log('[Frontend][RemoveMember] ⚡ FAST removal for:', memberToRemove.name);
      
      // OPTIMIZATION: Optimistic update - remove member immediately from UI
      setSelectedChat(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          members: prev.members.filter(member => member.userId !== userId)
        };
      });
      
      // Also update group chats list instantly
      setGroupChats(prevChats => 
        prevChats.map(chat => {
          if (chat._id === selectedChat._id) {
            return {
              ...chat,
              members: chat.members.filter(member => member.userId !== userId)
            };
          }
          return chat;
        })
      );
      
      // Make API call in background without waiting
      const token = await AsyncStorage.getItem('accessToken');
      const requestUrl = `${API_URL}/groupchats/${selectedChat._id}/members/${userId}`;
      
      fetch(requestUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requesterId: user.userId })
      }).then(response => {
        if (!response.ok) {
          console.error('[Frontend][RemoveMember] API failed, reverting optimistic update');
          // Revert optimistic update on error
          setSelectedChat(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              members: [...prev.members, memberToRemove]
            };
          });
          
          setGroupChats(prevChats => 
            prevChats.map(chat => {
              if (chat._id === selectedChat._id) {
                return {
                  ...chat,
                  members: [...chat.members, memberToRemove]
                };
              }
              return chat;
            })
          );
          
          Alert.alert('Error', 'Failed to remove member');
        } else {
          //console.log('[Frontend][RemoveMember] ⚡ Server confirmed removal');
        }
      }).catch(error => {
        console.error('[Frontend][RemoveMember] Network error:', error);
        // Revert on network error
        setSelectedChat(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            members: [...prev.members, memberToRemove]
          };
        });
      });

      //console.log('[Frontend][RemoveMember] ⚡ Instant UI update completed');
      
    } catch (error: any) {
      console.error('[Frontend][RemoveMember] Error:', error);
      Alert.alert('Error', 'Failed to remove member from group');
    }
  };

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || !selectedChat || !user) return;

    const tempId = `temp_${Date.now()}`;
    const tempMessage: Message = {
      _id: tempId,
      content: messageText,
      senderId: user.userId,
      groupChatId: selectedChat._id,
      timestamp: new Date().toISOString(),
      type: 'text',
      isRead: false,
      isDelivered: true,
      readBy: { [user.userId]: new Date().toISOString() },
      deliveredTo: [user.userId]
    };

    setMessages((prev: Message[]) => [tempMessage, ...prev]);
    setNewMessage('');

    try {
      const token = await AsyncStorage.getItem('accessToken');
      let response = await fetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          text: messageText,
          senderId: user.userId,
          groupChatId: selectedChat._id,
          type: 'text'
        }),
      });

      // Handle 401 error with token refresh
      if (response.status === 401) {
        //console.log('[sendMessage] 401 received, attempting token refresh...');
        try {
          await refreshAccessToken();
          const newToken = await AsyncStorage.getItem('accessToken');
          response = await fetch(`${API_URL}/messages`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${newToken}`
            },
            body: JSON.stringify({
              text: messageText,
              senderId: user.userId,
              groupChatId: selectedChat._id,
              type: 'text'
            }),
          });
        } catch (refreshError) {
          console.error('[sendMessage] Token refresh failed:', refreshError);
          Alert.alert('Authentication Error', 'Please log in again');
          router.replace('/login');
          return;
        }
      }

      if (response.ok) {
        // OPTIMIZATION: Don't call fetchMessages - rely on socket events for immediate updates
        //console.log('[sendMessage] Message sent successfully, waiting for socket confirmation');
      } else {
        const error = await response.json();
        Alert.alert('Error', error.error || 'Failed to send message');
        setMessages((prev: Message[]) => prev.filter(msg => msg._id !== tempId));
        // OPTIMIZATION: Restore input text on error
        setNewMessage(messageText);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message');
      setMessages((prev: Message[]) => prev.filter(msg => msg._id !== tempId));
      // OPTIMIZATION: Restore input text on error
      setNewMessage(messageText);
    }
  };

  const startRecording = async () => {
    try {
      // CRITICAL FIX: Global recording lock to prevent multiple simultaneous starts
      if (isStartingRecordingRef.current) {
        console.log('[START RECORDING] 🚫 Already starting recording, ignoring duplicate request');
        return;
      }

      if (recordingLockRef.current) {
        console.log('[START RECORDING] 🚫 Recording locked, ignoring request');
        return;
      }

      // Check if already recording
      if (isRecording) {
        console.log('[START RECORDING] 🚫 Already recording, ignoring request');
        return;
      }

      // ENHANCED FIX: Add aggressive duplicate call prevention
      const now = Date.now();
      const timeSinceLastCall = now - lastStartRecordingCallRef.current;
      if (timeSinceLastCall < 100) { // Prevent calls within 100ms of each other
        console.log('[START RECORDING] 🚫 Preventing rapid duplicate call (last call was', timeSinceLastCall, 'ms ago)');
        return;
      }
      lastStartRecordingCallRef.current = now;

      // Set locks immediately
      isStartingRecordingRef.current = true;
      recordingLockRef.current = true;
      
      console.log('[START RECORDING] 🔒 Recording locks set, proceeding with start');

      // SIMPLIFIED: Check if anyone else is recording BEFORE starting local recording
      if (selectedChat && getRecordingUsers) {
        const recordingUsers = getRecordingUsers(selectedChat._id) || [];
        const currentUserId = user?.userId;
        const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
        
        if (otherRecordingUsers.length > 0) {
          isStartingRecordingRef.current = false;
          recordingLockRef.current = false;
          return;
        }
      }

      // SIMPLIFIED: Check if any playback is active and stop it
      const isAnyPlaybackActive = (
        isPlayingMessage || 
        currentlyPlayingMessageIdRef.current !== null || 
        isProcessingRef.current ||
        currentSound !== null ||
        isPlaying !== null
      );

      // FIXED: Allow auto-recording to start without stopping playback
      if (isAnyPlaybackActive) {
        // Check if this is an auto-recording request
        const isAutoRecordingRequest = autoRecordingStateRef.current.isAutoRecordingInProgress || 
                                      autoRecordingStateRef.current.autoRecordingTriggered ||
                                      autoRecordingStateRef.current.isWaitingForQueueGrant;
        
        if (isAutoRecordingRequest) {
          // For auto-recording: Allow recording to start without stopping playback
          console.log('[START RECORDING] 🎙️ Auto-recording starting without stopping playback');
          // Don't stop playback - let it continue
        } else {
          // For manual recording: Stop playback as before
          if (currentSound) {
            try {
              await currentSound.unloadAsync();
              setCurrentSound(null);
            } catch (error) {
              // Error stopping sound - continue anyway
            }
          }
          
          // Reset playback states
          setIsPlaying(null);
          setCurrentMessageId(null);
          setIsPlayingMessage(false);
          currentlyPlayingMessageIdRef.current = null;
          isProcessingRef.current = false;
        }
      }

      // SIMPLIFIED: Emit recording start event to server BEFORE starting local recording
      if (selectedChat && socket) {
        // Create a promise to wait for server response
        const recordingStartPromise = new Promise<boolean>((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve(false);
          }, 2000); // 2 second timeout
          
          // Listen for recording start rejection
          const handleRejection = (data: { groupId: string; reason: string; currentRecordingUsers: string[] }) => {
            if (data.groupId === selectedChat._id) {
              clearTimeout(timeoutId);
              socket.off('recording_rejected', handleRejection);
              resolve(false);
            }
          };
          
          // Listen for recording state update (confirmation)
          const handleStateUpdate = (data: { groupId: string; recordingUsers: string[]; isAnyoneRecording: boolean; startedBy?: string }) => {
            if (data.groupId === selectedChat._id && data.startedBy === user?.userId) {
              clearTimeout(timeoutId);
              socket.off('recording_state_update', handleStateUpdate);
              resolve(true);
            }
          };
          
          socket.on('recording_rejected', handleRejection);
          socket.on('recording_state_update', handleStateUpdate);
          
          // FIXED: Intelligent debounce that only blocks rapid duplicate requests, not legitimate ones
          const now = Date.now();
          const timeSinceLastEmit = now - lastRecordingStartEmitRef.current;

          // Only block if it's been less than 200ms (very rapid) AND we're not in a legitimate recording scenario
          const shouldDebounce = timeSinceLastEmit < 200 && !(
            // Allow if this is an auto-recording request
            autoRecordingStateRef.current.isAutoRecordingInProgress || 
            autoRecordingStateRef.current.autoRecordingTriggered ||
            autoRecordingStateRef.current.isWaitingForQueueGrant ||
            // Allow if enough time has passed since last attempt (500ms)
            timeSinceLastEmit > 500
          );

          if (shouldDebounce) {
            console.log('[START RECORDING] 🚫 Debouncing recording start emit (too rapid)');
            clearTimeout(timeoutId);
            socket.off('recording_rejected', handleRejection);
            socket.off('recording_state_update', handleStateUpdate);
            resolve(false);
            return;
          }
          lastRecordingStartEmitRef.current = now;
          
          // Emit the recording start event
          socket.emit('recording_start', { groupId: selectedChat._id });
        });
        
        // Wait for server response
        const serverAccepted = await recordingStartPromise;
        if (!serverAccepted) {
          isStartingRecordingRef.current = false;
          recordingLockRef.current = false;
          return;
        }
      }
      
      // OPTIMIZATION: Update UI state immediately for instant response
      console.log('[START RECORDING] 🎙️ Starting recording session:', {
        userId: user?.userId,
        chatId: selectedChat?._id,
        timestamp: Date.now()
      });
      setIsRecording(true);
      setRecordingStartTime(Date.now());
      setRecordingDuration(0);
      
      // Request permissions
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        // Reset state if permission denied
        setIsRecording(false);
        setRecordingStartTime(0);
        setRecordingDuration(0);
        isStartingRecordingRef.current = false;
        recordingLockRef.current = false;
        return;
      }

      // Configure audio mode for optimal recording and playback volume on iOS
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false, // Don't duck other audio for maximum volume
        playThroughEarpieceAndroid: false,
      });

      // CRITICAL FIX: Clean up any existing recording first
      if (currentRecording) {
        try {
          await currentRecording.stopAndUnloadAsync();
        } catch (error) {
          // Error cleaning up existing recording - continue anyway
        }
        setCurrentRecording(null);
      }

      // Small delay to ensure cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 1));

      // Create new recording
      const newRecording = new Audio.Recording();
      
      try {
        await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await newRecording.startAsync();
      } catch (prepareError) {
        // If preparation fails, clean up and retry once
        try {
          await newRecording.stopAndUnloadAsync();
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        
        // Don't retry automatically - just fail silently to prevent loops
        setIsRecording(false);
        setRecordingStartTime(0);
        setRecordingDuration(0);
        isStartingRecordingRef.current = false;
        recordingLockRef.current = false;
        return;
      }
      
      // Set recording state
      setCurrentRecording(newRecording);
      
      // FIXED: Clear locks only after recording is successfully started
      console.log('[START RECORDING] ✅ Recording successfully started, clearing locks');
      isStartingRecordingRef.current = false;
      recordingLockRef.current = false;
      newRecording.setOnRecordingStatusUpdate(onRecordingStatusUpdate);
      
    } catch (error) {
      // Clear waiting flag on error
      autoRecordingStateRef.current.isWaitingForPlaybackCompletion = false;
      setRecordingStartTime(0);
      setRecordingDuration(0);
      
      // Reset state on error
      // FIXED: Clear locks only on definitive failure
      setIsRecording(false);
      setCurrentRecording(null);
      isStartingRecordingRef.current = false;
      recordingLockRef.current = false;
    }
  };

  const stopRecording = async () => {
    if (!currentRecording) {
      return;
    }

    try {
      // OPTIMIZATION: Update UI state immediately for instant response
      setIsTranscribing(true);
      setIsRecording(false);
      setRecordingDuration(0);
      setRecordingStartTime(0);

      await currentRecording.stopAndUnloadAsync();
      const uri = currentRecording.getURI();
      if (!uri) {
        throw new Error('No recording URI available');
      }

      // CRITICAL iOS FIX: Reset audio mode for optimal playback volume after recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false, // Optimize for playback, not recording
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
      
      // CRITICAL: Set lastAutoRecordTime immediately to prevent auto-recording after stopping
      const autoState = autoRecordingStateRef.current;
      autoState.lastAutoRecordTime = Date.now();
      autoState.isAutoRecordingInProgress = false;
      autoState.autoRecordingTriggered = false;
      autoState.isInRecordingQueue = false;
      autoState.isWaitingForQueueGrant = false;
      
      // ENHANCED: Use proper cooldown duration based on chat type
      const is2PersonChat = selectedChat && selectedChat.members && selectedChat.members.length === 2;
      const cooldownDuration = is2PersonChat ? 20000 : 10000; // 20 seconds for 2-person chats, 10 seconds for others
      
      // FastTranscriptionOptimizer will handle message creation and transcription
      if (selectedChat && user) {
        const fastOptimizer = FastTranscriptionOptimizer.getInstance();
        // This call is intentionally not awaited. The optimizer will process
        // in the background. The UI is already updated, and the optimizer's
        // internal lock prevents race conditions.
        fastOptimizer.fastTranscribe(uri, user.userId, selectedChat._id);

        // The result of the transcription will update the UI via socket events.
        // The setTimeout for fetchMessages has been removed as it's an unreliable pattern.
      } else {
        console.error('Missing selectedChat or user');
      }

      // CRITICAL FIX: Emit recording stop event AFTER message creation starts
      // This ensures the message is being processed before the server grants recording to the next user
      if (selectedChat && socket) {
        // Add a small delay to ensure the message creation process has started
        setTimeout(() => {
          socket.emit('recording_stop', { groupId: selectedChat._id });
        }, 25); // Reduced from 100ms to 25ms for faster recording stop
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Error', 'Failed to process recording');
    } finally {
      // CRITICAL FIX: Clear recording state immediately.
      setCurrentRecording(null);
      setIsTranscribing(false);
    }
  };

  const checkMessageProcessingStatus = async (messageId: string): Promise<{ isProcessing: boolean; status?: string }> => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      let response = await fetch(`${API_URL}/messages/${messageId}/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      // Handle 401 error with token refresh
      if (response.status === 401) {
        console.log('[checkMessageProcessingStatus] 401 received, attempting token refresh...');
        try {
          await refreshAccessToken();
          const newToken = await AsyncStorage.getItem('accessToken');
          response = await fetch(`${API_URL}/messages/${messageId}/status`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${newToken}`,
              'Content-Type': 'application/json',
            },
          });
        } catch (refreshError) {
          console.error('[checkMessageProcessingStatus] Token refresh failed:', refreshError);
          Alert.alert('Authentication Error', 'Please log in again');
          router.replace('/login');
          return { isProcessing: true, status: 'error' };
        }
      }

      if (response.ok) {
        const data = await response.json();
        return {
          isProcessing: data.processingStatus === 'processing',
          status: data.processingStatus
        };
      } else {
        // If status endpoint doesn't exist, assume it's still processing
        return { isProcessing: true, status: 'unknown' };
      }
    } catch (error) {
      return { isProcessing: true, status: 'error' };
    }
  };

  const waitForAudioUrlReady = async (messageId: string, maxAttempts: number = 10, delayMs: number = 500, message?: Message): Promise<string> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const signedUrl = await getAudioUrl(messageId, message);
        return signedUrl;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // For real-time messages, use much shorter delays
        if (attempt < maxAttempts) {
          const actualDelay = delayMs < 100 ? 50 : delayMs; // Minimum 50ms delay
          await new Promise(resolve => setTimeout(resolve, actualDelay));
        }
      }
    }
    
    throw new Error(`Audio URL not ready after ${maxAttempts} attempts for message: ${messageId}`);
  };

  const validateAudioUrl = (url: string): boolean => {
    if (!url || typeof url !== 'string') return false;
    if (url.trim() === '') return false;
    if (url === 'null' || url === 'undefined') return false;
    
    // Check if it's a valid URL format (basic check)
    try {
      new URL(url);
      return true;
    } catch {
      // If it's not a valid URL, it might be a file path or S3 path, which is okay
      return url.includes('/') || url.includes('://');
    }
  };

  const getAudioUrl = async (messageId: string, message?: Message): Promise<string> => {
    try {
      // Use provided message object if available, otherwise find it in state
      let messageToUse = message || messages.find(m => m._id === messageId);

      // FIXED: If message not found in current messages, check the robust queue
      if (!messageToUse) {
        const queue = robustQueueRef.current;
        messageToUse = queue.messages.find(m => m._id === messageId);
      }

      if (!messageToUse) {
        console.error('Message not found in messages or queue:', {
          messageId,
          currentMessagesCount: messages.length,
          currentMessageIds: messages.map(m => m._id).slice(-5), // Show last 5 for brevity
          queueMessagesCount: robustQueueRef.current.messages.length,
          queueMessageIds: robustQueueRef.current.messages.map(m => m._id)
        });
        
        // ENHANCED: Instead of throwing immediately, check if this might be a stale message ID
        // This prevents hard crashes when the FastPlaybackManager has outdated queue data
        const err = new Error(`Message ${messageId} not found in current messages or queue`);
        // @ts-ignore
        err.code = 'NO_AUDIO_URL_FOR_IMAGE_OR_VIDEO';
        throw err;
      }
      
      // NEW: Check if message is an image or video - these don't have audio URLs
      if (messageToUse.type === 'image' || messageToUse.type === 'video') {
        // Throw a specific error code
        const err = new Error('NO_AUDIO_URL_FOR_IMAGE_OR_VIDEO');
        // @ts-ignore
        err.code = 'NO_AUDIO_URL_FOR_IMAGE_OR_VIDEO';
        throw err;
      }
      
      if (!messageToUse.audioUrl) {
        throw new Error(`Message ${messageId} does not have an audioUrl yet`);
      }

      // Validate that the audioUrl is not just a placeholder or empty
      if (!validateAudioUrl(messageToUse.audioUrl)) {
        throw new Error(`Message ${messageId} has invalid audioUrl: ${messageToUse.audioUrl}`);
      }

      const token = await AsyncStorage.getItem('accessToken');
      let response = await fetch(`${API_URL}/messages/${messageId}/audio-url`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      // Handle 401 error with token refresh
      if (response.status === 401) {
        console.log('[getAudioUrl] 401 received, attempting token refresh...');
        try {
          await refreshAccessToken();
          const newToken = await AsyncStorage.getItem('accessToken');
          response = await fetch(`${API_URL}/messages/${messageId}/audio-url`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${newToken}`,
              'Content-Type': 'application/json',
            },
          });
        } catch (refreshError) {
          console.error('[getAudioUrl] Token refresh failed:', refreshError);
          Alert.alert('Authentication Error', 'Please log in again');
          router.replace('/login');
          throw new Error('Authentication failed');
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Server error response:', {
          status: response.status,
          statusText: response.statusText,
          errorText,
          url: `${API_URL}/messages/${messageId}/audio-url`
        });
        
        if (response.status === 404) {
          throw new Error(`Audio file not found for message ${messageId}. The message may still be processing.`);
        }
        
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const signedUrl = data.url; // Server returns { url: signedUrl }
      
      if (!signedUrl) {
        throw new Error('No signed URL received from server');
      }

      // Validate the signed URL
      if (typeof signedUrl !== 'string' || signedUrl.trim() === '') {
        throw new Error('Invalid signed URL received from server');
      }
      
      return signedUrl;
    } catch (error) {
      console.error('Error getting signed URL:', error);
      throw error;
    }
  };

  const onPlaybackStatusUpdate = async (status: any) => {
    if (!status.isLoaded) return;

    const currentMessageId = currentlyPlayingMessageIdRef.current;
    if (!currentMessageId) return;

    // Update playback position
    if (status.positionMillis !== undefined) {
      setPlaybackPosition(prev => ({ ...prev, [currentMessageId]: status.positionMillis }));
    }

    // Update playback duration
    if (status.durationMillis !== undefined) {
      setPlaybackDuration(prev => ({ ...prev, [currentMessageId]: status.durationMillis }));
    }

          // Handle playback completion
      if (status.didJustFinish) {
        console.log('[PLAYBACK COMPLETE] 🎵 Message finished playing:', currentMessageId, {
          hasReceivedAndPlayedMessage: hasReceivedAndPlayedMessageRef.current,
          isWaitingForQueueCompletion: true,
        queueLength: robustQueueRef.current.messages.length,
        robustQueueLength: robustQueueRef.current.messages.length
      });

      // Save to played messages
      playedMessageIdsRef.current.add(currentMessageId);
      setPlayedMessageIds(new Set(playedMessageIdsRef.current));
      await savePlayedMessages(currentMessageId);

      // Mark as viewed for real-time read receipts
      const currentMessage = messages.find(m => m._id === currentMessageId);
      if (currentMessage && !currentMessage.isRead && currentMessage.senderId !== user?.userId) {
        try {
          await markMessageAsViewed(currentMessage);
          console.log('[PLAYBACK COMPLETE] ✅ Marked message as viewed after playback:', currentMessageId);
        } catch (error) {
          console.error('[PLAYBACK COMPLETE] ❌ Error marking message as viewed:', error);
        }
      }

      // Mark as read for backend
      if (currentMessage && !currentMessage.isRead && currentMessage.senderId !== user?.userId) {
        try {
          await markMessageAsRead(currentMessage);
          console.log('[PLAYBACK COMPLETE] ✅ Marked message as read after playback:', currentMessageId);
        } catch (error) {
          console.error('[PLAYBACK COMPLETE] ❌ Error marking message as read:', error);
        }
      }

      // CRITICAL FIX: Remove the completed message from the queue
      const queue = robustQueueRef.current;
      if (queue.messages.length > 0 && queue.messages[0]._id === currentMessageId) {
        const completedMessage = queue.messages.shift();
        console.log('[PLAYBACK COMPLETE] 🗑️ Removed completed message from queue:', completedMessage?._id);
        
        // Mark as processed to prevent re-queueing
        queue.processedMessageIds.add(completedMessage!._id);
      }
      
      // Reset playback states
      setIsPlaying(null);
      setCurrentMessageId(null);
      setIsPlayingMessage(false);
      currentlyPlayingMessageIdRef.current = null;
      isProcessingRef.current = false;
      processingStateRef.current.isProcessing = false;
      processingStateRef.current.processingMessageId = null;
      
      // CRITICAL FIX: Clean up processed messages and check queue completion
      cleanupProcessedMessages();
      
      console.log('[PLAYBACK COMPLETE] ⏭️ Triggering next message processing');
      
      // Process next message in queue
      if (queue.messages.length > 0) {
        console.log('[PLAYBACK COMPLETE] 🚀 Processing next message in queue immediately');
        // Add a small delay to ensure all states are properly reset
        setTimeout(() => {
          processRobustQueue();
        }, 50);
      } else {
        console.log('[PLAYBACK COMPLETE] 🎯 Queue will be empty after processing, checking if auto-record should trigger');
        // FIXED: Check cooldown before triggering auto-recording after playback
        const autoState = autoRecordingStateRef.current;
        const now = Date.now();
        const timeSinceLastRecording = autoState.lastAutoRecordTime > 0 ? now - autoState.lastAutoRecordTime : Infinity;
        
        if (timeSinceLastRecording < 1000) { // Reduced from 5000ms to 1000ms for faster blocking
          console.log('[PLAYBACK COMPLETE] ❌ BLOCKING auto-record after playback - recording just finished', {
            timeSinceLastRecording,
            cooldownRemaining: 1000 - timeSinceLastRecording // Updated cooldown calculation
          });
        } else {
                // REQUIREMENT 2: Queue will be empty, trigger auto-recording after playback
      // CRITICAL FIX: For 3+ person chats, let the queue system handle recording transitions
      const is3PlusPersonChat = selectedChat && selectedChat.members && selectedChat.members.length > 2;
      
      if (is3PlusPersonChat) {
        console.log('[PLAYBACK COMPLETE] 👥 3+ person chat - letting queue system handle recording transitions');
        // Don't trigger auto-recording here for 3+ person chats
        // The queue system will handle the transition after playback
        return;
      }
      
      setTimeout(() => {
        // CRITICAL FIX: Don't trigger auto-recording if currently recording
        if (isRecording) {
          console.log('[PLAYBACK COMPLETE] ❌ User is recording, skipping auto-recording trigger');
          return;
        }
        
        // FOCUSED FIX: Double-check that ALL playback states are cleared before auto-recording
        const isAnyPlaybackStillActive = (
          isPlayingMessage || 
          isProcessingRef.current || 
          processingStateRef.current.isProcessing ||
          robustQueueRef.current.isProcessing ||
          robustQueueRef.current.messages.length > 0 ||
          currentSound !== null ||
          isPlaying !== null ||
          currentlyPlayingMessageIdRef.current !== null
        );
        
        if (isAnyPlaybackStillActive) {
          console.log('[PLAYBACK COMPLETE] ❌ Playback states not fully cleared yet, skipping auto-recording trigger', {
            isPlayingMessage,
            isProcessing: isProcessingRef.current,
            processingStateIsProcessing: processingStateRef.current.isProcessing,
            robustQueueIsProcessing: robustQueueRef.current.isProcessing,
            robustQueueLength: robustQueueRef.current.messages.length,
            hasCurrentSound: currentSound !== null,
            isPlaying: isPlaying !== null,
            hasCurrentlyPlayingMessage: currentlyPlayingMessageIdRef.current !== null
          });
          return;
        }
        
        // NEW FIX: Check if someone is already recording before auto-recording
        if (selectedChat && getRecordingUsers) {
          const recordingUsers = getRecordingUsers(selectedChat._id) || [];
          const currentUserId = user?.userId;
          const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
          
          if (otherRecordingUsers.length > 0) {
            console.log('[PLAYBACK COMPLETE] ❌ Someone else is recording, skipping auto-recording:', {
              otherRecordingUsers,
              currentUserId
            });
            return;
          }
        }
        
        if (canAutoRecord('playback_ended')) {
          console.log('[PLAYBACK COMPLETE] 🎙️ Triggering auto-recording after playback completion');
          triggerAutoRecording('playback_ended');
        }
      }, 25);
        }
      }
      
      // FIXED: Check if this was a skipped message that was the last in queue
      if (autoRecordingStateRef.current.skipToLastMessage || autoRecordingStateRef.current.shouldTriggerAfterQueueComplete) {
        console.log('[PLAYBACK COMPLETE] 🎯 Skipped message finished playing - checking cooldown before auto-recording');
        autoRecordingStateRef.current.skipToLastMessage = false; // Clear the flag
        autoRecordingStateRef.current.shouldTriggerAfterQueueComplete = false; // Clear this flag too
        
        // FIXED: Check cooldown before triggering auto-recording
        const autoState = autoRecordingStateRef.current;
        const now = Date.now();
        const timeSinceLastRecording = autoState.lastAutoRecordTime > 0 ? now - autoState.lastAutoRecordTime : Infinity;
        
        if (timeSinceLastRecording < 1000) { // Reduced from 5000ms to 1000ms for faster blocking
          console.log('[PLAYBACK COMPLETE] ❌ BLOCKING auto-record after skip - recording just finished', {
            timeSinceLastRecording,
            cooldownRemaining: 1000 - timeSinceLastRecording // Updated cooldown calculation
          });
        } else {
          setTimeout(() => {
            // CRITICAL FIX: Don't trigger auto-recording if currently recording
            if (isRecording) {
              console.log('[PLAYBACK COMPLETE] ❌ User is recording, skipping auto-recording trigger after skip');
              return;
            }
            
            // FOCUSED FIX: Double-check that ALL playback states are cleared before auto-recording after skip
            const isAnyPlaybackStillActive = (
              isPlayingMessage || 
              isProcessingRef.current || 
              processingStateRef.current.isProcessing ||
              robustQueueRef.current.isProcessing ||
              robustQueueRef.current.messages.length > 0 ||
              currentSound !== null ||
              isPlaying !== null ||
              currentlyPlayingMessageIdRef.current !== null
            );
            
            if (isAnyPlaybackStillActive) {
              console.log('[PLAYBACK COMPLETE] ❌ Playback states not fully cleared yet after skip, skipping auto-recording trigger', {
                isPlayingMessage,
                isProcessing: isProcessingRef.current,
                processingStateIsProcessing: processingStateRef.current.isProcessing,
                robustQueueIsProcessing: robustQueueRef.current.isProcessing,
                robustQueueLength: robustQueueRef.current.messages.length,
                hasCurrentSound: currentSound !== null,
                isPlaying: isPlaying !== null,
                hasCurrentlyPlayingMessage: currentlyPlayingMessageIdRef.current !== null
              });
              return;
            }
            
            // NEW FIX: Check if someone is already recording before auto-recording (skipped message case)
            if (selectedChat && getRecordingUsers) {
              const recordingUsers = getRecordingUsers(selectedChat._id) || [];
              const currentUserId = user?.userId;
              const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
              
              if (otherRecordingUsers.length > 0) {
                console.log('[PLAYBACK COMPLETE] ❌ Someone else is recording, skipping auto-recording after skip:', {
                  otherRecordingUsers,
                  currentUserId
                });
                return;
              }
            }
            
            if (canAutoRecord('playback_ended')) {
              console.log('[PLAYBACK COMPLETE] 🎙️ Triggering auto-recording after skipped message completion');
              triggerAutoRecording('playback_ended');
            } else {
              console.log('[PLAYBACK COMPLETE] ❌ Auto-recording conditions not met after skip completion');
            }
          }, 10);
        }
      }
    }
  };

  const analyzeAudio = async (sound: Audio.Sound) => {
    try {
      // Initialize analyzer if not already initialized
      if (!audioAnalyzer.current) {
        audioAnalyzer.current = new AudioAnalyzer();
      }

      // Setup audio analyzer
      await audioAnalyzer.current.setupAudio(sound);

      // Start animation loop
      const updateAudioData = async () => {
        if (audioAnalyzer.current && isPlaying) {
          try {
            const data = await audioAnalyzer.current.getFrequencyData();
            setCurrentAudioData(data);
          } catch (error) {
            console.error('Error getting frequency data:', error);
          }
        }
      };

      // Use requestAnimationFrame for smoother animation
      const animationFrame = requestAnimationFrame(updateAudioData);
      return () => {
        cancelAnimationFrame(animationFrame);
        if (audioAnalyzer.current) {
          audioAnalyzer.current.cleanup();
          audioAnalyzer.current = null;
        }
      };
    } catch (error) {
      console.error('Error setting up audio analyzer:', error);
      if (audioAnalyzer.current) {
        audioAnalyzer.current.cleanup();
        audioAnalyzer.current = null;
      }
      return undefined;
    }
  };

  // NEW: Replace complex playMessage with FastPlaybackManager
  const playMessage = async (message: Message) => {
    // NEW: Check if message is an image or video - these can't be played as audio
    if (message.type === 'image' || message.type === 'video') {
      
      // Mark as viewed for image/video messages
      if (!message.isRead && message.senderId !== user?.userId) {
        try {
          await markMessageAsViewed(message);
        } catch (error) {
          console.error('[playMessage] ❌ Error marking image/video message as viewed:', error);
        }
      }
      
      // Add to played messages so it's not processed again
      playedMessageIdsRef.current.add(message._id);
      setPlayedMessageIds(new Set(playedMessageIdsRef.current));
      
      return; // Don't attempt to play as audio
    }
    
    // IMMEDIATE UI UPDATE
    setIsPlaying(message._id);
    setCurrentMessageId(message._id);
    setIsPlayingMessage(true);
    currentlyPlayingMessageIdRef.current = message._id;
    
    try {
      // Stop any recording immediately
      if (isRecording) {
        await stopRecording();
      }
      
      // Get audio URL - this is the only blocking operation we need
      let audioUrl;
      try {
        audioUrl = await getAudioUrl(message._id, message);
      } catch (error) {
        // @ts-ignore
        if (error && error.code === 'NO_AUDIO_URL_FOR_IMAGE_OR_VIDEO') {
          return;
        }
        throw error;
      }
      if (!audioUrl) {
        console.error('[playMessage] ❌ No audio URL available');
        return;
      }
      
      // START PLAYBACK IMMEDIATELY with single message
      const success = await fastPlaybackManager.playMessage(message._id, audioUrl, {
        queue: [message._id], // Start with just this message
        startIndex: 0,
        autoAdvance: false // We'll handle queue building in background
      });
      
      if (success) {
        // Mark as manually played
        isManualPlaybackRef.current = true;
        setPlaybackPosition(prev => ({ ...prev, [message._id]: 0 }));
        
        // BUILD QUEUE IN BACKGROUND (non-blocking)
        setTimeout(async () => {
          try {
            const messageIsRead = message.isRead || (message.readBy && message.readBy[user?.userId || '']);
            
            if (!messageIsRead) {
              // Build queue for unread messages
              const unreadMessages = messages.filter(m => 
                m.type === 'voice' && 
                !playedMessageIdsRef.current.has(m._id) &&
                m._id !== message._id &&
                m.audioUrl &&
                !m.isRead &&
                (!m.readBy || !m.readBy[user?.userId || ''])
              );
              
              if (unreadMessages.length > 0) {
                const queue = [message._id, ...unreadMessages.map(m => m._id)];
                
                // Update the queue by calling playMessage again with the new queue
                // This will update the internal queue without restarting playback
                const currentState = fastPlaybackManager.getPlaybackState();
                if (currentState.currentMessageId === message._id) {
                  // Update the queue in the manager's internal state
                  // We'll need to access the internal state directly
                  // For now, let's just start smart preloading
                  const nextMessages = queue.slice(1, 6);
                  if (nextMessages.length > 0) {
                    const getAudioUrlBound = (id: string) => getAudioUrl(id);
                    fastPlaybackManager.startSmartPreloading(nextMessages, getAudioUrlBound);
                  }
                }
              }
            }
          } catch (error) {
            console.error('[playMessage] ❌ Background queue building error:', error);
          }
        }, 25); // Reduced from 100ms to 25ms for faster playback start
        
      } else {
        console.error('[playMessage] ❌ FastPlaybackManager failed to play message');
      }
      
    } catch (error) {
      console.error('[playMessage] ❌ Error in fast playback:', error);
    }
  };

  // NEW: Simple pause/resume using FastPlaybackManager
  const pauseMessage = async () => {
    setIsPlaying(null); // UI updates instantly
    setIsPlayingMessage(false);
    currentlyPlayingMessageIdRef.current = null;
    try {
      const success = await fastPlaybackManager.pauseResume();
      if (success) {
        const state = fastPlaybackManager.getPlaybackState();
        setIsPlaying(state.isPlaying ? state.currentMessageId : null);
      } else {
      }
    } catch (error) {
      console.error('[pauseMessage] ❌ Pause/resume error:', error);
    }
  };

  const seekMessage = async (messageIdOrPosition: string | number, position?: number) => {
    if (!currentSound) return;
    
    try {
      // If only one argument is provided, it's the position and we use the current message
      const actualPosition = typeof messageIdOrPosition === 'number' ? messageIdOrPosition : position;
      const actualMessageId = typeof messageIdOrPosition === 'string' ? messageIdOrPosition : currentMessageId;
      
      if (actualPosition === undefined || !actualMessageId) return;
      
      await currentSound.setPositionAsync(actualPosition);
      setPlaybackPosition(prev => ({
        ...prev,
        [actualMessageId]: actualPosition
      }));
    } catch (error) {
      console.error('Error seeking message:', error);
    }
  };

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const renderGroupChat = ({ item }: { item: GroupChat }) => (
    <GroupChatListItem
      item={item}
      onPress={() => handleChatSelect(item)}
      onLongPress={() => handleEavesdrop(item)}
      selected={selectedChat?._id === item._id}
    />
  );

  const cleanupAudio = async () => {
    try {
      // Clean up sound
      if (currentSound) {
        try {
          const status = await currentSound.getStatusAsync();
          if (status.isLoaded) {
            await currentSound.stopAsync();
            await currentSound.unloadAsync();
          }
        } catch (error) {
          // Handle the specific "Seeking interrupted" error gracefully
          if (error instanceof Error && error.message.includes('Seeking interrupted')) {
          } else {
            console.error('Error cleaning up sound:', error);
          }
        } finally {
          setCurrentSound(null);
        }
      }

      // Clean up recording
      if (currentRecording) {
        try {
          await currentRecording.stopAndUnloadAsync();
        } catch (error) {
          // Handle the specific "already unloaded" error gracefully
          if (error instanceof Error && error.message.includes('already been unloaded')) {
          } else {
            console.error('Error cleaning up recording:', error);
          }
        } finally {
          setCurrentRecording(null);
          setIsRecording(false);
          setRecordingDuration(0);
          setRecordingStartTime(0);
        }
      }

      // Clean up audio analyzer
      if (audioAnalyzer.current) {
        try {
          audioAnalyzer.current.cleanup();
        } catch (error) {
          console.error('Error cleaning up audio analyzer:', error);
        } finally {
          audioAnalyzer.current = null;
        }
      }

      // Reset all states
      setIsPlaying(null);
      setCurrentMessageId(null);
      setCurrentAudioData(undefined);
      isProcessingRef.current = false;
      
      // Clear paused recording state
      pausedRecordingRef.current = { recording: null, wasRecording: false };
    } catch (error) {
      console.error('Error in cleanupAudio:', error);
    }
  };

  // Add cleanup on component unmount and chat change
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [selectedChat]);

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, []);

  const handleBackPress = async () => {
    // OPTIMIZATION: Store chat info for cleanup then immediately clear UI
    const chatToCleanup = selectedChat;
    const currentUserId = user?.userId;
    
    // ⚡ INSTANT UI UPDATE - Clear screen immediately
    setSelectedChat(null);
    setMessages([]);
    setIsNavigating(false);
    
    // Reset UI animations instantly
    translateX.setValue(0);
    opacity.setValue(1);
    scale.setValue(1);
    rotateY.setValue(0);
    
    // Clear UI state instantly
    setPlaybackPosition({});
    setPlaybackDuration({});
    setCurrentMessageId(null);
    setIsPlaying(null);
    setHasAutoPlayed(false);
    setPlayedMessageIds(new Set());
    playedMessageIdsRef.current = new Set();
    setIsStorageLoaded(false);
    setIsAutoPlaying(false);
    isAutoPlayingRef.current = false;
    pausedRecordingRef.current = { recording: null, wasRecording: false };
    isFirstChatOpenRef.current = true;
    
    // All cleanup happens asynchronously in background without blocking UI
    setTimeout(async () => {
      try {
        // Special handling for 2-person chats: Clear recording state for other user
        const is2PersonChat = chatToCleanup && chatToCleanup.members && chatToCleanup.members.length === 2;
        
        if (socket && chatToCleanup && currentUserId) {
          socket.emit('leave_recording_queue', {
            groupId: chatToCleanup._id,
            userId: currentUserId
          });
          
          // In 2-person chats, if we're recording or anyone is recording, 
          // clear the recording state completely to free the mic for the other person
          if (is2PersonChat) {
            const recordingUsers = getRecordingUsers ? getRecordingUsers(chatToCleanup._id) : [];
            const isAnyoneCurrentlyRecording = isAnyoneRecording ? isAnyoneRecording(chatToCleanup._id) : false;
            
            if (isAnyoneCurrentlyRecording || recordingUsers.length > 0 || isRecording) {
              // Emit recording stop for this user specifically
              socket.emit('recording_stop', { 
                groupId: chatToCleanup._id,
                userId: currentUserId,
                reason: 'user_left_chat'
              });
              
              // Also reset the recording state to ensure clean slate
              socket.emit('reset_recording_state', { groupId: chatToCleanup._id });
            }
          }
        }
        
        // Stop and clear any active recording before navigating away
        await clearRecordingState('handleBackPress');
      
        // Stop any active playback and skip the current message in queue
        if (currentSound && isPlaying) {
          try {
            await currentSound.stopAsync();
            await currentSound.unloadAsync();
          } catch (error) {
            // Handle the specific "Seeking interrupted" error gracefully
            if (error instanceof Error && error.message.includes('Seeking interrupted')) {
            } else {
              console.warn('[handleBackPress] ⚠️ Error stopping current sound:', error);
            }
          }
          setCurrentSound(null);
          setIsPlayingMessage(false);
          
          // Skip the currently playing message in the queue
          if (currentMessageId) {
            removeFromQueue(currentMessageId);
            
            // Mark the message as played/read so it won't auto-play again
            if (chatToCleanup && currentUserId) {
              try {
                await markMessageAsViewed({ _id: currentMessageId } as Message);
              } catch (error) {
                console.warn('[handleBackPress] ⚠️ Error marking message as viewed:', error);
              }
            }
          }
        }
        
        // Clean up audio resources
        await cleanupAudio();
        // Clear the message queue
        clearQueue();
        
      } catch (error) {
        console.error('[handleBackPress] Error in background cleanup:', error);
      }
    }, 0); // Run immediately but asynchronously
  };

  const onRecordingStatusUpdate = (status: any) => {
    if (status.isRecording) {
      setRecordingDuration(status.durationMillis || 0);
    }
  };

  const handleChatSelect = async (chat: GroupChat) => {
    try {
      // Special handling for 2-person chats when switching away
      const isPrevious2PersonChat = selectedChat && selectedChat.members && selectedChat.members.length === 2;
      
      // Leave recording queue from previous chat if user is in it
      if (socket && selectedChat && user?.userId && selectedChat._id !== chat._id) {
        socket.emit('leave_recording_queue', {
          groupId: selectedChat._id,
          userId: user.userId
        });
        
        // In 2-person chats, if we're recording or anyone is recording,
        // clear the recording state completely to free the mic for the other person
        if (isPrevious2PersonChat) {
          const recordingUsers = getRecordingUsers ? getRecordingUsers(selectedChat._id) : [];
          const isAnyoneCurrentlyRecording = isAnyoneRecording ? isAnyoneRecording(selectedChat._id) : false;
          
          if (isAnyoneCurrentlyRecording || recordingUsers.length > 0 || isRecording) {
            
            // Emit recording stop for this user specifically  
            socket.emit('recording_stop', { 
              groupId: selectedChat._id,
              userId: user.userId,
              reason: 'user_switched_chat'
            });
            
                         // Also reset the recording state to ensure clean slate
             if (socket) {
               socket.emit('reset_recording_state', { groupId: selectedChat._id });
             }
           }
         }
       }
       
       // Stop and clear any active recording before switching chats
       await clearRecordingState('handleChatSelect');
      
      // CRITICAL FIX: Stop any playing audio when switching chats to prevent audio from continuing to play
      await cleanupAudio();
      
      // Set navigation state to prevent socket updates during animation
      setIsNavigating(true);
      
      // Animate the transition to the chat
      Animated.parallel([
        // Animate group list out
        Animated.timing(listTranslateX, {
          toValue: -SCREEN_WIDTH,
          duration: 300,
          useNativeDriver: true,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }),
        Animated.timing(listOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }),
        // Animate chat in
        Animated.timing(translateX, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }),
        Animated.timing(rotateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
          easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
        }),
      ]).start(async () => {
        // Use the context's selectGroupChat function after animation
        await selectGroupChat({...chat, updatedAt: chat.lastMessageAt || chat.createdAt});
        
        // Reset robust queue for new chat
        resetRobustQueueForNewChat();
        
        // Reset local state for audio playback
        translateX.setValue(0);
        opacity.setValue(1);
        scale.setValue(1);
        rotateY.setValue(0);
        listTranslateX.setValue(-SCREEN_WIDTH);
        listOpacity.setValue(0);
        setPlaybackPosition({});
        setPlaybackDuration({});
        setCurrentMessageId(null);
        setIsPlaying(null);
        setHasAutoPlayed(false);
        setPlayedMessageIds(new Set());
        playedMessageIdsRef.current = new Set();
        setIsStorageLoaded(false);
        
        // Reset recording session flag
        isStartingRecordingRef.current = false;
        
        // Mark that we've opened a chat (no longer first time)
        isFirstChatOpenRef.current = false;
        
        // Reset navigation state after a brief delay
        setTimeout(() => {
          setIsNavigating(false);
        }, 25);
      });
    } catch (error) {
      // Reset navigation state on error
      setIsNavigating(false);
      console.error('[GCTestDatabase][handleChatSelect] Error selecting chat:', error);
    }
  };

  const handleRecordPress = async () => {
    if (isRecording) {
      // Stop recording immediately
      await stopRecording();
    } else {
      // FIXED: Manual recording should use queue system
      /*console.log('[MANUAL RECORDING] 🎙️ User pressed record button', {
        selectedChatId: selectedChat?._id,
        userId: user?.userId,
        chatMembers: selectedChat?.members?.length,
        hasSocket: !!socket,
        hasGetRecordingUsers: !!getRecordingUsers
      });*/
      
      if (!selectedChat || !user?.userId) {
        //console.log('[MANUAL RECORDING] ❌ No chat or user selected');
        return;
      }

      // Check if we should use queue system (groups with 3+ members)
      const shouldUseQueue = selectedChat.members && selectedChat.members.length > 2;
      /*console.log('[MANUAL RECORDING] Queue system check:', {
        shouldUseQueue,
        memberCount: selectedChat.members?.length,
        hasSocket: !!socket,
        hasGetRecordingUsers: !!getRecordingUsers
      });*/
      
      if (shouldUseQueue && getRecordingUsers && socket) {
        const recordingUsers = getRecordingUsers(selectedChat._id) || [];
        const currentUserId = user.userId;
        const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
        const currentUser = selectedChat.members.find(member => member.userId === currentUserId);
        
        /*console.log('[MANUAL RECORDING] Recording users check:', {
          allRecordingUsers: recordingUsers,
          otherRecordingUsers,
          currentUserId,
          foundCurrentUser: !!currentUser
        });*/
        
        if (!currentUser) {
          //console.log('[MANUAL RECORDING] ❌ Current user not found in chat members');
          return;
        }
        
        // ENHANCED: Always use queue system for groups with 3+ members when others are recording
        // This allows both auto-recording and non-auto-recording users to manually join the queue
        if (otherRecordingUsers.length > 0) {
          //console.log('[MANUAL RECORDING] 📝 Others recording, joining queue (available for all users)');
          
          // Track that we're manually joining the queue
          const autoState = autoRecordingStateRef.current;
          autoState.isInRecordingQueue = true;
          autoState.queueJoinTimestamp = Date.now();
          
          // For users with auto-recording enabled, this is still a manual action
          // They pressed the button, so treat it as manual even if they have auto-recording on
          autoState.isWaitingForQueueGrant = false; // Manual button press, not auto-recording trigger
          
          //console.log('[MANUAL RECORDING] 🚀 Emitting join_recording_queue event');
          socket.emit('join_recording_queue', {
            groupId: selectedChat._id,
            userId: currentUserId,
            userName: currentUser.name,
            timestamp: Date.now(),
            isAutoRecording: false, // Manual button press, regardless of user's auto-recording setting
          });
          
          return;
        } else {
          //console.log('[MANUAL RECORDING] 🎯 No others recording, proceeding to direct recording');
        }
      } else {
        //console.log('[MANUAL RECORDING] 🎯 Not using queue system, proceeding to direct recording');
      }

      // Only manual recording interrupts playback. For auto-recording or queue-based recording, playback should not be interrupted.
      // Clear any active playback
      if (currentSound && isPlaying) {
        try {
          await currentSound.unloadAsync();
        } catch (error) {
          console.warn('[MANUAL RECORDING] ⚠️ Error stopping current sound:', error);
        }
        setCurrentSound(null);
        setIsPlaying(null);
        setCurrentMessageId(null);
        setIsPlayingMessage(false);
      }

      // Clear queues
      clearQueue();
      clearRobustQueue();
      
      // Reset processing states
      isQueueProcessingRef.current = false;
      isProcessingRef.current = false;
      currentlyPlayingMessageIdRef.current = null;
      
      // CRITICAL: Prevent auto-recording after manual recording
      const autoState = autoRecordingStateRef.current;
      autoState.hasAutoRecordedInThisChat = true;
      autoState.lastAutoRecordTime = Date.now();
      autoState.isAutoRecordingInProgress = false;
      autoState.autoRecordingTriggered = false;
      
      /*console.log('[MANUAL RECORDING] ✅ Set cooldown to prevent auto-recording after manual recording:', {
        lastAutoRecordTime: autoState.lastAutoRecordTime,
        cooldownUntil: autoState.lastAutoRecordTime + 1000 // Reduced from 5000ms to 1000ms for faster blocking
      });*/
      
      //console.log('[MANUAL RECORDING] ✅ Starting direct manual recording');
      await startRecording();
    }
  };

  const renderRightActions = (progress: any, dragX: any, onDelete: () => void) => (
    <TouchableOpacity
      style={{
        backgroundColor: '#FF3B30',
        justifyContent: 'center',
        alignItems: 'center',
        width: 80,
        height: '100%',
      }}
      onPress={onDelete}
      activeOpacity={0.8}
    >
      <Ionicons name="trash" size={28} color="#fff" />
    </TouchableOpacity>
  );

  const renderMemberItem = ({ item }: { item: GroupChatMember }) => {
    const isCreator = selectedChat?.createdBy === item.userId;
    const isCurrentUser = user?.userId === item.userId;
    // Allow creator to remove others, and allow any user to remove themselves (unless creator)
    const canDelete = (selectedChat?.createdBy === user?.userId && !isCreator) || (isCurrentUser && !isCreator);
    return (
      <View style={styles.memberItem}>
        <View style={styles.memberAvatar}>
          <Text style={styles.memberAvatarText}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.memberInfo}>
          <View style={styles.memberNameContainer}>
            <Text style={styles.memberName}>{item.name}</Text>
            {isCreator && (
              <View style={styles.creatorBadge}>
                <Ionicons name="star" size={14} color="#26A7DE" />
                <Text style={styles.creatorBadgeText}>Creator</Text>
              </View>
            )}
          </View>
          <Text style={styles.memberJoinDate}>
            Joined {new Date(item.joinedAt).toLocaleDateString()}
          </Text>
        </View>
        {/* Show a shield for protected creator, nothing for others */}
        {!canDelete && isCreator && (
          <View style={styles.protectedMemberIcon}>
            <Ionicons name="shield-checkmark" size={20} color="#26A7DE" />
          </View>
        )}
      </View>
    );
  };

  const searchUsers = async (name: string) => {
    /*console.log('[AddMember][SearchUsers] Starting user search process:', {
      searchName: name,
      selectedChatId: selectedChat?._id,
      selectedChatName: selectedChat?.name,
      currentUserId: user?.userId,
      timestamp: new Date().toISOString()
    });*/

    setIsSearching(true);
    try {
      const searchUrl = `${API_URL}/users${name.trim() ? `?name=${encodeURIComponent(name)}` : ''}`;
      /*console.log('[AddMember][SearchUsers] Making API request:', {
        url: searchUrl,
        method: 'GET',
        searchQuery: name.trim() || 'all users'
      });*/

      const response = await fetch(searchUrl);
      
      /*console.log('[AddMember][SearchUsers] Response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });*/
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('[AddMember][SearchUsers] API error response:', errorData);
        throw new Error(errorData.error || 'Failed to search users');
      }
      
      const users = await response.json();
      /*console.log('[AddMember][SearchUsers] Raw users received:', {
        count: users.length,
        users: users.map((u: any) => ({ _id: u._id, name: u.name, email: u.email }))
      });*/
      
      // Filter out users who are already in the group
      const filteredUsers = users.filter((user: SearchUser) => 
        !selectedChat?.members.some(member => member.userId === user._id)
      );
      
      /*console.log('[AddMember][SearchUsers] Filtered users (excluding existing members):', {
        originalCount: users.length,
        filteredCount: filteredUsers.length,
        existingMembers: selectedChat?.members.map(m => ({ userId: m.userId, name: m.name })),
        filteredUsers: filteredUsers.map((u: SearchUser) => ({ _id: u._id, name: u.name, email: u.email }))
      });*/
      
      const mappedUsers = filteredUsers.map((user: SearchUser) => ({
        ...user,
        userId: user._id // Map _id to userId for consistency
      }));

      /*console.log('[AddMember][SearchUsers] Setting search results:', {
        finalCount: mappedUsers.length,
        mappedUsers: mappedUsers.map((u: any) => ({ _id: u._id, userId: u.userId, name: u.name }))
      });*/

      setSearchResults(mappedUsers);
    } catch (error: any) {
      console.error('[AddMember][SearchUsers] Error in search process:', {
        error: error.message,
        stack: error.stack,
        type: error.constructor.name,
        searchName: name
      });
      setSearchResults([]); // Clear results on error without showing alert
    } finally {
      //console.log('[AddMember][SearchUsers] Search process completed, setting isSearching to false');
      setIsSearching(false);
    }
  };

  const handleEavesdrop = async (chat: GroupChat) => {
    setIsEavesdropping(true);
    setEavesdropChat(chat);
    await fetchMessages(chat._id);
  };

  const handleExitEavesdrop = async () => {
    // Stop and clear any active recording before exiting eavesdrop mode
    await clearRecordingState('handleExitEavesdrop');
    
    setIsEavesdropping(false);
    setEavesdropChat(null);
  };

  // Add this helper to generate a temp ID
  function generateTempId() {
    return 'temp-' + uuidv4();
  }

  const sendVoiceMessage = async (audioUri: string, duration: number) => {
    if (!selectedChat || !user) {
      console.error('[SEND VOICE MESSAGE] ❌ No chat selected or user not found');
      return;
    }

    console.log('[SEND VOICE MESSAGE] 🎙️ Starting voice message send:', {
      audioUri,
      duration,
      chatId: selectedChat._id,
      userId: user.userId
    });

    const tempId = `temp_voice_${Date.now()}`;
    const pendingMessage: Message = {
      _id: tempId,
      audioUrl: undefined,
      duration,
      senderId: user.userId,
      groupChatId: selectedChat._id,
      timestamp: new Date().toISOString(),
      type: 'voice',
      isRead: false,
      isDelivered: true,
      processingStatus: 'processing',
      readBy: { [user.userId]: new Date().toISOString() },
      deliveredTo: [user.userId]
    };

    // Add to messages immediately for instant feedback
    setMessages((prev: Message[]) => [pendingMessage, ...prev]);

    // 2. Send to backend
    try {
      const token = await AsyncStorage.getItem('accessToken');
      let response = await fetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          audioUrl: null, // Server will update this after upload
          duration,
          senderId: user.userId,
          groupChatId: selectedChat._id,
          type: 'voice',
          timestamp: pendingMessage.timestamp,
          isRead: false,
          isDelivered: true,
          processingStatus: 'pending',
          clientTempId: tempId,
        }),
      });

      // Handle 401 error with token refresh
      if (response.status === 401) {
        console.log('[sendVoiceMessage] 401 received, attempting token refresh...');
        try {
          await refreshAccessToken();
          const newToken = await AsyncStorage.getItem('accessToken');
          response = await fetch(`${API_URL}/messages`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${newToken}`
            },
            body: JSON.stringify({
              audioUrl: null, // Server will update this after upload
              duration,
              senderId: user.userId,
              groupChatId: selectedChat._id,
              type: 'voice',
              timestamp: pendingMessage.timestamp,
              isRead: false,
              isDelivered: true,
              processingStatus: 'pending',
              clientTempId: tempId,
            }),
          });
        } catch (refreshError) {
          console.error('[sendVoiceMessage] Token refresh failed:', refreshError);
          Alert.alert('Authentication Error', 'Please log in again');
          router.replace('/login');
          return;
        }
      }
      
      if (response.ok) {
        const responseData = await response.json();
        /*console.log('[QUEUE RECORDER] ✅ Message sent successfully:', {
          messageId: responseData._id,
          clientTempId: responseData.clientTempId
        });*/
        
        // NEW: Trigger auto-recording for sender in 3+ person chats after sending message
        const is3PlusPersonChat = selectedChat.members && selectedChat.members.length > 2;
        if (is3PlusPersonChat && autoRecordingEnabled) {
          console.log('[SEND VOICE MESSAGE] 🎙️ 3+ person chat - triggering auto-recording for sender after message sent');
          
          // Add a small delay to ensure the message is processed before triggering auto-recording
          setTimeout(() => {
            if (canAutoRecord('message_sent')) {
              triggerAutoRecording('message_sent');
            }
          }, 500);
        }
      } else {
        const errorData = await response.text();
        console.error('[QUEUE RECORDER] ❌ Backend error:', {
          status: response.status,
          error: errorData
        });
        throw new Error(`Backend error: ${response.status} - ${errorData}`);
      }
      
    } catch (error) {
      console.error('[QUEUE RECORDER] ❌ Error sending voice message:', error);
      
      // Remove the temporary message on error
      setMessages((prev: Message[]) => prev.filter(msg => msg._id !== tempId));
      
      Alert.alert('Error', 'Failed to send voice message. Please try again.');
    }
  };

  const renderItem = ({ item }: { item: Message }) => {
    // FIXED: Remove the blank message detection that prevents rendering
    // Messages should appear immediately even without full information
    // The GroupChatMessage component will handle showing loading states
    
    const isNewMessage = newMessageIds.has(item._id);
    
    return (
      <GroupChatMessage
        item={item}
        user={user || { userId: undefined }}
        playbackPosition={playbackPosition}
        playbackDuration={playbackDuration}
        isPlaying={isPlaying}
        getAudioUrl={getAudioUrl}
        pauseMessage={pauseMessage}
        playMessage={playMessage}
        seekMessage={seekMessage}
        formatTime={formatTime}
        groupMembers={selectedChat?.members || []}
        markMessageAsViewed={markMessageAsViewed}
        isNewMessage={isNewMessage}
        skipMessage={messageProps.skipMessage}
        skipToMessage={messageProps.skipToMessage}
      />
    );
  };

  const startRecordingSession = async (): Promise<boolean> => {
    // Check if we can start a recording session
    if (recordingLockRef.current || isStartingRecordingRef.current) {
      return false;
    }
    
    if (isRecording) {
      return false;
    }
    
    if (isPlayingMessage || isProcessingRef.current) {
      return false;
    }
    
    if (isQueueProcessingRef.current && messageQueueRef.current.length > 0) {
      return false;
    }
    
    return true;
  };

  const endRecordingSession = (): void => {
    // Reset recording session state
    recordingSessionRef.current.recordingStartTime = 0;
    if (recordingSessionRef.current.recordingTimeoutId) {
      clearTimeout(recordingSessionRef.current.recordingTimeoutId);
      recordingSessionRef.current.recordingTimeoutId = null;
    }
  };

  const processQueue = async () => {
    processRobustQueue();
  };

  const processQueueSequentially = async () => {
    processRobustQueue();
  };

  const onGestureEvent = (event: PanGestureHandlerGestureEvent) => {
    // Handle gesture events for navigation
    const { translationX } = event.nativeEvent;
    
    if (translationX > 50) {
      // Swipe right - go back to chat list
      handleBackPress();
    }
  };

  const onHandlerStateChange = (event: PanGestureHandlerGestureEvent) => {
    // Handle gesture state changes for navigation
    const { state, translationX } = event.nativeEvent;
    
    if (state === State.END && translationX > 50) {
      // Swipe right completed - go back to chat list
      handleBackPress();
    }
  };

  // FIXED: Smart auto-record check based on user requirements
  const canAutoRecord = (reason?: 'chat_entry' | 'playback_ended' | 'queue_granted' | 'queue_completed' | 'message_sent'): boolean => {
    // Check if auto-recording is enabled in settings
    if (!autoRecordingEnabled) {
      return false;
    }
    
    const now = Date.now();
    const autoState = autoRecordingStateRef.current;
    const processingState = processingStateRef.current;
    const robustQueue = robustQueueRef.current;
    
    // Safety reset if stuck for too long (30 seconds)
    if (autoState.isAutoRecordingInProgress && (now - autoState.lastAutoRecordTime > 30000)) {
      autoState.isAutoRecordingInProgress = false;
      autoState.autoRecordingTriggered = false;
      autoState.isInRecordingQueue = false;
      autoState.isWaitingForQueueGrant = false;
      autoState.preventMultipleAutoRecording = false;
    }
    
    // BASIC CHECKS: System state
    if (isRecording || 
        recordingLockRef.current || 
        isStartingRecordingRef.current) {
      return false;
    }
    
    // Check if someone else is recording (for conflict prevention)
    if (selectedChat && getRecordingUsers) {
      const recordingUsers = getRecordingUsers(selectedChat._id) || [];
      const currentUserId = user?.userId;
      const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
      const currentUserIsRecording = currentUserId ? recordingUsers.includes(currentUserId) : false;      
      // If current user is already recording, don't auto-record again
      if (currentUserIsRecording) {
        return false;
      }
      
      // Check if this is a 2-person group chat
      const is2PersonChat = selectedChat.members && selectedChat.members.length === 2;
      
      // For 2-person chats, immediately block if someone else is recording
      if (is2PersonChat && otherRecordingUsers.length > 0) {
        return false;
      }
      
      // For 3+ person chats, we'll need to use queue (handled in triggerAutoRecording)
    }
    
    // REASON-SPECIFIC CHECKS
    if (reason === 'chat_entry') {
      // Check if any playback is active - don't auto-record during playback
      const isAnyPlaybackActive = (
        isPlayingMessage || 
        isProcessingRef.current || 
        processingState.isProcessing ||
        robustQueue.isProcessing ||
        robustQueue.messages.length > 0 ||
        currentSound !== null ||
        isPlaying !== null ||
        currentlyPlayingMessageIdRef.current !== null
      );
      
      // ENHANCED: Allow queue joining even during playback for group chats with 3+ members
      const shouldUseQueue = selectedChat && selectedChat.members && selectedChat.members.length > 2;
      if (shouldUseQueue && getRecordingUsers && socket && user?.userId) {
        const recordingUsers = getRecordingUsers(selectedChat._id) || [];
        const currentUserId = user.userId;
        const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
        
        // If others are recording, allow queue joining even during playback
        if (otherRecordingUsers.length > 0) {
          return true;
        }
      }
      
      if (isAnyPlaybackActive) {
        return false;
      }
      
      // Allow if not already auto-recorded in this chat
      return !autoState.hasAutoRecordedInThisChat;
    }
    
    // REQUIREMENT 2: Playback ended auto-record
    if (reason === 'playback_ended') {
      // Check if any playback is still active
      const isAnyPlaybackActive = (
        isPlayingMessage || 
        isProcessingRef.current ||
        processingState.isProcessing ||
        robustQueue.isProcessing ||
        robustQueue.messages.length > 0 ||
        currentSound !== null ||
        isPlaying !== null ||
        currentlyPlayingMessageIdRef.current !== null
      );
      
      if (isAnyPlaybackActive) {
        return false;
      }
      
      // Allow auto-record after playback (even if already auto-recorded before)
      return true;
    }
    
    // REQUIREMENT 4: Queue granted auto-record
    if (reason === 'queue_granted') {
      // Check cooldown even for queue granted permissions to prevent back-to-back recording
      // The cooldown check will be applied below in the default case
    }
    
    // REQUIREMENT 5: Queue completed auto-record
    if (reason === 'queue_completed') {
      // Check if any playback is still active - don't auto-record during playback
      const isAnyPlaybackActive = (
        isPlayingMessage || 
        isProcessingRef.current ||
        processingState.isProcessing ||
        robustQueue.isProcessing ||
        robustQueue.messages.length > 0 ||
        currentSound !== null ||
        isPlaying !== null ||
        currentlyPlayingMessageIdRef.current !== null
      );
      
      if (isAnyPlaybackActive) {
        return false;
      }
      
      // Allow auto-record when queue is completed and no playback is active
      // This includes cases where there were no messages to process
      return true;
    }
    
    // NEW: Message sent auto-record for 3+ person chats
    if (reason === 'message_sent') {
      // Only allow for 3+ person chats
      const is3PlusPersonChat = selectedChat && selectedChat.members && selectedChat.members.length > 2;
      if (!is3PlusPersonChat) {
        return false;
      }
      
      // Check if any playback is active - don't auto-record during playback
      const isAnyPlaybackActive = (
        isPlayingMessage || 
        isProcessingRef.current || 
        processingState.isProcessing ||
        robustQueue.isProcessing ||
        robustQueue.messages.length > 0 ||
        currentSound !== null ||
        isPlaying !== null ||
        currentlyPlayingMessageIdRef.current !== null
      );
      
      if (isAnyPlaybackActive) {
        return false;
      }
      
      // Allow auto-record after sending a message in 3+ person chats
      // This ensures the sender gets added to the queue/auto-record system
      return true;
    }
    
    // Default case - apply standard checks
    const isAnyPlaybackActive = (
      isPlayingMessage || 
      isProcessingRef.current || 
      processingState.isProcessing ||
      robustQueue.isProcessing ||
      robustQueue.messages.length > 0 ||
      currentSound !== null ||
      isPlaying !== null ||
      currentlyPlayingMessageIdRef.current !== null
    );
    
    if (isAnyPlaybackActive) {
      return false;
    }
    
    // REQUIREMENT 3: Prevent auto-record right after ANY recording finishes
    // ENHANCED: Different cooldowns based on chat type - MORE AGGRESSIVE for 3+ person chats
    const is2PersonChat = selectedChat && selectedChat.members && selectedChat.members.length === 2;
    const is3PlusPersonChat = selectedChat && selectedChat.members && selectedChat.members.length > 2;
    
    // Enhanced cooldown durations
    let cooldownDuration;
    if (is2PersonChat) {
      cooldownDuration = 20000; // 20 seconds for 2-person chats (preserve existing functionality)
    } else if (is3PlusPersonChat) {
      cooldownDuration = 30000; // 30 seconds for 3+ person chats (more aggressive)
    } else {
      cooldownDuration = 15000; // 15 seconds for single user or edge cases
    }
    
    if (autoState.lastAutoRecordTime > 0 && (now - autoState.lastAutoRecordTime < cooldownDuration)) {
      return false;
    }
    
    // CRITICAL FIX: Additional safeguard for active concurrent 2-person chats
    // This prevents both users from auto-recording simultaneously during longer conversations
    if (is2PersonChat && reason === 'chat_entry') {
      const recentActivityThreshold = 30000; // 30 seconds
      const hasRecentActivity = autoState.lastAutoRecordTime > 0 && 
        (now - autoState.lastAutoRecordTime) < recentActivityThreshold;
      
      // If there's been recent auto-recording activity in a 2-person chat,
      // be more conservative about allowing another auto-record
      if (hasRecentActivity) {
        return false;
      }
    }
    
    // Check for mixed auto-recording settings in group chats
    if (selectedChat && selectedChat.members) {
      const currentUserId = user?.userId;
      const otherMembers = selectedChat.members.filter(member => member.userId !== currentUserId);
      
      if (otherMembers.length > 0) {
        const canProceed = handleMixedAutoRecordingSettings();
        if (!canProceed) {
          return false;
        }
      }
    }
    
    return true;
  };

  // CRITICAL: Make canAutoRecord available globally for ScalableQueueProvider
  useEffect(() => {
    (window as any).canAutoRecord = canAutoRecord;
    return () => {
      delete (window as any).canAutoRecord;
    };
  }, [canAutoRecord]);

  // FIXED: Smart auto-recording function based on user requirements
  const triggerAutoRecording = async (reason: 'chat_entry' | 'playback_ended' | 'queue_granted' | 'queue_completed' | 'message_sent') => {
    const now = Date.now();
    const autoState = autoRecordingStateRef.current;
    
    // CRITICAL FIX: Check if auto-recording is enabled
    if (!autoRecordingEnabled) {
      return;
    }
    
    // CRITICAL FIX: Check if user is already recording
    if (isRecording || isStartingRecordingRef.current) {
      return;
    }
    
    // CRITICAL FIX: Check if any playback is still active for queue_completed
    if (reason === 'queue_completed') {
      const isAnyPlaybackActive = (
        isPlayingMessage || 
        isProcessingRef.current ||
        processingStateRef.current.isProcessing ||
        robustQueueRef.current.isProcessing ||
        robustQueueRef.current.messages.length > 0 ||
        currentSound !== null ||
        isPlaying !== null ||
        currentlyPlayingMessageIdRef.current !== null
      );
      
      if (isAnyPlaybackActive) {
        return;
      }
    }
    
    // CRITICAL: Check cooldown first to prevent back-to-back recording
    // ENHANCED: Different cooldowns based on chat type - MORE AGGRESSIVE for 3+ person chats
    const is2PersonChat = selectedChat && selectedChat.members && selectedChat.members.length === 2;
    const is3PlusPersonChat = selectedChat && selectedChat.members && selectedChat.members.length > 2;
    
    // Enhanced cooldown durations - consistent with canAutoRecord function
    let cooldownDuration;
    if (is2PersonChat) {
      cooldownDuration = 20000; // 20 seconds for 2-person chats (preserve existing functionality)
    } else if (is3PlusPersonChat) {
      cooldownDuration = 30000; // 30 seconds for 3+ person chats (more aggressive)
    } else {
      cooldownDuration = 15000; // 15 seconds for single user or edge cases
    }
    const timeSinceLastRecording = autoState.lastAutoRecordTime > 0 ? now - autoState.lastAutoRecordTime : Infinity;
    
    if (timeSinceLastRecording < cooldownDuration) {
      return;
    }
    
    // Basic safety checks
    if (isStartingRecordingRef.current || recordingLockRef.current || isRecording) {
      return;
    }

    // CRITICAL: Check for 2-person chat recording conflicts
    if (selectedChat && getRecordingUsers) {
      const recordingUsers = getRecordingUsers(selectedChat._id) || [];
      const currentUserId = user?.userId;
      const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
      const is2PersonChat = selectedChat.members && selectedChat.members.length === 2;
      
      // For 2-person chats, immediately block if someone else is recording
      if (is2PersonChat && otherRecordingUsers.length > 0) {
        return;
      }
      
      // FIXED: Remove overly restrictive check for 3+ person chats
      // The queue system should handle recording conflicts, not block auto-recording entirely
      // This allows the queue system to work properly for 3+ person chats
    }

    // Map reasons to canAutoRecord reasons
    let canAutoRecordReason: 'chat_entry' | 'playback_ended' | 'queue_granted' | 'message_sent' | undefined;
    if (reason === 'chat_entry') {
      canAutoRecordReason = 'chat_entry';
    } else if (reason === 'playback_ended') {
      canAutoRecordReason = 'playback_ended';
    } else if (reason === 'queue_granted') {
      canAutoRecordReason = 'queue_granted';
    } else if (reason === 'queue_completed') {
      canAutoRecordReason = 'playback_ended';
    } else if (reason === 'message_sent') {
      canAutoRecordReason = 'message_sent';
    }

    // Check if we can auto-record for this specific reason
    if (!canAutoRecord(canAutoRecordReason)) {
      return;
    }

    // Determine if we should use queue system
    const shouldUseQueue = selectedChat && selectedChat.members && selectedChat.members.length > 2;
    
    if (shouldUseQueue && getRecordingUsers && socket && user?.userId) {
      const recordingUsers = getRecordingUsers(selectedChat._id) || [];
      const currentUserId = user.userId;
      const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
      const currentUser = selectedChat.members.find(member => member.userId === currentUserId);
      
      if (!currentUser) {
        return;
      }
      
      // CRITICAL FIX: Check if user is already in queue and ready to record
      const isAlreadyInQueue = autoState.isInRecordingQueue;
      const isInPosition1 = autoState.queuePosition === 1;
      const isWaitingForGrant = autoState.isWaitingForQueueGrant;
      
      // SCENARIO 1: User is in position 1 and ready to record after playback - START RECORDING
      if (isAlreadyInQueue && isInPosition1 && isWaitingForGrant && reason === 'playback_ended') {
        
                 // Clear queue state since we're starting recording
         autoState.isInRecordingQueue = false;
         autoState.isWaitingForQueueGrant = false;
         autoState.queuePosition = 0;
         autoState.lastAutoRecordTime = now;
         
         // Notify server to remove from queue
         socket.emit('leave_recording_queue', {
           groupId: selectedChat._id,
           userId: currentUserId
         });
         
         setIsRecording(true);
         try {
          // FIXED: Atomic lock check to prevent multiple simultaneous auto-recording calls
          if (isStartingRecordingRef.current || recordingLockRef.current) {
            console.log('[AUTO-RECORDING] 🚫 Recording already starting, skipping duplicate call');
            setIsRecording(false);
            return;
          }
           await startRecording();
         } catch (error) {
           setIsRecording(false);
         }
        return;
      }
      
      // SCENARIO 2: User is in position 1 and ready to record after queue completion - START RECORDING
      if (isAlreadyInQueue && isInPosition1 && isWaitingForGrant && reason === 'queue_completed') {
        
        // Clear queue state since we're starting recording
        autoState.isInRecordingQueue = false;
        autoState.isWaitingForQueueGrant = false;
        autoState.queuePosition = 0;
        autoState.lastAutoRecordTime = now;
        
        // Notify server to remove from queue
        socket.emit('leave_recording_queue', {
          groupId: selectedChat._id,
          userId: currentUserId
        });
        
        setIsRecording(true);
        try {
          // FIXED: Atomic lock check to prevent multiple simultaneous auto-recording calls
          if (isStartingRecordingRef.current || recordingLockRef.current) {
            console.log('[AUTO-RECORDING] 🚫 Recording already starting, skipping duplicate call');
            setIsRecording(false);
            return;
          }
          await startRecording();
        } catch (error) {
          setIsRecording(false);
        }
        return;
      }
      
      // SCENARIO 3: Add to queue (others recording or not in position 1)
      if (otherRecordingUsers.length > 0 || !isAlreadyInQueue || !isInPosition1) {
        
        // Set queue state flags
        autoState.isInRecordingQueue = true;
        autoState.isWaitingForQueueGrant = true;
        autoState.queueJoinTimestamp = now;
        
        // For chat entry or message sent, mark as auto-recorded to prevent multiple attempts
        if (reason === 'chat_entry' || reason === 'message_sent') {
          autoState.hasAutoRecordedInThisChat = true;
        }
        
        socket.emit('join_recording_queue', {
          groupId: selectedChat._id,
          userId: currentUserId,
          userName: currentUser.name,
          timestamp: now,
          isAutoRecording: true,
        });
        
        return;
      }
    }

    // Direct recording (no queue needed - 1-on-1 or small groups with no conflicts)
    setIsRecording(true); // UI updates instantly
    try {
      // Set flags
      if (reason === 'chat_entry' || reason === 'message_sent') {
        autoState.hasAutoRecordedInThisChat = true;
      }
      autoState.lastAutoRecordTime = now;
      // Start recording
      // FIXED: Atomic lock check to prevent multiple simultaneous auto-recording calls
      if (isStartingRecordingRef.current || recordingLockRef.current) {
        console.log('[AUTO-RECORDING] 🚫 Recording already starting, skipping duplicate call');
        setIsRecording(false);
        return;
      }
      await startRecording();
    } catch (error) {
      setIsRecording(false); // Revert UI if error
    }
  };

  // CRITICAL: Make triggerAutoRecording available globally for ScalableQueueProvider
  useEffect(() => {
    (window as any).triggerAutoRecording = triggerAutoRecording;
    return () => {
      delete (window as any).triggerAutoRecording;
    };
  }, [triggerAutoRecording]);

  // Function to add message ID to new messages set for animation
  const addNewMessageForAnimation = (messageId: string) => {
    setNewMessageIds(prev => new Set([...prev, messageId]));
    
    // Clear the animation flag after animation completes
    setTimeout(() => {
      setNewMessageIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
    }, 1500); // Animation duration + buffer (800ms + 700ms buffer for fluid feel)
  };

  // Function to clear all new message animations
  const clearNewMessageAnimations = () => {
    setNewMessageIds(new Set());
  };

  // Effect to track new messages for animation - REDUCED LOGGING
  useEffect(() => {
    if (messages.length === 0) return;
    
    // Get the most recent message
    const mostRecentMessage = messages[0]; // Since the list is inverted
    
    // Check if this is a new message (not already in our tracking set)
    if (mostRecentMessage && !newMessageIds.has(mostRecentMessage._id)) {
      try {
        addNewMessageForAnimation(mostRecentMessage._id);
      } catch (error) {
        console.error('[ANIMATION] Error adding message for animation:', error);
      }
    }
  }, [messages, newMessageIds]); // Track both messages and newMessageIds

  // Returns the next message in the robust queue, or null if none exist
  const getNextFromQueue = (): Message | null => {
    const queue = robustQueueRef.current;
    if (queue.messages.length > 0) {
      return queue.messages[0];
    }
    return null;
  };

  // NEW: Function to handle mixed auto-recording settings in group chats
  const handleMixedAutoRecordingSettings = () => {
    if (!selectedChat || !selectedChat.members) return true;
    
    const currentUserId = user?.userId;
    const otherMembers = selectedChat.members.filter(member => member.userId !== currentUserId);
    
    if (otherMembers.length === 0) return true; // Single user chat, no conflicts
    
    // Check if any other users are currently recording
    if (getRecordingUsers) {
      const recordingUsers = getRecordingUsers(selectedChat._id) || [];
      const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
      
      if (otherRecordingUsers.length > 0) {
        return false;
      }
    }
    
    // Check if queue is being processed by other users
    const robustQueue = robustQueueRef.current;
    if (robustQueue.isProcessing) {
      return false;
    }
    
    return true;
  };

  // Cleanup on component unmount - leave recording queue
  useEffect(() => {
    return () => {
      // This runs when component unmounts
      if (socket && selectedChat && user?.userId) {
        socket.emit('leave_recording_queue', {
          groupId: selectedChat._id,
          userId: user.userId
        });
      }
    };
  }, []); // Empty dependency array means this only runs on mount/unmount

  const handleMessageUpdate = (messageId: string, updates: Partial<Message>) => {
    // Only log if there are significant updates
    if (updates.transcription || updates.processingStatus === 'ready' || updates.audioUrl) {
      /*console.log('[QUEUE RECORDER] 📬 Important message update:', {
        messageId,
        hasTranscription: !!updates.transcription,
        processingStatus: updates.processingStatus,
        hasAudioUrl: !!updates.audioUrl
      });*/
    }
    
    setMessages(prevMessages => {
      const messageIndex = prevMessages.findIndex(msg => msg._id === messageId);
      if (messageIndex === -1) {
        //console.log('[QUEUE RECORDER] ⚠️ Message not found for update:', messageId);
        return prevMessages;
      }
      
      const updatedMessages = [...prevMessages];
      const oldMessage = updatedMessages[messageIndex];
      updatedMessages[messageIndex] = { ...oldMessage, ...updates };
      
      return updatedMessages;
    });
  };

  // Fetch group chats when leaving a chat (selectedChat transitions from chat to null)
  // But skip refresh during navigation (swipe back) to prevent unwanted refreshes
  useEffect(() => {
    if (prevSelectedChatRef.current && !selectedChat && user && user.userId && !isNavigating) {
      fetchGroupChats(user.userId);
    }
    prevSelectedChatRef.current = selectedChat;
  }, [selectedChat, user, fetchGroupChats, isNavigating]);

  // Helper to normalize a message object
  function normalizeMessage(msg: any): Message {
    // Only log if there are issues with the message
    if (!msg._id || !msg.senderId || !msg.groupChatId) {
      /*console.log('[QUEUE RECORDER] ⚠️ Message normalization issue:', {
        messageId: msg._id,
        hasSenderId: !!msg.senderId,
        hasGroupChatId: !!msg.groupChatId,
        type: msg.type
      });*/
    }
    
    // Convert readBy Date objects to strings
    const normalizedReadBy: Record<string, string> = {};
    if (msg.readBy) {
      Object.entries(msg.readBy).forEach(([userId, timestamp]) => {
        if (timestamp instanceof Date) {
          normalizedReadBy[userId] = timestamp.toISOString();
        } else if (typeof timestamp === 'string') {
          normalizedReadBy[userId] = timestamp;
        }
      });
    }
    
    const normalized = {
      _id: msg._id || msg.id,
      audioUrl: msg.audioUrl || undefined,
      mediaUrl: msg.mediaUrl || undefined,
      content: msg.content || undefined,
      duration: msg.duration || 0,
      senderId: msg.senderId,
      groupChatId: msg.groupChatId,
      type: msg.type || 'voice',
      timestamp: msg.timestamp,
      processingStatus: msg.processingStatus || 'ready',
      isRead: msg.isRead || false,
      isDelivered: msg.isDelivered || true,
      transcription: msg.transcription || undefined,
      clientTempId: msg.clientTempId || undefined,
      readBy: normalizedReadBy,
    };
    
    return normalized;
  }

  // Clear messages only when switching to a different chat (not when going back to list)
  useEffect(() => {
    if (selectedChat && prevSelectedChatRef.current && 
        prevSelectedChatRef.current._id !== selectedChat._id) {
      // We're switching from one chat to a different chat - clear previous messages
      setMessages([]);
      setPlaybackPosition({});
      setPlaybackDuration({});
      setCurrentMessageId(null);
      setIsPlaying(null);
      setHasAutoPlayed(false);
      setPlayedMessageIds(new Set());
      playedMessageIdsRef.current = new Set();
      setIsStorageLoaded(false);
      
      // Clear animation tracking for new chat
      clearNewMessageAnimations();
    }
  }, [selectedChat?._id]);

  // Update the component props to match GroupChatMessage requirements
  const messageProps = {
    user: { userId: user?.userId },
    playbackPosition,
    playbackDuration,
    isPlaying,
    getAudioUrl,
    pauseMessage,
    playMessage: async (msg: Message) => {
      console.log('[Manual Playback] Starting manual playback for message:', msg._id);
      isManualPlaybackRef.current = true;
      
      // Check for spam protection but allow manual override
      if (messageSpamDetectionRef.current.blockedSenders.has(msg.senderId)) {
        //console.log('[Manual Playback] Message from blocked sender, but allowing manual playback:', msg.senderId);
      }
      
      // Fast path for manual playback - skip queue entirely
      try {
        // Mark as read when manually played (async in background)
        if (!msg.isRead) {
          markMessageAsRead(msg).then(() => {
            //console.log('[Manual Playback] Marked manually played message as read:', msg._id);
          }).catch(error => {
            console.error('[Manual Playback] Error marking manually played message as read:', error);
          });
        }
        
        // Play immediately without waiting for read receipt
        await playMessage(msg);
      } catch (error) {
        console.error('[Manual Playback] Error in manual playback:', error);
        isManualPlaybackRef.current = false;
      }
    },
    skipMessage: async () => {
      setIsPlaying(null); // UI updates instantly
      setIsPlayingMessage(false);
      currentlyPlayingMessageIdRef.current = null;
      // ...existing skip logic...
    },
    skipToMessage: async (targetMessageId: string) => {
      //console.log('[messageProps.skipToMessage] 🎯 Skip to next message from:', targetMessageId);
      
      // SURGICAL FIX: Check if target message is already read and do nothing if it is
      const targetMessage = messages.find(m => m._id === targetMessageId);
      const messageIsRead = targetMessage && (targetMessage.isRead || (targetMessage.readBy && targetMessage.readBy[user?.userId || '']));
      
      if (messageIsRead) {
        /*console.log('[skipToMessage] ❌ Cannot skip on already-read message - doing nothing:', {
          messageId: targetMessageId,
          isRead: targetMessage?.isRead,
          readByCurrentUser: targetMessage?.readBy && targetMessage.readBy[user?.userId || '']
        });*/
        return; // Do absolutely nothing if message is already read
      }
      
      // Check if we have a FastPlaybackManager queue
      const playbackState = fastPlaybackManager.getPlaybackState();
      const hasQueue = playbackState.queue.length > 0;
      
      if (hasQueue) {
        //console.log('[skipToMessage] 🚀 Using FastPlaybackManager for multiline skip');
        
        // VALIDATION: Check if the FastPlaybackManager queue is stale
        const currentMessageIds = messages.map(m => m._id);
        const robustQueueMessageIds = robustQueueRef.current.messages.map(m => m._id);
        const allValidMessageIds = new Set([...currentMessageIds, ...robustQueueMessageIds]);
        
        const validQueueMessages = playbackState.queue.filter(messageId => allValidMessageIds.has(messageId));
        const staleQueueMessages = playbackState.queue.filter(messageId => !allValidMessageIds.has(messageId));
        
        /*console.log('[skipToMessage] 🔍 Queue validation:', {
          originalQueueLength: playbackState.queue.length,
          validMessages: validQueueMessages.length,
          staleMessages: staleQueueMessages.length,
          staleMessageIds: staleQueueMessages,
          targetMessageId
        });*/
        
        // If queue has stale messages, clean it up and use robust queue logic instead
        if (staleQueueMessages.length > 0) {
          //console.log('[skipToMessage] 🧹 FastPlaybackManager queue is stale, clearing and falling back to robust queue');
          fastPlaybackManager.clearQueue();
          
          // ENHANCED: Also stop any current playback that might be using stale data
          if (currentSound) {
            try {
              await currentSound.stopAsync();
              setCurrentSound(null);
              setIsPlaying(null);
              setCurrentMessageId(null);
              currentlyPlayingMessageIdRef.current = null;
              //console.log('[skipToMessage] ✅ Stopped stale playback state');
            } catch (stopError) {
              console.warn('[skipToMessage] ⚠️ Error stopping stale playback:', stopError);
            }
          }
          
          // Continue with fallback logic below
        } else {
          // Queue is valid, proceed with FastPlaybackManager logic
          const currentIndex = playbackState.queue.indexOf(targetMessageId);
          const queueLength = playbackState.queue.length;
          
          if (currentIndex !== -1) {
            // SPECIAL CASE: Check if this is the last message in the queue
            const isLastMessage = currentIndex === queueLength - 1;
            
            if (isLastMessage) {
              //console.log('[skipToMessage] 🏁 Skipping on LAST message, using FastPlaybackManager');
              
              // Use the new skipOnLastMessage method which handles everything properly
              try {
                fastPlaybackManager.skipOnLastMessage(targetMessageId);
                return;
              } catch (error) {
                console.error('[skipToMessage] ❌ skipOnLastMessage error:', error);
                // Fall back to robust queue logic below
              }
            }
            
            // Check if this is close to the end and should skip to latest
            const isNearEnd = currentIndex >= queueLength - 2; // Last or second to last
            
            if (isNearEnd) {
              //console.log('[skipToMessage] 📝 Near end of queue, using skipToLatest with markSkippedAsRead');
              // Use skipToLatest to mark all skipped messages as read
              try {
                await fastPlaybackManager.skipToLatest({ markSkippedAsRead: true });
                return;
              } catch (error) {
                console.error('[skipToMessage] ❌ skipToLatest error:', error);
                // Fall back to robust queue logic below
              }
            } else {
              //console.log('[skipToMessage] ⏭️ Middle of queue, attempting to skip to next message');
              
              // Try to skip to next message, but handle the case where it fails
              try {
                const success = await fastPlaybackManager.skipNext(1);
                if (success) {
                  return; // Skip was successful
                } else {
                  //console.log('[skipToMessage] ⚠️ skipNext failed, treating as last message');
                  // Fall back to last message behavior
                  try {
                    fastPlaybackManager.skipOnLastMessage(targetMessageId);
                    return;
                  } catch (lastMessageError) {
                    console.error('[skipToMessage] ❌ skipOnLastMessage fallback error:', lastMessageError);
                    // Fall back to robust queue logic below
                  }
                }
              } catch (error) {
                console.error('[skipToMessage] ❌ skipNext error, treating as last message:', error);
                // Fall back to last message behavior
                try {
                  fastPlaybackManager.skipOnLastMessage(targetMessageId);
                  return;
                } catch (lastMessageError) {
                  console.error('[skipToMessage] ❌ skipOnLastMessage fallback error:', lastMessageError);
                  // Fall back to robust queue logic below
                }
              }
            }
          }
        }
      }
      
      // Fallback to original logic if FastPlaybackManager doesn't have the message
      //console.log('[skipToMessage] 🔄 Falling back to original skip logic');
      
      // Stop current playback immediately
      if (currentSound) {
        currentSound.unloadAsync().catch(error => console.warn('[skipToMessage] Error unloading sound:', error));
        setCurrentSound(null);
      }
      
      // Clear playback states
      setIsPlaying(null);
      setCurrentMessageId(null);
      currentlyPlayingMessageIdRef.current = null;
      setIsPlayingMessage(false);
      
      // Mark current message as played and read
      const currentMessage = messages.find(m => m._id === targetMessageId);
      if (currentMessage) {
        playedMessageIdsRef.current.add(targetMessageId);
        if (!currentMessage.isRead) {
          markMessageAsRead(currentMessage);
        }
        setPlayedMessageIds(new Set(playedMessageIdsRef.current));
      }
      
      // FIXED: Use the robust queue instead of the messages array for more reliable next message finding
      const queue = robustQueueRef.current;
      const currentMessageIndex = queue.messages.findIndex(m => m._id === targetMessageId);
      
      /*console.log('[skipToMessage] 🔍 Queue analysis:', {
        targetMessageId,
        currentMessageIndex,
        queueLength: queue.messages.length,
        queueMessageIds: queue.messages.map(m => m._id),
        isProcessing: queue.isProcessing
      });*/
      
      // SPECIAL CASE: Check if this is the last message in the robust queue
      const isLastMessageInQueue = currentMessageIndex === queue.messages.length - 1;
      
      if (isLastMessageInQueue) {
        //console.log('[skipToMessage] 🏁 LAST MESSAGE in queue - skipping means queue completion');
        
        // SURGICAL FIX: Properly stop current playback and clear all states before marking as read
        if (currentSound) {
          try {
            await currentSound.stopAsync();
            await currentSound.unloadAsync();
            setCurrentSound(null);
          } catch (error) {
            console.warn('[skipToMessage] ⚠️ Error stopping current sound:', error);
          }
        }
        
        // Clear all playback states immediately
        setIsPlaying(null);
        setCurrentMessageId(null);
        currentlyPlayingMessageIdRef.current = null;
        setIsPlayingMessage(false);
        
        // Ensure the target message is marked as read and played
        const currentMessage = messages.find(m => m._id === targetMessageId);
        if (currentMessage && !currentMessage.isRead) {
          markMessageAsRead(currentMessage);
        }
        playedMessageIdsRef.current.add(targetMessageId);
        setPlayedMessageIds(new Set(playedMessageIdsRef.current));
        
        // Clear the queue completely since we're done
        queue.messages = [];
        queue.isProcessing = false;
        queue.processingMessageId = null;
        
        // Also clear FastPlaybackManager queue to prevent replay
        fastPlaybackManager.clearQueue();
        
        //console.log('[skipToMessage] 🎯 Last message skipped, triggering end-of-queue logic');
        
        // Set flags for auto-recording logic
        autoRecordingStateRef.current.shouldTriggerAfterQueueComplete = true;
        autoRecordingStateRef.current.skipToLastMessage = true;
        
        // Trigger appropriate action based on user settings
        setTimeout(() => {
          if (autoRecordingEnabled && canAutoRecord('playback_ended')) {
            //console.log('[skipToMessage] 🎙️ Last message skipped - triggering auto-recording');
            triggerAutoRecording('playback_ended');
          } else if (!autoRecordingEnabled) {
            //console.log('[skipToMessage] 🔕 Last message skipped - auto-recording disabled');
            // User doesn't have auto-recording, so just mark as complete
            // The RecordingControls will handle showing manual recording options
          } else {
            //console.log('[skipToMessage] ⏸️ Last message skipped - auto-recording conditions not met');
          }
        }, 25);
        return;
      }
      
      // Check if this is a multiline skip (skipping to end or near end)
      const remainingMessages = queue.messages.length - currentMessageIndex - 1;
      const isMultilineSkip = remainingMessages > 1;
      
      if (isMultilineSkip) {
        //console.log('[skipToMessage] 🚀 Multi-message skip detected, using skipToLatest for robust marking');
        
        // ENHANCED: Use skipToLatest functionality for multi-message skips
        // This leverages the proven skipToLatest logic that properly marks all messages as read
        
        // First, build the queue from current message to end for FastPlaybackManager
        const remainingMessageIds = queue.messages
          .slice(currentMessageIndex)
          .map(message => message._id);
        
        /*console.log('[skipToMessage] 🎯 Using skipToLatest for multi-message skip:', {
          currentMessageId: targetMessageId,
          remainingMessageIds,
          totalToSkip: remainingMessageIds.length
        });*/
        
        // Use FastPlaybackManager's ultra-fast skip to latest functionality
        // This will mark all messages as read and trigger auto-recording appropriately
        fastPlaybackManager.ultraFastSkipToLatest({
          messageIds: remainingMessageIds,
          userId: user?.userId,
          batchSize: 5,
          onProgress: (processed, total) => {
            //console.log(`[skipToMessage] 📊 Multi-skip progress: ${processed}/${total}`);
          }
        });
        
        return;
      }
      
      // Single message skip - find the next message in the queue
      let nextMessage = null;
      if (currentMessageIndex !== -1 && currentMessageIndex < queue.messages.length - 1) {
        nextMessage = queue.messages[currentMessageIndex + 1];
      } else {
        // If not found in queue, look in messages array as fallback
        //console.log('[skipToMessage] 🔄 Falling back to messages array search');
        const currentIndex = messages.findIndex(m => m._id === targetMessageId);
        nextMessage = messages.slice(currentIndex + 1).find(m => 
          m.type === 'voice' && 
          m.senderId !== user?.userId &&
          !playedMessageIdsRef.current.has(m._id) &&
          !m.isRead
        );
      }
      
      // ENHANCED: Check if we're really at the last message by considering multiple scenarios
      const isReallyLastMessage = !nextMessage || 
        currentMessageIndex === queue.messages.length - 1 ||
        (currentMessageIndex !== -1 && queue.messages.length === 1);
      
      if (isReallyLastMessage) {
        //console.log('[skipToMessage] 🏁 CONFIRMED: This is the last unread message - triggering completion logic');
        
        // SURGICAL FIX: Properly stop current playback and clear all states before completing
        if (currentSound) {
          try {
            await currentSound.stopAsync();
            await currentSound.unloadAsync();
            setCurrentSound(null);
          } catch (error) {
            console.warn('[skipToMessage] ⚠️ Error stopping current sound:', error);
          }
        }
        
        // Clear all playback states immediately
        setIsPlaying(null);
        setCurrentMessageId(null);
        currentlyPlayingMessageIdRef.current = null;
        setIsPlayingMessage(false);
        
        // Ensure the target message is marked as read and played
        const currentMessage = messages.find(m => m._id === targetMessageId);
        if (currentMessage && !currentMessage.isRead) {
          markMessageAsRead(currentMessage);
        }
        playedMessageIdsRef.current.add(targetMessageId);
        setPlayedMessageIds(new Set(playedMessageIdsRef.current));
        
        // Clear the queue since we're done
        queue.messages = [];
        queue.isProcessing = false;
        queue.processingMessageId = null;
        
        // Also clear FastPlaybackManager queue to prevent replay
        fastPlaybackManager.clearQueue();
        
        // Set flags for auto-recording logic
        autoRecordingStateRef.current.shouldTriggerAfterQueueComplete = true;
        autoRecordingStateRef.current.skipToLastMessage = true;
        
        // Trigger appropriate action based on user settings
        setTimeout(() => {
          if (autoRecordingEnabled && canAutoRecord('playback_ended')) {
            //console.log('[skipToMessage] 🎙️ Last message skipped - triggering auto-recording');
            triggerAutoRecording('playback_ended');
          } else if (!autoRecordingEnabled) {
            //console.log('[skipToMessage] 🔕 Last message skipped - auto-recording disabled');
            // User doesn't have auto-recording, so just mark as complete
            // The RecordingControls will handle showing manual recording options
          } else {
            //console.log('[skipToMessage] ⏸️ Last message skipped - auto-recording conditions not met');
          }
        }, 100);
        return;
      }
      
      if (nextMessage) {
        //console.log('[skipToMessage] 🎵 Playing next message from queue:', nextMessage._id);
        
        // SAFETY CHECK: Verify the next message exists in the messages array
        const messageExists = messages.some(m => m._id === nextMessage._id);
        if (!messageExists) {
          console.error('[skipToMessage] ❌ Next message not found in messages array:', nextMessage._id);
          //console.log('[skipToMessage] 📝 No valid next message, treating as last message');
          
          // Clear the queue and trigger auto-recording (treat as last message)
          queue.messages = [];
          queue.isProcessing = false;
          queue.processingMessageId = null;
          
          // Set flags for auto-recording logic
          autoRecordingStateRef.current.shouldTriggerAfterQueueComplete = true;
          autoRecordingStateRef.current.skipToLastMessage = true;
          
          setTimeout(() => {
            if (autoRecordingEnabled && canAutoRecord('playback_ended')) {
              //console.log('[skipToMessage] 🎙️ Invalid next message - triggering auto-recording');
              triggerAutoRecording('playback_ended');
            } else if (!autoRecordingEnabled) {
              //console.log('[skipToMessage] 🔕 Invalid next message - auto-recording disabled');
            } else {
              //console.log('[skipToMessage] ⏸️ Invalid next message - auto-recording conditions not met');
            }
          }, 25);
          return;
        }
        
        // Remove the current message and all before it from the queue
        const nextMessageIndex = queue.messages.findIndex(m => m._id === nextMessage._id);
        if (nextMessageIndex > 0) {
          // Get messages to skip (all before the next message)
          const skippedMessages = queue.messages.filter((_, index) => index < nextMessageIndex);
          //console.log('[skipToMessage] 🚮 Removing skipped messages from queue:', skippedMessages.map(m => m._id));
          
          // Mark skipped messages as processed and read
          skippedMessages.forEach(msg => {
            queue.processedMessageIds.add(msg._id);
            playedMessageIdsRef.current.add(msg._id);
            if (!msg.isRead) {
              markMessageAsRead(msg).catch(error => console.error('[skipToMessage] Error marking skipped message as read:', error));
            }
          });
          setPlayedMessageIds(new Set(playedMessageIdsRef.current));
        }
        
        // Efficiently update queue to start from next message using filter
        queue.messages = queue.messages.filter((_, index) => index >= nextMessageIndex);
        /*console.log('[skipToMessage] 🎯 Queue after single skip filter:', {
          remainingCount: queue.messages.length,
          remainingIds: queue.messages.map(m => m._id)
        });*/
        queue.isProcessing = false;
        queue.processingMessageId = null;
        
        // Play the next message
        playMessage(nextMessage);
      }
    },
    seekMessage: (messageId: string, position: number) => seekMessage(messageId, position),
    formatTime,
    markMessageAsViewed
  };

  // Helper function to clear recording state without processing  
  const clearRecordingState = async (context: string) => {
    if (isRecording || currentRecording) {
      //console.log(`[${context}] 🛑 Stopping active recording`);
      try {
        // Stop the recording without processing it
        if (currentRecording) {
          // Check if recording is still valid before trying to unload
          try {
            // Try to get the status to see if it's still valid
            const status = await currentRecording.getStatusAsync();
            if (status.isRecording) {
              await currentRecording.stopAndUnloadAsync();
            } else {
              //console.log(`[${context}] ℹ️ Recording already stopped, skipping unload`);
            }
          } catch (statusError) {
            // If we can't get status, the recording is likely already unloaded
            //console.log(`[${context}] ℹ️ Recording appears to be already unloaded, skipping unload`);
          }
        }
        
        // Clear all recording state
        setCurrentRecording(null);
        setIsRecording(false);
        setRecordingDuration(0);
        setRecordingStartTime(0);
        setIsTranscribing(false);
        
        // Clear recording refs
        recordingStateRef.current.isRecording = false;
        recordingStateRef.current.lastRecordingTime = 0;
        
        // Clear recording locks
        recordingLockRef.current = false;
        isStartingRecordingRef.current = false;
        
        //console.log(`[${context}] ✅ Recording cleared successfully`);
      } catch (error) {
        // Handle the specific "already unloaded" error gracefully
        if (error instanceof Error && error.message.includes('already been unloaded')) {
          //console.log(`[${context}] ℹ️ Recording was already unloaded, clearing state only`);
        } else {
          console.error(`[${context}] ⚠️ Error clearing recording:`, error);
        }
        
        // Always clear the state regardless of error
        setCurrentRecording(null);
        setIsRecording(false);
        setRecordingDuration(0);
        setRecordingStartTime(0);
        setIsTranscribing(false);
        recordingStateRef.current.isRecording = false;
        recordingStateRef.current.lastRecordingTime = 0;
        recordingLockRef.current = false;
        isStartingRecordingRef.current = false;
      }
    }
    
    // Leave recording queue if user is in it
    if (socket && selectedChat && user?.userId) {
      const autoState = autoRecordingStateRef.current;
      if (autoState.isInRecordingQueue) {
        //console.log(`[${context}] 🚪 Leaving recording queue`);
        socket.emit('leave_recording_queue', {
          groupId: selectedChat._id,
          userId: user.userId
        });
        autoState.isInRecordingQueue = false;
        autoState.isWaitingForQueueGrant = false;
      }
      
      // CRITICAL FIX: If user was actively recording, emit recording_stop to give permission to next person
      if (isRecording) {
    
        socket.emit('recording_stop', {
          groupId: selectedChat._id,
          userId: user.userId,
          reason: 'user_left_group'
        });
      }
    }
    
    // Also reset auto-recording state to prevent issues when re-entering
    autoRecordingStateRef.current.isAutoRecordingInProgress = false;
    autoRecordingStateRef.current.autoRecordingTriggered = false;
    autoRecordingStateRef.current.lastAutoRecordTime = 0;
    autoRecordingStateRef.current.lastProcessingResetTime = 0;
    autoRecordingStateRef.current.shouldTriggerAfterQueueComplete = false;
    autoRecordingStateRef.current.shouldStartAfterPlayback = false; // CRITICAL FIX: Clear deferred recording flag
    
    //console.log(`[${context}] ✅ Auto-recording state also reset`);
  };



  const leaveGroupChat = async (groupId: string) => {
    if (!user || !user.userId) return;
    
    // RACE CONDITION PROTECTION: Check if already leaving this group
    if (leavingGroups.has(groupId)) {
      //console.log('[LeaveGroupChat] ⚠️ Already leaving this group, ignoring duplicate request');
      return;
    }
    
    //console.log('[LeaveGroupChat] ⚡ FAST leave process starting');
    
    // Mark group as being left to prevent concurrent operations
    setLeavingGroups(prev => new Set([...prev, groupId]));
    
    // Store original group state for potential reversion
    const groupToLeave = groupChats.find(chat => chat._id === groupId);
    if (!groupToLeave) {
      //console.log('[LeaveGroupChat] ⚠️ Group not found in local state');
      setLeavingGroups(prev => {
        const newSet = new Set(prev);
        newSet.delete(groupId);
        return newSet;
      });
      return;
    }
    
    // OPTIMIZATION: Optimistic update - immediately update UI
    //console.log('[LeaveGroupChat] ⚡ Removing group from UI instantly');
    setGroupChats(prevChats => prevChats.filter(chat => chat._id !== groupId));
    
    if (selectedChat && selectedChat._id === groupId) {
      setSelectedChat(null);
      setMessages([]);
    }
    
    // Clean up auto-recording state instantly
    //console.log('[LeaveGroupChat] ✅ Auto-recording state also reset');
    
    // Clean up socket state instantly
    if (socket) {
      socket.emit('leave_recording_queue', {
        groupId: groupId,
        userId: user.userId
      });
    }
    
    // Clear recording state instantly
    clearRecordingState('LeaveGroupChat').catch(() => {});
    
    //console.log('[LeaveGroupChat] ⚡ Instant UI update completed');
    
    // Make API call in background with proper error handling
    const apiUrl = `${API_URL}/groupchats/${groupId}/leave`;
    
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId: user.userId })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[LeaveGroupChat] API failed, reverting optimistic update');
        
        // Revert optimistic update only if group isn't already back in the list
        setGroupChats(prevChats => {
          const groupExists = prevChats.some(chat => chat._id === groupId);
          if (!groupExists) {
            return [...prevChats, groupToLeave];
          }
          return prevChats;
        });
        
        // Restore selected chat if it was the one we tried to leave
        if (selectedChat === null || selectedChat._id === groupId) {
          setSelectedChat(groupToLeave);
        }
        
        Alert.alert('Error', errorData.error || 'Failed to leave group chat');
      } else {
        //console.log('[LeaveGroupChat] ⚡ Server confirmed leave');
      }
    } catch (error) {
      console.error('[LeaveGroupChat] Network error:', error);
      
      // Revert on network error only if group isn't already back in the list
      setGroupChats(prevChats => {
        const groupExists = prevChats.some(chat => chat._id === groupId);
        if (!groupExists) {
          return [...prevChats, groupToLeave];
        }
        return prevChats;
      });
      
      // Restore selected chat if it was the one we tried to leave
      if (selectedChat === null || selectedChat._id === groupId) {
        setSelectedChat(groupToLeave);
      }
      
      Alert.alert('Error', 'Network error while leaving group');
    } finally {
      // Always clean up the leaving state
      setLeavingGroups(prev => {
        const newSet = new Set(prev);
        newSet.delete(groupId);
        return newSet;
      });
    }
  };

  // Manual unread check debug button
  const manualCheckUnread = async () => {
    const token = await AsyncStorage.getItem('accessToken');
    if (!user?.userId || !token) {
      if (__DEV__) {
        console.log('Debug: No user or token');
      }
      return;
    }
    try {
      const response = await fetch(`${API_URL}/group-chats/unread-count`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
              if (response.ok) {
          const data = await response.json();
          if (__DEV__) {
            console.log('Unread count:', data.totalUnread);
          }
        } else {
          const errorText = await response.text();
          if (__DEV__) {
            console.error('API error:', errorText);
          }
        }
      } catch (error) {
        if (__DEV__) {
          console.error('Error:', error);
        }
      }
  };

  // Update global gesture disable state when popup visibility changes
  useEffect(() => {
    setDisableTabGestures(showUnreadPopup);
  }, [showUnreadPopup, setDisableTabGestures]);

  // Check for unread messages on mount
  useEffect(() => {
    const checkUnread = async () => {
      if (hasShownUnreadPopup) return; // Only show once per app launch
      try {
        // Use AuthContext state instead of AsyncStorage to avoid race conditions
        if (!user?.userId || !accessToken) {
          setCheckingUnread(false);
          return;
        }
        const response = await fetch(`${API_URL}/group-chats/unread-count`, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        if (response.ok) {
          const data = await response.json();
          setUnreadCount(data.totalUnread || 0);
          if ((data.totalUnread || 0) > 0 && !hasShownUnreadPopup) {
            setShowUnreadPopup(true);
            setHasShownUnreadPopup(true);
            AsyncStorage.setItem('hasShownUnreadPopupGcTestDatabase', 'true');
          } else if ((data.totalUnread || 0) === 0) {
            setShowUnreadPopup(false); // Hide popup if no unread messages
            setHasShownUnreadPopup(false);
            AsyncStorage.setItem('hasShownUnreadPopupGcTestDatabase', 'false');
          }
        } else {
          // For new users or auth errors, just fail silently without triggering logout
          console.log('Unread count API returned non-OK status:', response.status);
        }
      } catch (error) {
        // Fail silently - don't let unread check errors affect authentication
        console.log('Unread check failed silently:', error);
      } finally {
        setCheckingUnread(false);
      }
    };
    checkUnread();
  }, [user, accessToken, hasShownUnreadPopup]);

  // On mount, load the flag from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem('hasShownUnreadPopupGcTestDatabase').then(val => {
      setHasShownUnreadPopup(val === 'true');
    });
  }, []);

  // When closing the popup, persist the flag
  const handleCloseUnreadPopup = () => {
    setShowUnreadPopup(false);
    setHasShownUnreadPopup(true);
    AsyncStorage.setItem('hasShownUnreadPopupGcTestDatabase', 'true');
  };

  // Add pan gesture handler for tab navigation
  const handleTabSwipe = (event: PanGestureHandlerGestureEvent) => {
    const velocityX = event.nativeEvent.velocityX;
    const threshold = 1000; // Velocity threshold

    if (Math.abs(velocityX) > threshold) {
      if (velocityX > 0) {
        // Swipe right
        handleBackPress();
      }
    }
  };

  // ROBUST QUEUE: Auto-playback system for unread messages
  useEffect(() => {
    // Only run if we have the required data
    if (!selectedChat || !messages.length || !user?.userId) {
      return;
    }

    // Wait for fetchMessages to complete before checking auto-playback conditions
    if (isLoadingMessages || currentFetchingGroupId === selectedChat._id) {
      return;
    }

    // Only analyze messages that are actually unread and from other users
    const unreadMessages = messages.filter(msg => {
      // Quick checks first for performance
      if (msg.senderId === user.userId) return false; // Skip own messages
      if (msg.groupChatId !== selectedChat._id) return false; // Skip wrong chat
      if (msg.type !== 'voice') return false; // Skip non-voice messages
      if (msg.isRead) return false; // Skip read messages
      if (robustQueueRef.current.processedMessageIds.has(msg._id)) return false; // Skip already processed
      if (robustQueueRef.current.messages.some(m => m._id === msg._id)) return false; // Skip already in queue
      
      return true;
    });

    if (unreadMessages.length > 0) {
      /*console.log('[ROBUST QUEUE EFFECT] 📝 Found unread messages:', {
        messageIds: unreadMessages.map(m => m._id),
        unreadCount: unreadMessages.length
      });*/

      // CRITICAL FIX: Sort unread messages by timestamp before adding to queue
      const sortedUnreadMessages = unreadMessages.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      /*console.log('[ROBUST QUEUE EFFECT] 📅 Sorted unread messages by timestamp:', {
        messageIds: sortedUnreadMessages.map(m => m._id),
        timestamps: sortedUnreadMessages.map(m => m.timestamp)
      });*/

      // Add messages to queue in chronological order
      let addedCount = 0;
      for (const message of sortedUnreadMessages) {
        if (addToRobustQueue(message)) {
          addedCount++;
        }
      }

      // Ensure queue processing starts immediately if we added messages
      if (addedCount > 0 && !robustQueueRef.current.isProcessing) {
        //console.log('[ROBUST QUEUE EFFECT] 🚀 Ensuring queue processing starts after adding messages');
        
        // Verify queue order after adding messages
        verifyQueueOrder();
        
        // Remove delay - start processing immediately
        //console.log('[ROBUST QUEUE EFFECT] 🎬 Forcing queue processing start');
        processRobustQueue();
      }
    }

    // PERFORMANCE OPTIMIZED: Use event-driven queue processing instead of polling
    // Removed aggressive 500ms interval that was causing high CPU usage
    // Queue processing now only happens when new messages arrive or state changes

    return () => {
      // PERFORMANCE OPTIMIZED: No intervals to clean up
    };
  }, [messages, selectedChat?._id, user?.userId, isLoadingMessages, currentFetchingGroupId]);

  // NEW ROBUST QUEUE SYSTEM - Core Functions
  const addToRobustQueue = (message: Message): boolean => {
    const queue = robustQueueRef.current;
    
    // Quick validation checks
    // CRITICAL FIX: Only skip own messages in 2-person chats, not 3+ person chats
    // In 3+ person chats, we need to queue own messages so other users can hear them
    const is2PersonChat = selectedChat && selectedChat.members && selectedChat.members.length === 2;
    if (message.senderId === user?.userId && is2PersonChat) {
      return false; // Don't add own messages in 2-person chats
    }
    if (queue.processedMessageIds.has(message._id)) return false; // Don't add if already processed
    if (queue.messages.some(m => m._id === message._id)) return false; // Don't add if already in queue
    if (message.isRead) return false; // Don't add already read messages
    
    // NEW: Don't add image or video messages to the audio playback queue
    if (message.type === 'image' || message.type === 'video') {
      /*console.log('[ROBUST QUEUE ADD] 📸🎥 Skipping image/video message - not adding to audio queue:', {
        messageId: message._id,
        messageType: message.type,
        mediaUrl: message.mediaUrl
      });*/
      
      // Mark as processed so it won't be added again
      queue.processedMessageIds.add(message._id);
      playedMessageIdsRef.current.add(message._id);
      
      // Mark as read/viewed for image/video messages
      if (!message.isRead && message.senderId !== user?.userId) {
        // Use setTimeout to avoid blocking the current execution
        setTimeout(async () => {
          try {
            await markMessageAsViewed(message);
            //console.log('[ROBUST QUEUE ADD] ✅ Marked image/video message as viewed:', message._id);
          } catch (error) {
            console.error('[ROBUST QUEUE ADD] ❌ Error marking image/video message as viewed:', error);
          }
        }, 0);
      }
      
      return false; // Don't add to queue
    }
    
    // Set user ID if not set
    if (!queue.userId) {
      queue.userId = user?.userId || null;
    }
    
    // Add message to queue in chronological order
    queue.messages.push(message);
    queue.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Mark recording as blocked since we have messages to play
    queue.blockedRecording = true;
    
    //console.log('[ROBUST QUEUE ADD] ✅ Added message to queue:', message._id);
    
    // Start processing immediately if not already processing and not currently playing
    if (!queue.isProcessing && !currentlyPlayingMessageIdRef.current) {
      processQueueSafely('addToRobustQueue');
    }
    
    return true;
  };

  const processRobustQueue = async () => {
    const queue = robustQueueRef.current;
    const autoState = autoRecordingStateRef.current;
    
    /*console.log('[ROBUST QUEUE PROCESS] 🔍 Starting queue processing:', {
      queueLength: queue.messages.length,
      queueMessageIds: queue.messages.map(m => m._id),
      isProcessing: queue.isProcessing,
      processingMessageId: queue.processingMessageId,
      isPlayingMessage,
      currentlyPlaying: currentlyPlayingMessageIdRef.current,
      isRecording,
      isInRecordingQueue: autoState.isInRecordingQueue,
      isWaitingForQueueGrant: autoState.isWaitingForQueueGrant
    });*/
    
    // CRITICAL FIX: Only block if user is ACTIVELY recording, not just waiting in queue
    // This fixes the deadlock where users waiting in recording queue can't hear messages
    if (isRecording && !autoState.isWaitingForQueueGrant) {
      //console.log('[ROBUST QUEUE PROCESS] ❌ User is actively recording, skipping queue processing');
      return;
    }
    
    // ALLOW MESSAGE PLAYBACK even when waiting in recording queue
    // This is critical for the queue system to work properly
    if (isRecording && autoState.isWaitingForQueueGrant) {
      //console.log('[ROBUST QUEUE PROCESS] ✅ User waiting in recording queue - allowing message playback');
    }
    
    // CRITICAL FIX: Prevent multiple simultaneous processing
    if (queue.isProcessing) {
      //console.log('[ROBUST QUEUE PROCESS] ⏸️ Already processing, skipping duplicate call');
      return;
    }
    
    // FIXED: Additional state validation to prevent conflicts during multilevel skipping
    if (processingStateRef.current.isProcessing) {
      //console.log('[ROBUST QUEUE PROCESS] ⏸️ Processing state indicates ongoing processing, skipping');
      return;
    }
    
    // FIXED: More intelligent playback state check that clears stale states
    const isActuallyPlaying = currentSound && currentlyPlayingMessageIdRef.current !== null;
    const isValidPlaybackState = isPlayingMessage && currentlyPlayingMessageIdRef.current !== null;

    if (isActuallyPlaying || isValidPlaybackState) {
      console.log('[ROBUST QUEUE PROCESS] ⏸️ Playback actually active, skipping:', {
        hasCurrentSound: !!currentSound,
        currentlyPlayingMessageId: currentlyPlayingMessageIdRef.current,
        isPlayingMessage
      });
      return;
    }

    // Clear any stale playback states before proceeding
    if (isPlaying !== null && !currentSound) {
      console.log('[ROBUST QUEUE PROCESS] 🧹 Clearing stale isPlaying state');
      setIsPlaying(null);
    }

    if (currentlyPlayingMessageIdRef.current !== null && !currentSound) {
      console.log('[ROBUST QUEUE PROCESS] 🧹 Clearing stale currentlyPlayingMessageId');
      currentlyPlayingMessageIdRef.current = null;
    }

    if (isPlayingMessage && !currentSound) {
      console.log('[ROBUST QUEUE PROCESS] 🧹 Clearing stale isPlayingMessage state');
      setIsPlayingMessage(false);
    }
    
    // SAFETY CHECK: Prevent infinite loops by checking retry count
    if (queue.retryCount >= queue.maxRetries) {
      //console.log('[ROBUST QUEUE PROCESS] 🚫 Max retries reached, clearing queue to prevent infinite loop');
      clearRobustQueue();
      return;
    }
    
    // FIXED: Only block if actively recording AND not waiting for queue grant
    // This allows message playback when user is waiting in recording queue
    if ((isRecording && !autoState.isWaitingForQueueGrant) || currentlyPlayingMessageIdRef.current !== null || isPlayingMessage) {
      /*console.log('[ROBUST QUEUE PROCESS] ⏸️ Cannot process - actively recording or playing:', {
        isRecording,
        isWaitingInQueue: autoState.isWaitingForQueueGrant,
        currentlyPlaying: currentlyPlayingMessageIdRef.current,
        isPlayingMessage
      });*/
      // FIXED: Use safe processing to prevent race conditions
      processQueueSafely('processRobustQueue_retry');
      return;
    }
    
    // Reset retry count when we successfully start processing
    queue.retryCount = 0;
    
    // Get next message
    const nextMessage = queue.messages[0];
    if (!nextMessage) {
      console.log('[ROBUST QUEUE PROCESS] ✅ Queue complete - no more messages');
      // Clean up processing state
      queue.isProcessing = false;
      queue.processingMessageId = null;
      queue.blockedRecording = false;
      queue.lastProcessedTime = Date.now();
      // NEW: Reset processing state ref
      processingStateRef.current.isProcessing = false;
      processingStateRef.current.processingMessageId = null;
      processingStateRef.current.lastProcessingResetTime = Date.now();
      
      // CRITICAL FIX: Clean up any remaining processed messages
      cleanupProcessedMessages();
      
      // CRITICAL: Trigger auto-recording when queue is completed
      console.log('[ROBUST QUEUE PROCESS] 🎙️ Queue completed, checking auto-recording conditions');
      
      setTimeout(() => {
        // LOGIC FIX: Consolidate auto-recording trigger to prevent double triggering
        const wasSkipTriggered = autoRecordingStateRef.current.shouldTriggerAfterQueueComplete;
        
        // Clear flags regardless of trigger source
        autoRecordingStateRef.current.shouldTriggerAfterQueueComplete = false;
        autoRecordingStateRef.current.skipToLastMessage = false;
        
        // NEW FIX: Check if someone is already recording before auto-recording (queue completion case)
        if (selectedChat && getRecordingUsers) {
          const recordingUsers = getRecordingUsers(selectedChat._id) || [];
          const currentUserId = user?.userId;
          const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
          
          if (otherRecordingUsers.length > 0) {
            console.log('[ROBUST QUEUE PROCESS] ❌ Someone else is recording, skipping auto-recording after queue completion:', {
              otherRecordingUsers,
              currentUserId
            });
            return;
          }
        }
        
        // CRITICAL FIX: For 3+ person chats, check if there are users in recording queue
        const is3PlusPersonChat = selectedChat && selectedChat.members && selectedChat.members.length > 2;
        if (is3PlusPersonChat) {
          // Check if current user is in recording queue and should start recording
          const autoState = autoRecordingStateRef.current;
          if (autoState.isInRecordingQueue && autoState.queuePosition === 1 && autoState.isWaitingForQueueGrant) {
            console.log('[ROBUST QUEUE PROCESS] 🎙️ User in position 1 of recording queue, starting recording after queue completion');
            
            // Clear queue state and start recording
            autoState.isInRecordingQueue = false;
            autoState.isWaitingForQueueGrant = false;
            autoState.queuePosition = 0;
            autoState.lastAutoRecordTime = Date.now();
            
            // Notify server to remove from queue
            if (socket) {
              socket.emit('leave_recording_queue', {
                groupId: selectedChat._id,
                userId: user?.userId
              });
            }
            
            // Start recording directly
            setIsRecording(true);
            startRecording().catch(error => {
              console.error('[ROBUST QUEUE PROCESS] ❌ Failed to start recording after queue completion:', error);
              setIsRecording(false);
            });
            return;
          } else {
            console.log('[ROBUST QUEUE PROCESS] 👥 3+ person chat - no user in position 1 of queue, skipping auto-recording');
            return;
          }
        }
        
        // Single auto-recording check and trigger
        if (canAutoRecord()) {
          console.log('[ROBUST QUEUE PROCESS] ✅ Auto-recording conditions met, triggering auto-recording', {
            wasFromSkip: wasSkipTriggered,
            triggerSource: wasSkipTriggered ? 'skip_functionality' : 'queue_completion'
          });
          triggerAutoRecording('queue_completed');
        } else {
          console.log('[ROBUST QUEUE PROCESS] ❌ Auto-recording conditions not met, skipping auto-recording', {
            wasFromSkip: wasSkipTriggered
          });
        }
      }, 10); // Reduced from 25ms to 10ms for faster blocking
      
      return;
    }

    // CRITICAL FIX: Skip playback if the message is already read
    if (nextMessage.isRead) {
      queue.processedMessageIds.add(nextMessage._id);
      playedMessageIdsRef.current.add(nextMessage._id);
      queue.messages.shift();
      queue.isProcessing = false;
      queue.processingMessageId = null;
          processingStateRef.current.isProcessing = false;
    processingStateRef.current.processingMessageId = null;
    processQueueSafely('processRobustQueue_readMessage');
    return;
    }
    
    /*console.log('[ROBUST QUEUE PROCESS] 🎵 Next message to process:', {
      messageId: nextMessage._id,
      senderId: nextMessage.senderId,
      isRead: nextMessage.isRead,
      hasAudioUrl: !!nextMessage.audioUrl,
      messageType: nextMessage.type
    });*/
    
    // NEW: Skip image and video messages - they don't have audio URLs and shouldn't be in the playback queue
    if (nextMessage.type === 'image' || nextMessage.type === 'video') {
      /*console.log('[ROBUST QUEUE PROCESS] 📸🎥 Skipping image/video message in queue:', {
        messageId: nextMessage._id,
        messageType: nextMessage.type,
        mediaUrl: nextMessage.mediaUrl
      });*/
      
      // Mark as processed and remove from queue
      queue.processedMessageIds.add(nextMessage._id);
      playedMessageIdsRef.current.add(nextMessage._id);
      
      // Mark as read/viewed for image/video messages
      if (!nextMessage.isRead && nextMessage.senderId !== user?.userId) {
        try {
          await markMessageAsViewed(nextMessage);
          //console.log('[ROBUST QUEUE PROCESS] ✅ Marked image/video message as viewed:', nextMessage._id);
        } catch (error) {
          console.error('[ROBUST QUEUE PROCESS] ❌ Error marking image/video message as viewed:', error);
        }
      }
      
      // Remove from queue and continue processing
      queue.messages.shift();
      queue.isProcessing = false;
      queue.processingMessageId = null;
      processingStateRef.current.isProcessing = false;
      processingStateRef.current.processingMessageId = null;
      
      // Continue processing next message
      setTimeout(() => processRobustQueue(), 0);
      return;
    }
    
    // CRITICAL FIX: Check if this message is already being processed
    if (queue.processingMessageId === nextMessage._id) {
      //console.log('[ROBUST QUEUE PROCESS] ⏸️ Message already being processed:', nextMessage._id);
      return;
    }
    
    // FIXED: Set processing state before starting to prevent race conditions
    queue.isProcessing = true;
    queue.processingMessageId = nextMessage._id;
    processingStateRef.current.isProcessing = true;
    processingStateRef.current.processingMessageId = nextMessage._id;
    
    //console.log('[ROBUST QUEUE PROCESS] 🔄 Set processing state for message:', nextMessage._id);
    
    // CRITICAL FIX: Add delay before processing to prevent immediate playback
    // This ensures the receiving user has time to see the message before it plays
    const processingDelay = 500; // Reduced from 2000ms to 500ms for faster processing
    console.log(`[ROBUST QUEUE PROCESS] Adding ${processingDelay}ms delay before processing message:`, nextMessage._id);
    
    setTimeout(async () => {
      // Re-check if we should still process this message
      if (!queue.isProcessing || queue.processingMessageId !== nextMessage._id) {
        console.log('[ROBUST QUEUE PROCESS] Processing already cancelled, skipping delayed processing');
        return;
      }
      
      try {
        // Mark as processed immediately to prevent re-queueing
        queue.processedMessageIds.add(nextMessage._id);
        playedMessageIdsRef.current.add(nextMessage._id);
        
        // Check if message has audio URL, if not wait for it with aggressive retry
        if (!nextMessage.audioUrl || !validateAudioUrl(nextMessage.audioUrl)) {
          //console.log('[ROBUST QUEUE PROCESS] ⏳ Waiting for audio URL:', nextMessage._id);
          
          // Try to get audio URL with aggressive retry
          let audioUrl = null;
          let attempts = 0;
          const maxAttempts = 10;
          
          while (!audioUrl && attempts < maxAttempts) {
            try {
              audioUrl = await getAudioUrl(nextMessage._id);
              if (audioUrl && validateAudioUrl(audioUrl)) {
                nextMessage.audioUrl = audioUrl;
                break;
              }
            } catch (error) {
              //console.log('[ROBUST QUEUE PROCESS] Audio URL attempt failed:', attempts + 1, error);
            }
            
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 5)); // Reduced from 10ms to 5ms for faster audio URL retrieval
            }
          }
          
          if (!audioUrl || !validateAudioUrl(audioUrl)) {
            //console.log('[ROBUST QUEUE PROCESS] ❌ Failed to get audio URL after attempts:', nextMessage._id);
            // Mark as processed and continue to next message
            queue.isProcessing = false;
            queue.processingMessageId = null;
            processingStateRef.current.isProcessing = false;
            processingStateRef.current.processingMessageId = null;
            
            // Clear processing timeout
            if (queue.processingTimeout) {
              clearTimeout(queue.processingTimeout);
              queue.processingTimeout = null;
            }
            
            // Remove from queue since we can't play it
            queue.messages.shift();
            
            // Increment retry count for audio URL failure
            queue.retryCount++;
            /*console.log('[ROBUST QUEUE PROCESS] 🔄 Incremented retry count for audio URL failure:', {
              retryCount: queue.retryCount,
              maxRetries: queue.maxRetries
            });*/
            
            setTimeout(() => processRobustQueue(), 0); // Reduced from 10ms to 0ms for immediate processing
            return;
          }
        }
        
        // Play the message - DON'T await this since playMessage just starts playback
        // The completion will be handled by onPlaybackStatusUpdate
        playMessage(nextMessage).catch(error => {
          console.error('[ROBUST QUEUE PROCESS] ❌ Error starting playback for message:', nextMessage._id, error);
          
          // Mark as processed even on error to prevent infinite retry
          queue.processedMessageIds.add(nextMessage._id);
          
          // Reset processing state and continue immediately
          queue.isProcessing = false;
          queue.processingMessageId = null;
          processingStateRef.current.isProcessing = false;
          processingStateRef.current.processingMessageId = null;
          
          // Clear processing timeout
          if (queue.processingTimeout) {
            clearTimeout(queue.processingTimeout);
            queue.processingTimeout = null;
          }
          
          // Remove from queue since playback failed
          queue.messages.shift();
          
          // Increment retry count for actual processing failure
          queue.retryCount++;
          /*console.log('[ROBUST QUEUE PROCESS] 🔄 Incremented retry count for playback failure:', {
            retryCount: queue.retryCount,
            maxRetries: queue.maxRetries
          });*/
          
          // Continue with next message immediately
          setTimeout(() => processRobustQueue(), 0); // Reduced from 10ms to 0ms for immediate processing
        });
        
        // Mark the message as read immediately after starting playback
        if (markMessageAsViewed) {
          try {
            await markMessageAsViewed(nextMessage);
          } catch (error) {
            console.warn('[ROBUST QUEUE PROCESS] Error marking message as viewed:', error);
          }
        }
        
        // Don't reset processing state here - let onPlaybackStatusUpdate handle it
        // when the message finishes playing
        
        //console.log('[ROBUST QUEUE PROCESS] ✅ Message processing started successfully:', nextMessage._id);
        
      } catch (error) {
        console.error('[ROBUST QUEUE PROCESS] ❌ Error processing message:', nextMessage._id, error);
        
        // Mark as processed even on error to prevent infinite retry
        queue.processedMessageIds.add(nextMessage._id);
        
        // Reset processing state and continue immediately
        queue.isProcessing = false;
        queue.processingMessageId = null;
        processingStateRef.current.isProcessing = false;
        processingStateRef.current.processingMessageId = null;
        
        // Remove from queue since processing failed
        queue.messages.shift();
        
        // Increment retry count for general processing failure
        queue.retryCount++;
        /*console.log('[ROBUST QUEUE PROCESS] 🔄 Incremented retry count for general failure:', {
          retryCount: queue.retryCount,
          maxRetries: queue.maxRetries
        });*/
        
        // Continue with next message immediately
        setTimeout(() => processRobustQueue(), 0); // Reduced from 10ms to 0ms for immediate processing
      }
    }, processingDelay);
  };

  const clearRobustQueue = () => {
    const queue = robustQueueRef.current;
    
    // Clear all messages
    queue.messages = [];
    queue.isProcessing = false;
    queue.processingMessageId = null;
    queue.blockedRecording = false;
    queue.lastProcessedTime = Date.now();
    queue.retryCount = 0;
    
    // Clear processing timeout
    if (queue.processingTimeout) {
      clearTimeout(queue.processingTimeout);
      queue.processingTimeout = null;
    }
    
    // Reset processing state ref
    processingStateRef.current.isProcessing = false;
    processingStateRef.current.processingMessageId = null;
    processingStateRef.current.lastProcessingResetTime = Date.now();
  };

  // NEW: Clean up processed messages from queue
  const cleanupProcessedMessages = () => {
    const queue = robustQueueRef.current;
    const originalLength = queue.messages.length;
    
    // Remove messages that have been processed or are already read
    queue.messages = queue.messages.filter(msg => 
      !queue.processedMessageIds.has(msg._id) && 
      !playedMessageIdsRef.current.has(msg._id) &&
      !msg.isRead // Also remove messages that are already read
    );
    
    const removedCount = originalLength - queue.messages.length;
    if (removedCount > 0) {
      /*console.log('[ROBUST QUEUE] 🧹 Cleaned up processed messages:', {
        removedCount,
        remainingCount: queue.messages.length,
        processedIdsCount: queue.processedMessageIds.size
      });*/
    }
    
    // CRITICAL FIX: Check if queue is truly empty after cleanup
    if (queue.messages.length === 0 && queue.isProcessing) {
      //console.log('[ROBUST QUEUE] 🎯 Queue empty after cleanup - triggering completion');
      queue.isProcessing = false;
      queue.processingMessageId = null;
      queue.blockedRecording = false;
      queue.lastProcessedTime = Date.now();
      processingStateRef.current.isProcessing = false;
      processingStateRef.current.processingMessageId = null;
      
      // Trigger auto-recording when queue is truly completed
      setTimeout(() => {
        if (canAutoRecord('queue_completed')) {
          //console.log('[ROBUST QUEUE] 🎙️ Triggering auto-recording after queue completion');
          triggerAutoRecording('queue_completed');
        }
      }, 25);
    }
  };

  // DEBUG: Add queue status monitoring
  const debugQueueStatus = () => {
    const queue = robustQueueRef.current;
    /*console.log('[ROBUST QUEUE DEBUG] Status:', {
      blockedRecording: queue.blockedRecording,
      currentUserId: user?.userId,
      isPlayingMessage,
      isProcessing: queue.isProcessing,
      isRecording,
      messages: queue.messages.map(m => ({
        id: m._id,
        sender: m.senderId,
        timestamp: m.timestamp
      })),
      processedCount: queue.processedMessageIds.size,
      processingMessageId: queue.processingMessageId,
      queueLength: queue.messages.length,
      userId: queue.userId
    });*/
  };

  // DEBUG: Verify queue order
  const verifyQueueOrder = () => {
    const queue = robustQueueRef.current;
    if (queue.messages.length < 2) return true; // No need to verify single message
    
    const isOrdered = queue.messages.every((message, index) => {
      if (index === 0) return true;
      const prevMessage = queue.messages[index - 1];
      return new Date(message.timestamp).getTime() >= new Date(prevMessage.timestamp).getTime();
    });
    
    if (!isOrdered) {
      console.warn('[ROBUST QUEUE DEBUG] ⚠️ Queue order issue detected:', {
        messages: queue.messages.map((m, index) => ({
          index,
          messageId: m._id,
          timestamp: m.timestamp,
          senderId: m.senderId
        }))
      });
    }
    
    return isOrdered;
  };

  const clearQueue = () => {
    clearRobustQueue();
    
    // Clear any other queue-related state
    if (queueTimeoutRef.current) {
      clearTimeout(queueTimeoutRef.current);
      queueTimeoutRef.current = null;
    }
    
    // Reset processing states
    isQueueProcessingRef.current = false;
    isProcessingRef.current = false;
    setIsPlayingMessage(false);
    currentlyPlayingMessageIdRef.current = null;
  };

  const removeFromQueue = (messageId: string) => {
    const queue = robustQueueRef.current;
    
    const index = queue.messages.findIndex(m => m._id === messageId);
    if (index !== -1) {
      queue.messages.splice(index, 1);
      queue.processedMessageIds.add(messageId);
      console.log('[QUEUE] ✅ Removed message from queue:', messageId, 'remaining:', queue.messages.length);
    } else {
      console.log('[QUEUE] ⚠️ Message not found in queue for removal:', messageId);
    }
  };

  const resetRobustQueueForNewChat = () => {
    const queue = robustQueueRef.current;
    
    queue.messages = [];
    queue.isProcessing = false;
    queue.processingMessageId = null;
    queue.blockedRecording = false;
    queue.lastProcessedTime = Date.now();
    queue.processedMessageIds.clear(); // Clear for new chat
    queue.retryCount = 0; // Reset retry count
    
    // Clear processing timeout
    if (queue.processingTimeout) {
      clearTimeout(queue.processingTimeout);
      queue.processingTimeout = null;
    }
    
    queue.userId = user?.userId || null;
    
    // CRITICAL: Reset ALL auto-recording state for new chat
    autoRecordingStateRef.current.hasAutoRecordedInThisChat = false;
    autoRecordingStateRef.current.isWaitingForQueueCompletion = false;
    autoRecordingStateRef.current.lastAutoRecordTime = 0;
    autoRecordingStateRef.current.isAutoRecordingInProgress = false;
    autoRecordingStateRef.current.autoRecordingTriggered = false;
    autoRecordingStateRef.current.lastProcessingResetTime = 0;
    autoRecordingStateRef.current.shouldTriggerAfterQueueComplete = false;
    autoRecordingStateRef.current.shouldStartAfterPlayback = false; // CRITICAL FIX: Clear deferred recording flag
    autoRecordingStateRef.current.pendingAutoRecordingAfterReset = false;
    autoRecordingStateRef.current.pendingAutoRecordingReason = null;
  };

  // Enhanced real-time message processing with immediate response
  useEffect(() => {
    if (!socket || !user?.userId || !selectedChat) return;

    const handleRealTimeMessage = (message: Message) => {
      if (message.groupChatId === selectedChat?._id && message.senderId !== user?.userId) {
        
        // CRITICAL FIX: Prevent duplicate message processing using existing played messages tracking
        const queue = robustQueueRef.current;
        if (
          playedMessageIdsRef.current.has(message._id) ||                // already played
          queue.processedMessageIds.has(message._id) ||                  // already processed
          queue.messages.some(m => m._id === message._id)                // already queued
        ) {
          console.log('[ROBUST QUEUE] ⚠️ Skipping already processed message:', message._id);
          return;
        }        
        // EDGE CASE FIX: If someone is recording, skip playback and mark as read immediately
        const isAnyoneRecordingInChat = getRecordingUsers && getRecordingUsers(selectedChat._id) && getRecordingUsers(selectedChat._id).length > 0;
        
        // NEW: Check if this user is currently recording (the one who just started recording)
        const isCurrentUserRecording = isRecording;
        
        // ENHANCED EDGE CASE: Handle the scenario where User A stops recording and User B starts recording
        // In this case, User A's message should be marked as read without playing audio
        if (isAnyoneRecordingInChat || isCurrentUserRecording) {
          // CRITICAL FIX: Allow ScalableQueue to handle the message instead of bypassing it
          // The ScalableQueue will handle playback and auto-recording properly
          const added = addToRobustQueue(message);
          if (added) {
            // Start processing immediately for real-time responsiveness
            setTimeout(() => {
              processRobustQueue();
            }, 0);
          }
          
          return;
        }
        
        // ENHANCED: Normal flow - Add to queue for playback and process immediately
        const added = addToRobustQueue(message);
        if (added) {
          // CRITICAL FIX: Only update auto-recording state for the RECEIVER, not the sender
          // The sender's recording state should not be affected by playback of their own message
          const autoState = autoRecordingStateRef.current;
          const isAnyoneInRecordingQueue = autoState.isInRecordingQueue || autoState.isWaitingForQueueGrant;
          
          // Check if this is an active concurrent chat (both users recently active)
          const isActiveConcurrentChat = selectedChat && selectedChat.members && selectedChat.members.length === 2;
          const recentActivityThreshold = 30000; // 30 seconds
          const hasRecentActivity = autoState.lastAutoRecordTime > 0 && 
            (Date.now() - autoState.lastAutoRecordTime) < recentActivityThreshold;
          
          // CRITICAL FIX: Only reset flags for the RECEIVER (not the sender)
          // This ensures the sender's recording state is not affected by playback of their own message
          if (message.senderId !== user?.userId) { // Only for receiver
            // Only reset flags if:
            // 1. No one is in recording queue AND
            // 2. Either not a 2-person chat OR no recent auto-recording activity
            if (!isAnyoneInRecordingQueue && (!isActiveConcurrentChat || !hasRecentActivity)) {
              autoState.hasAutoRecordedInThisChat = false;
              autoState.isAutoRecordingInProgress = false;
              autoState.autoRecordingTriggered = false;
            }
          }
          
          // ENHANCED: Start processing immediately for real-time responsiveness
          // This ensures unread messages are played before any recording grants are processed
          processQueueSafely('handleRealTimeMessage');
          
          // Add debug logging to help diagnose playback issues
          setTimeout(() => {
            console.log('[DEBUG] Playback states after processQueueSafely:', {
              isPlaying,
              isPlayingMessage,
              currentlyPlayingMessageId: currentlyPlayingMessageIdRef.current,
              hasCurrentSound: !!currentSound,
              queueLength: robustQueueRef.current.messages.length,
              isProcessing: robustQueueRef.current.isProcessing
            });
          }, 100);
        }
      }
    };

    // Listen for new messages
    socket.on('new_message', handleRealTimeMessage);

    return () => {
      socket.off('new_message', handleRealTimeMessage);
    };
  }, [socket, user?.userId, selectedChat?._id, isRecording]);

  // PERFORMANCE OPTIMIZED: Removed 2-second polling for stuck messages
  // Queue monitoring now uses event-driven approach instead of polling
  // This eliminates constant CPU usage from the monitoring interval

  // FIXED: Stable data transformation to prevent FlatList flickering
  const stableMessagesData = useMemo(() => {
    if (!messages) return [];
    return messages.map(msg => ({
      ...msg,
      senderName: selectedChat?.members.find(m => m.userId === msg.senderId)?.name || 'Unknown User',
    }));
  }, [messages, selectedChat?.members]);

  // BULLETPROOF: Listen for socket events related to recording and queue management
  useEffect(() => {
    if (!socket) return;

    const handleRecordingRejected = (data: { groupId: string; reason: string; currentRecordingUsers: string[] }) => {
      
      // Clean up local recording state immediately
      if (isRecording || currentRecording) {
        
        // Stop and clean up the recording
        if (currentRecording) {
          currentRecording.stopAndUnloadAsync().catch(error => {
            console.warn('[RECORDING] Error stopping recording after rejection:', error);
          });
        }
        
        // Reset all recording states
        setIsRecording(false);
        setCurrentRecording(null);
        setRecordingDuration(0);
        setRecordingStartTime(0);
        setIsTranscribing(false);
        
      }
      // CRITICAL FIX: For 3+ person group chats, add user to the queue if blocked
      if (selectedChat && user?.userId && selectedChat.members && selectedChat.members.length > 2 && socket) {
        const currentUser = selectedChat.members.find((member: any) => member.userId === user.userId);
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
    };

    // BULLETPROOF: Handle queue updates for auto-recording AND manual recording state management
    const handleQueueUpdate = (data: { groupId: string; queue: Array<{ userId: string; userName: string; position: number; isAutoRecording: boolean }> }) => {
      if (!selectedChat || data.groupId !== selectedChat._id || !user?.userId) return;
      
      const autoState = autoRecordingStateRef.current;
      const userInQueue = data.queue.find(queueUser => queueUser.userId === user.userId);
      
      // OPTIMIZED: Immediate state updates without complex logic
      if (userInQueue) {
        // Update queue state for both auto-recording and manual recording users
        autoState.isInRecordingQueue = true;
        autoState.queuePosition = userInQueue.position;
        autoState.lastQueueStateCheck = Date.now();
        
        // For auto-recording users, set the waiting flag
        if (userInQueue.isAutoRecording && autoRecordingEnabled) {
          autoState.isWaitingForQueueGrant = true;
        }
        
      } else if (autoState.isInRecordingQueue) {
        // User was removed from queue - IMMEDIATE CLEANUP
        autoState.isInRecordingQueue = false;
        autoState.queuePosition = 0;
        autoState.isWaitingForQueueGrant = false;
        
      }
    };

    // REQUIREMENT 4: Handle recording grants for auto-recording AND manual recording
    const handleRecordingGranted = (data: { groupId: string; userId: string }) => {
      if (!selectedChat || data.groupId !== selectedChat._id || data.userId !== user?.userId) return;
      
      const autoState = autoRecordingStateRef.current;
      let shouldStartRecording = false;
      let recordingType = 'unknown';
      
      // ENHANCED: Check for unread messages that need to be played back BEFORE starting recording
      const unreadMessages = messages.filter(msg => {
        if (msg.senderId === user?.userId) return false; // Skip own messages
        if (msg.groupChatId !== selectedChat._id) return false; // Skip wrong chat
        if (msg.type !== 'voice') return false; // Skip non-voice messages
        if (msg.isRead) return false; // Skip read messages
        if (playedMessageIdsRef.current.has(msg._id)) return false; // Skip already played messages
        return true;
      });
      
      // Check robust queue for pending messages from other users
      const robustQueue = robustQueueRef.current;
      
      // NEW: Clean up processed messages before checking queue state
      cleanupProcessedMessages();
      
      // CRITICAL FIX: Filter out already processed messages from queue length check
      const actualPendingMessages = robustQueue.messages.filter(msg => 
        !robustQueue.processedMessageIds.has(msg._id) && 
        !playedMessageIdsRef.current.has(msg._id)
      );
      
      const hasPendingMessages = actualPendingMessages.length > 0 || unreadMessages.length > 0;
      

      
      // CRITICAL FIX: Check playback state BEFORE scenario determination for 3+ person chats
      const is3PlusPersonChat = selectedChat && selectedChat.members && selectedChat.members.length > 2;
      const isAnyPlaybackActive = (
        isPlayingMessage || 
        currentlyPlayingMessageIdRef.current !== null || 
        isProcessingRef.current ||
        robustQueueRef.current.isProcessing ||
        robustQueueRef.current.messages.length > 0 ||
        currentSound !== null ||
        isPlaying !== null
      );
      

      
      // ENHANCED: For 3+ person chats with active playback OR pending messages, defer recording
      if (is3PlusPersonChat && (isAnyPlaybackActive || hasPendingMessages)) {
        // CRITICAL FIX: Keep user in queue instead of blocking or setting deferred flags
        // Do NOT set isWaitingForQueueGrant, isInRecordingQueue, queuePosition, shouldStartAfterPlayback, or lastAutoRecordTime here

        if (hasPendingMessages) {
          setTimeout(() => processRobustQueue(), 0);
        } else {
  
        }

        return; // Don't start recording, but keep user in queue
      }
      
      // CRITICAL FIX: For 2-person chats, also defer if there are pending messages
      if (!is3PlusPersonChat && hasPendingMessages) {

        autoState.isWaitingForQueueGrant = true;
        autoState.isInRecordingQueue = true;
        autoState.queuePosition = 1;
        autoState.shouldStartAfterPlayback = true;
        autoState.lastAutoRecordTime = Date.now();
        
        // Trigger robust queue processing to play pending messages
        setTimeout(() => processRobustQueue(), 0);
        return; // Don't start recording, wait for messages to finish
      }
      
      // FIXED: Additional comprehensive check to ensure queue is truly empty
      const isQueueTrulyEmpty = (
        !isAnyPlaybackActive && 
        !hasPendingMessages && 
        robustQueue.messages.length === 0 && 
        !robustQueue.isProcessing &&
        !isProcessingRef.current &&
        currentlyPlayingMessageIdRef.current === null &&
        !isPlayingMessage &&
        currentSound === null &&
        isPlaying === null
      );
      
      // ENHANCED: Also check ScalableQueue state to prevent premature recording grants
      const isScalableQueueProcessing = (window as any).scalableQueueProcessing || false;
      const isQueueCompletelyEmpty = isQueueTrulyEmpty && !isScalableQueueProcessing;
      
      if (!isQueueCompletelyEmpty) {
        return; // Don't start recording, wait for all queues to be completely empty
      }
      
      // SCENARIO 1: Auto-recording user with proper queue state (no playback active)
      if (autoState.isWaitingForQueueGrant && autoState.isInRecordingQueue && autoRecordingEnabled) {
        // CRITICAL FIX: Don't start recording here for auto-recording users
        // Let the auto-recording system handle the actual recording start

        shouldStartRecording = false;
        recordingType = 'auto-recording-deferred';
      }
      // SCENARIO 2: Manual recording user with proper queue state (no playback active)
      else if (autoState.isInRecordingQueue && !autoState.isWaitingForQueueGrant) {
        shouldStartRecording = true;
        recordingType = 'manual-recording';

      }
      // SCENARIO 3: Queue progression in 3+ person chats (no playback active)
      else if (autoState.isInRecordingQueue) {
        shouldStartRecording = true;
        recordingType = 'queue-progression';

      }
      // SCENARIO 4: Transfer scenario - ONLY for 2-person chats
      else {
        if (is3PlusPersonChat) {

          shouldStartRecording = false;
          recordingType = 'blocked-unexpected';
        } else {
          // FIXED: Only allow transfer scenarios for 2-person chats

          shouldStartRecording = true;
          recordingType = 'transfer';
          
          // Reset queue state to prevent future issues
          autoState.isInRecordingQueue = false;
          autoState.isWaitingForQueueGrant = false;
          autoState.queuePosition = 0;
        }
      }
      

      
      // CRITICAL FIX: For auto-recording users who received a grant, trigger auto-recording
      if (recordingType === 'auto-recording-deferred' && autoRecordingEnabled) {

        
        // IMMEDIATE CHECK: Verify recording state is clean before proceeding
        const recordingUsers = getRecordingUsers(selectedChat._id) || [];
        const currentUserId = user?.userId;
        const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
        
        // IMMEDIATE TRIGGER: If no one else is recording and queue is truly empty, trigger immediately
        if (otherRecordingUsers.length === 0 && isQueueCompletelyEmpty) {

          triggerAutoRecording('playback_ended');
        } else {
          // FIXED: Instead of resetting and retrying immediately, wait for server state update

          resetRecordingState(selectedChat._id);
          
          // Set a flag to trigger auto-recording when we receive the reset confirmation
          autoState.pendingAutoRecordingAfterReset = true;
          autoState.pendingAutoRecordingReason = 'playback_ended';
          
          // Set a timeout to prevent infinite waiting (5 seconds max)
          setTimeout(() => {
            if (autoState.pendingAutoRecordingAfterReset) {
              autoState.pendingAutoRecordingAfterReset = false;
              autoState.pendingAutoRecordingReason = null;
            }
          }, 5000);
        }
        return; // Don't proceed with manual recording start
      }
    };

    // BULLETPROOF: Handle recording ended events for queue progression
    const handleRecordingEnded = (data: { groupId: string; userId: string }) => {
      if (!selectedChat || data.groupId !== selectedChat._id) return;
      
      const autoState = autoRecordingStateRef.current;
      
      // If this was our recording that ended, update auto-recording state
      if (data.userId === user?.userId) {
        
        // CRITICAL: Set lastAutoRecordTime to prevent back-to-back auto-recording
        // STRENGTHENED: Always set this for ANY recording end to prevent back-to-back
        autoState.lastAutoRecordTime = Date.now();
        autoState.isAutoRecordingInProgress = false;
        autoState.autoRecordingTriggered = false;
        autoState.isInRecordingQueue = false;
        autoState.isWaitingForQueueGrant = false;
        autoState.shouldStartAfterPlayback = false; // CRITICAL FIX: Clear deferred recording flag
        
        // ENHANCED: Use proper cooldown duration based on chat type
        const is2PersonChat = selectedChat && selectedChat.members && selectedChat.members.length === 2;
        const cooldownDuration = is2PersonChat ? 20000 : 10000; // 20 seconds for 2-person chats, 10 seconds for others
        
      }
    };

    // Handle recording state updates from server - OPTIMIZED for instant response
    const handleRecordingStateUpdate = (data: { groupId: string; recordingUsers: string[]; isAnyoneRecording: boolean; stoppedBy?: string; resetBy?: string; startedBy?: string }) => {
      // If the current user initiated the state change, ignore the echo from the server
      // to prevent race conditions and trust the client's immediate state.
      if (data.startedBy === user?.userId || data.stoppedBy === user?.userId) {
        console.log('[RECORDING STATE UPDATE] 🙉 Ignoring echo for own action.');
        return;
      }

      if (!selectedChat || data.groupId !== selectedChat._id) return;
      
      // CRITICAL FIX: Ignore stale recording state updates for current user
      if (data.recordingUsers.includes(user?.userId || '') && !isRecording && !isStartingRecordingRef.current) {
        console.log('[RECORDING STATE UPDATE] 🚫 Ignoring potentially stale recording state update:', {
          currentUserId: user?.userId,
          groupId: data.groupId,
          recordingUsers: data.recordingUsers,
          reason: 'current_user_in_recording_list_without_stop_event'
        });
        return;
      }
      
      // ADD DEBUG LOGGING TO TRACK RECORDING STATE UPDATES
      console.log('[RECORDING STATE UPDATE] 📡 Received recording state update:', {
        groupId: data.groupId,
        recordingUsers: data.recordingUsers,
        isAnyoneRecording: data.isAnyoneRecording,
        stoppedBy: data.stoppedBy,
        resetBy: data.resetBy,
        currentUserId: user?.userId,
        currentlyRecording: isRecording,
        recordingStartTime: recordingStartTime,
        timeSinceRecordingStart: recordingStartTime ? Date.now() - recordingStartTime : 'N/A'
      });
      
      // FIXED: Handle recording state reset and trigger pending auto-recording
      if (data.resetBy && data.recordingUsers.length === 0 && !data.isAnyoneRecording) {
        console.log('[RECORDING STATE] ✅ Recording state reset confirmed by server');
        
        // Check if we have pending auto-recording after reset
        const autoState = autoRecordingStateRef.current;
        if (autoState.pendingAutoRecordingAfterReset && autoState.pendingAutoRecordingReason) {
          console.log('[RECORDING STATE] 🎙️ Triggering pending auto-recording after state reset:', {
            reason: autoState.pendingAutoRecordingReason
          });
          
          // Clear the pending flags
          autoState.pendingAutoRecordingAfterReset = false;
          const reason = autoState.pendingAutoRecordingReason;
          autoState.pendingAutoRecordingReason = null;
          
          // Trigger auto-recording with the stored reason
          setTimeout(() => {
                    triggerAutoRecording(reason);
      }, 25); // Reduced from 100ms to 25ms for faster auto-recording
        }
      }
      
      // FIXED: Prevent stale recording state updates from stopping current recording
      if (data.stoppedBy === user?.userId && isRecording) {
        console.log('[RECORDING STATE UPDATE] 🛑 Received stop event for current user:', {
          stoppedBy: data.stoppedBy,
          currentUserId: user?.userId,
          isRecording: isRecording,
          recordingStartTime: recordingStartTime,
          timeSinceStart: recordingStartTime ? Date.now() - recordingStartTime : 'N/A'
        });
        
        // Check if this is a stale stop event by comparing with recording start time
        if (recordingStartTime && Date.now() - recordingStartTime < 5000) {
          console.log('[RECORDING STATE UPDATE] 🚫 Ignoring stale stop event - recording just started (< 5 seconds ago)');
          return;
        }
        
        // Check if there's active playback before clearing recording state
        const isAnyPlaybackActive = (
          isPlayingMessage || 
          currentlyPlayingMessageIdRef.current !== null || 
          isProcessingRef.current ||
          robustQueueRef.current.isProcessing ||
          robustQueueRef.current.messages.length > 0 ||
          currentSound !== null ||
          isPlaying !== null
        );
        
        if (isAnyPlaybackActive) {
          console.log('[RECORDING STATE UPDATE] ⏸️ Playback active, delaying recording state clear');
          // Don't clear recording state yet - it will be cleared when playback ends
          return;
        }
        
        console.log('[RECORDING STATE UPDATE] ✅ Clearing recording state due to valid stop event');
        setIsRecording(false);
        setCurrentRecording(null);
        setRecordingDuration(0);
        setRecordingStartTime(0);
        setIsTranscribing(false);
        
      }
    };

    socket.on('recording_rejected', handleRecordingRejected);
    socket.on('recording_queue_updated', handleQueueUpdate);
    socket.on('recording_granted', handleRecordingGranted);
    socket.on('recording_ended', handleRecordingEnded);
    socket.on('recording_state_update', handleRecordingStateUpdate);

    return () => {
      socket.off('recording_rejected', handleRecordingRejected);
      socket.off('recording_queue_updated', handleQueueUpdate);
      socket.off('recording_granted', handleRecordingGranted);
      socket.off('recording_ended', handleRecordingEnded);
      socket.off('recording_state_update', handleRecordingStateUpdate);
    };
  }, [socket, user?.userId, selectedChat?._id]);

  // State for skip to latest functionality
  const [showSkipToLatest, setShowSkipToLatest] = useState(false);
  const [currentChatUnreadCount, setCurrentChatUnreadCount] = useState(0);

  // Function to handle skip to latest - OPTIMIZED for 10+ messages
  const handleSkipToLatest = async () => {
    if (!selectedChat || !user?.userId) return;

    const startTime = Date.now();

    // STEP 1: INSTANT UI feedback (< 5ms)
    setShowSkipToLatest(false);
    setCurrentChatUnreadCount(0);
    
    // STEP 2: INSTANT playback stopping and queue clearing
    clearRobustQueue();
    
    // INSTANT FastPlaybackManager queue clearing
    fastPlaybackManager.clearQueue();
    
    if (currentSound) {
      currentSound.unloadAsync().catch(() => {}); // Fire and forget
      setCurrentSound(null);
    }
    
    // STEP 3: INSTANT state resets
    setIsPlaying(null);
    setCurrentMessageId(null);
    currentlyPlayingMessageIdRef.current = null;
    isProcessingRef.current = false;
    setIsPlayingMessage(false);

    // STEP 4: Get unread message IDs for background processing
    const unreadMessageIds = messages
      .filter(msg => msg.senderId !== user.userId && (!msg.readBy || !msg.readBy[user.userId]))
      .map(msg => msg._id);

    // STEP 5: Use FastPlaybackManager's ultra-fast skip method
    if (unreadMessageIds.length > 0) {
      fastPlaybackManager.ultraFastSkipToLatest({
        messageIds: unreadMessageIds,
        userId: user.userId,
        batchSize: Math.min(10, Math.max(5, Math.ceil(unreadMessageIds.length / 5))), // Dynamic batch size
        onProgress: (processed, total) => {
          // Progress callback without logging
        }
      });
    }

    // STEP 6: BACKGROUND server sync (non-blocking)
    const backgroundServerSync = async () => {
      try {
        const token = await AsyncStorage.getItem('accessToken');
        const response = await fetch(`${API_URL}/groupchats/${selectedChat._id}/mark-all-read`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId: user.userId }),
        });

        if (response.ok) {
          // Server sync completed successfully
        } else {
          // Server sync failed, but UI already updated
        }
      } catch (error) {
        // Background server sync error
      }
    };
    
    // Start server sync in background
    backgroundServerSync();

    // STEP 7: BACKGROUND state updates (non-blocking)
    const backgroundStateUpdates = async () => {
      // Use requestAnimationFrame for smooth updates
      requestAnimationFrame(() => {
        // Batch all message updates in one setState call
        const updatedMessages = messages.map(msg => ({
          ...msg,
          isRead: true,
          readBy: {
            ...msg.readBy,
            [user.userId]: new Date().toISOString()
          }
        }));
        setMessages(updatedMessages);
        
        // Update group chat unread count
        setGroupChats(prevChats => 
          prevChats.map(chat => 
            chat._id === selectedChat._id 
              ? { ...chat, unreadCount: 0 }
              : chat
          )
        );
      });
    };
    
    // Start background state updates
    backgroundStateUpdates();

    // STEP 8: ENHANCED auto-recording trigger (only if autoRecordingEnabled)
    if (autoRecordingEnabled) {
      // CRITICAL FIX: Only reset auto-recording state if no one is in the recording queue
      const autoState = autoRecordingStateRef.current;
      const isAnyoneInRecordingQueue = autoState.isInRecordingQueue || autoState.isWaitingForQueueGrant;
      
      if (!isAnyoneInRecordingQueue) {
        // Only reset if no one is waiting in the queue
        autoState.hasAutoRecordedInThisChat = false;
        autoState.isAutoRecordingInProgress = false;
        autoState.autoRecordingTriggered = false;
        autoState.isWaitingForQueueCompletion = false;
        autoState.isWaitingForPlaybackCompletion = false;
      }
      
      // Trigger auto-recording with full logic (includes queue handling)
      setTimeout(() => {
        triggerAutoRecording('queue_completed');
      }, 25); // Reduced from 100ms to 25ms for faster auto-recording
    }
  };

  // Pull-to-refresh handler function
  const onRefresh = async () => {
    if (!selectedChat) return;
    
    setRefreshing(true);
    try {
      // Force a fresh fetch of messages from the server
      await fetchMessages(selectedChat._id);
      
      // Also refresh group chat data
      if (user?.userId) {
        await fetchGroupChats(user.userId);
      }
    } catch (error) {
      console.error('[Pull-to-Refresh] Error refreshing messages:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // Effect to monitor unread messages and show/hide skip to latest button
  useEffect(() => {
    if (!selectedChat || !messages.length || !user?.userId) {
      setShowSkipToLatest(false);
      setCurrentChatUnreadCount(0);
      return;
    }

    // Count unread messages (messages not read by current user)
    const unreadMessages = messages.filter(msg => 
      msg.senderId !== user.userId && // Not sent by current user
      (!msg.readBy || !msg.readBy[user.userId]) // Not read by current user
    );

    const unreadCount = unreadMessages.length;
    setCurrentChatUnreadCount(unreadCount);

    // Show skip to latest button if 3 or more unread messages
    const shouldShowSkipToLatest = unreadCount >= 3;
    setShowSkipToLatest(shouldShowSkipToLatest);

  }, [selectedChat, messages, user?.userId]);

  // NEW: Replace complex audio state with FastPlaybackManager
  const [fastPlaybackManager] = useState(() => new FastPlaybackManager());
  const [fastPlaybackState, setFastPlaybackState] = useState(null);

  // NEW: Lightweight message type validation for FastPlaybackManager
  const validateMessageType = async (messageId: string): Promise<{ isValid: boolean; type?: string }> => {
    try {
      // First check in current messages (fastest)
      let message = messages.find(m => m._id === messageId);
      
      // If not found in current messages, check robust queue
      if (!message) {
        const queue = robustQueueRef.current;
        message = queue.messages.find(m => m._id === messageId);
      }
      
      if (!message) {
        return { isValid: false, type: 'unknown' };
      }
      
      // Check if message type is valid for audio playback
      const isValidForAudio = message.type === 'voice';
      
      return { 
        isValid: isValidForAudio, 
        type: message.type 
      };
    } catch (error) {
      console.warn('[validateMessageType] Validation error:', error);
      return { isValid: true, type: 'unknown' }; // Default to valid if validation fails
    }
  };

  // NEW: Initialize FastPlaybackManager
  useEffect(() => {
    const initializeFastPlayback = async () => {
      try {
        await fastPlaybackManager.initialize({
          getAudioUrl: (messageId) => getAudioUrl(messageId),
          validateMessageType: (messageId) => validateMessageType(messageId),
          onPlaybackStart: (messageId) => {
            setIsPlaying(messageId);
            setCurrentMessageId(messageId);
            setIsPlayingMessage(true);
            currentlyPlayingMessageIdRef.current = messageId;
          },
          onPlaybackComplete: (messageId) => {
            setIsPlaying(null);
            setCurrentMessageId(null);
            setIsPlayingMessage(false);
            currentlyPlayingMessageIdRef.current = null;
            // ... existing code ...
            // Call handlePlaybackEnd to process any pending recording grant
            handlePlaybackEnd();
          },
          onPlaybackError: (messageId, error) => {
            //console.error('[FastPlayback] ❌ Playback error:', messageId, error);
            setIsPlaying(null);
            setCurrentMessageId(null);
            setIsPlayingMessage(false);
            currentlyPlayingMessageIdRef.current = null;
          },
          onSkipComplete: (fromId, toId, skippedCount) => {
            // Mark all skipped messages as played and read
            const queue = robustQueueRef.current.messages;
            const fromIndex = queue.findIndex(m => m._id === fromId);
            const toIndex = queue.findIndex(m => m._id === toId);
            
            if (fromIndex !== -1 && toIndex !== -1) {
              const skippedMessages = queue.slice(fromIndex, toIndex);
              skippedMessages.forEach(message => {
                playedMessageIdsRef.current.add(message._id);
                if (!message.isRead) {
                  markMessageAsRead(message);
                }
              });
              setPlayedMessageIds(new Set(playedMessageIdsRef.current));
            }
          },
          onQueueComplete: () => {
            //console.log('[FastPlayback] 📝 Queue completed - checking auto-recording conditions');
            
            // CRITICAL: Clear all playback states immediately
            setIsPlaying(null);
            setCurrentMessageId(null);
            setIsPlayingMessage(false);
            currentlyPlayingMessageIdRef.current = null;
            isProcessingRef.current = false;
            
            // Clear both robust queue and processing states
            robustQueueRef.current.messages = [];
            robustQueueRef.current.isProcessing = false;
            robustQueueRef.current.processingMessageId = null;
            processingStateRef.current.isProcessing = false;
            processingStateRef.current.processingMessageId = null;
            
            //console.log('[FastPlayback] 🧹 All playback states cleared');
            
            // Check if we should trigger auto-recording after playback completion
            const shouldTriggerAutoRecord = autoRecordingEnabled && !isRecording;
            
            if (shouldTriggerAutoRecord) {
              // Double-check queue is truly empty before auto-recording
              const isQueueReallyEmpty = (
                robustQueueRef.current.messages.length === 0 &&
                !robustQueueRef.current.isProcessing &&
                !isPlayingMessage &&
                !currentlyPlayingMessageIdRef.current &&
                !isProcessingRef.current &&
                !processingStateRef.current.isProcessing
              );
              
              if (isQueueReallyEmpty && canAutoRecord('playback_ended')) {
                //console.log('[FastPlayback] ✅ Queue truly empty, triggering auto-recording');
                setTimeout(() => {
                  // NEW FIX: Check if someone is already recording before auto-recording (FastPlayback case)
                  if (selectedChat && getRecordingUsers) {
                    const recordingUsers = getRecordingUsers(selectedChat._id) || [];
                    const currentUserId = user?.userId;
                    const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
                    
                    if (otherRecordingUsers.length > 0) {
                     /*console.log('[FastPlayback] ❌ Someone else is recording, skipping auto-recording:', {
                        otherRecordingUsers,
                        currentUserId
                      });*/
                      return;
                    }
                  }
                  
                  // Final check before auto-recording
                  if (!isRecording && canAutoRecord('playback_ended')) {
                    triggerAutoRecording('playback_ended');
                  } else {
                    //console.log('[FastPlayback] ❌ Auto-recording conditions changed, skipping');
                  }
                }, 10); // Reduced from 25ms to 10ms for faster auto-recording
              } else {
                /*console.log('[FastPlayback] ❌ Queue not truly empty or auto-record conditions not met', {
                  queueLength: robustQueueRef.current.messages.length,
                  isProcessing: robustQueueRef.current.isProcessing,
                  isPlayingMessage,
                  hasCurrentlyPlaying: !!currentlyPlayingMessageIdRef.current,
                  canAutoRecord: canAutoRecord('playback_ended')
                });*/
              }
            } else {
              //console.log('[FastPlayback] 🔕 Auto-recording disabled or user is recording');
            }
          },
          onMarkAsRead: (messageId) => {
            const message = messages.find(m => m._id === messageId);
            if (message && !message.isRead) {
              markMessageAsRead(message).catch(error => console.error('[FastPlayback] Error marking message as read:', error));
            }
            // Also mark as played locally
            playedMessageIdsRef.current.add(messageId);
            setPlayedMessageIds(new Set(playedMessageIdsRef.current));
            savePlayedMessages(messageId);
          },
          onSkipToLatestComplete: () => {
            //console.log('[FastPlayback] 🚀 Skip to latest completed via FastPlaybackManager');
            
            // Trigger auto-recording if enabled (includes queue handling)
            if (autoRecordingEnabled) {
              //console.log('[FastPlayback] 🎙️ Auto-recording enabled, triggering after skip to latest');
              
              // Reset auto-recording state to allow fresh trigger
              autoRecordingStateRef.current.hasAutoRecordedInThisChat = false;
              autoRecordingStateRef.current.isAutoRecordingInProgress = false;
              autoRecordingStateRef.current.autoRecordingTriggered = false;
              
              setTimeout(() => {
                // NEW FIX: Check if someone is already recording before auto-recording (skip to latest case)
                if (selectedChat && getRecordingUsers) {
                  const recordingUsers = getRecordingUsers(selectedChat._id) || [];
                  const currentUserId = user?.userId;
                  const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
                  
                  if (otherRecordingUsers.length > 0) {
                    /*console.log('[FastPlayback] ❌ Someone else is recording, skipping auto-recording after skip to latest:', {
                      otherRecordingUsers,
                      currentUserId
                    });*/
                    return;
                  }
                }
                
                //console.log('[FastPlayback] 🚀 Triggering auto-recording after FastPlaybackManager skip to latest');
                        triggerAutoRecording('queue_completed');
      }, 10); // Reduced from 25ms to 10ms for faster auto-recording
            } else {
              //console.log('[FastPlayback] 🔕 Auto-recording disabled, skipping auto-record trigger');
            }
          },
          onLastMessageSkip: (messageId) => {
            //console.log('[FastPlayback] 🏁 Last message skipped via FastPlaybackManager:', messageId);
            
            // ENHANCED: More robust auto-recording trigger for last message skip
            if (autoRecordingEnabled) {
              //console.log('[FastPlayback] 🎙️ Auto-recording enabled, preparing to trigger after last message skip');
              
              // Reset auto-recording state to allow fresh trigger
              autoRecordingStateRef.current.hasAutoRecordedInThisChat = false;
              autoRecordingStateRef.current.isAutoRecordingInProgress = false;
              autoRecordingStateRef.current.autoRecordingTriggered = false;
              
              // Set flags to indicate this was a last message skip
              autoRecordingStateRef.current.shouldTriggerAfterQueueComplete = true;
              autoRecordingStateRef.current.skipToLastMessage = true;
              
              setTimeout(() => {
                // Double-check that all playback states are cleared
                const isPlaybackActive = (
                  isPlayingMessage ||
                  isProcessingRef.current ||
                  processingStateRef.current.isProcessing ||
                  robustQueueRef.current.isProcessing ||
                  robustQueueRef.current.messages.length > 0 ||
                  currentSound !== null ||
                  isPlaying !== null ||
                  currentlyPlayingMessageIdRef.current !== null
                );
                
                if (isPlaybackActive) {
                  //console.log('[FastPlayback] ⚠️ Playback still active, delaying auto-recording trigger');
                  
                  setTimeout(() => {
                                      // NEW FIX: Check if someone is already recording before auto-recording (last message skip delayed case)
                  if (selectedChat && getRecordingUsers) {
                    const recordingUsers = getRecordingUsers(selectedChat._id) || [];
                    const currentUserId = user?.userId;
                    const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
                    
                    if (otherRecordingUsers.length > 0) {
                      /*console.log('[FastPlayback] ❌ Someone else is recording, skipping auto-recording after last message skip (delayed):', {
                        otherRecordingUsers,
                        currentUserId
                      });*/
                      return;
                    }
                  }
                  
                                    if (canAutoRecord('playback_ended')) {
                    //console.log('[FastPlayback] 🚀 Delayed triggering auto-recording after last message skip');
                    triggerAutoRecording('playback_ended');
                  } else {
                    //console.log('[FastPlayback] ❌ Auto-recording conditions still not met after delay');
                  }
                }, 10); // Reduced from 100ms to 10ms for faster blocking
                } else {
                  //console.log('[FastPlayback] ✅ Playback cleared, triggering auto-recording after last message skip');
                  
                  // NEW FIX: Check if someone is already recording before auto-recording (last message skip immediate case)
                  if (selectedChat && getRecordingUsers) {
                    const recordingUsers = getRecordingUsers(selectedChat._id) || [];
                    const currentUserId = user?.userId;
                    const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
                    
                    if (otherRecordingUsers.length > 0) {
                      /*console.log('[FastPlayback] ❌ Someone else is recording, skipping auto-recording after last message skip (immediate):', {
                        otherRecordingUsers,
                        currentUserId
                      });*/
                      return;
                    }
                  }
                  
                  if (canAutoRecord('playback_ended')) {
                    triggerAutoRecording('playback_ended');
                  } else {
                    //console.log('[FastPlayback] ❌ Auto-recording conditions not met for last message skip');
                  }
                }
              }, 10); // Reduced from 25ms to 10ms for faster blocking
            } else {
              //console.log('[FastPlayback] 🔕 Auto-recording disabled, skipping auto-record trigger');
            }
          }
        });
        
       // console.log('[FastPlayback] ✅ Initialized successfully');
        
        // Start smart preloading for current messages
        if (messages.length > 0) {
          const messageIds = messages.slice(0, 10).map(m => m._id);
          const audioUrls = await Promise.all(
            messageIds.map(id => getAudioUrl(id).catch(() => null))
          );
          
          const validUrls = audioUrls.filter(Boolean) as string[];
          if (validUrls.length > 0) {
            fastPlaybackManager.preloadMessages(messageIds.slice(0, validUrls.length), validUrls);
          }
        }
        
      } catch (error) {
        //console.error('[FastPlayback] ❌ Initialization failed:', error);
      }
    };
    
    if (selectedChat) {
      initializeFastPlayback();
    }
    
    return () => {
      fastPlaybackManager.cleanup();
    };
  }, [selectedChat?._id, user?.userId]);

  // REMOVED: Duplicate secondary auto-recording effect that was causing back-to-back triggers in 3+ person group chats
  // The primary auto-recording effect (lines 453-618) handles all chat entry scenarios properly

  // Use context-based pagination instead of local state
  // The GroupChatContext already handles pagination state per chat

  // Add a ref to track pending recording grant
  const pendingRecordingGrantRef = useRef(false);

  // In the playback end handler, check for pending recording grant
  const handlePlaybackEnd = () => {
    if (pendingRecordingGrantRef.current) {
      pendingRecordingGrantRef.current = false;
      setTimeout(async () => {
        try {
          if (isRecording || isStartingRecordingRef.current) {
            return;
          }
          await startRecording();
        } catch (error) {
          console.error(`[PLAYBACK END] ❌ Failed to start recording after playback:`, error);
        }
      }, 10); // Reduced from 100ms to 10ms for faster auto-recording
    }
    
    // CRITICAL FIX: Trigger auto-recording for users in position 1 of recording queue after playback ends
    const autoState = autoRecordingStateRef.current;
    const is3PlusPersonChat = selectedChat && selectedChat.members && selectedChat.members.length > 2;
    
    if (is3PlusPersonChat && autoState.isInRecordingQueue && autoState.queuePosition === 1 && autoState.isWaitingForQueueGrant) {
      console.log('[PLAYBACK END] 🎙️ Triggering auto-recording for user in position 1 after playback completion');
      setTimeout(() => {
        // NEW FIX: Check if someone is already recording before auto-recording (handlePlaybackEnd case)
        if (selectedChat && getRecordingUsers) {
          const recordingUsers = getRecordingUsers(selectedChat._id) || [];
          const currentUserId = user?.userId;
          const otherRecordingUsers = recordingUsers.filter(userId => userId !== currentUserId);
          
          if (otherRecordingUsers.length > 0) {
            console.log('[PLAYBACK END] ❌ Someone else is recording, skipping auto-recording in handlePlaybackEnd:', {
              otherRecordingUsers,
              currentUserId
            });
            return;
          }
        }
        
        // CRITICAL FIX: Clear queue state and start recording directly
        autoState.isInRecordingQueue = false;
        autoState.isWaitingForQueueGrant = false;
        autoState.queuePosition = 0;
        autoState.lastAutoRecordTime = Date.now();
        
        // Notify server to remove from queue
        if (socket) {
          socket.emit('leave_recording_queue', {
            groupId: selectedChat._id,
            userId: user?.userId
          });
        }
        
        // Start recording directly
        setIsRecording(true);
        startRecording().catch(error => {
          console.error('[PLAYBACK END] ❌ Failed to start recording after playback:', error);
          setIsRecording(false);
        });
      }, 10); // Reduced from 25ms to 10ms for faster auto-recording
    }
  };

  // NEW: Periodic cleanup to prevent queue from getting stuck
  useEffect(() => {
    if (!selectedChat) return;
    
    const cleanupInterval = setInterval(() => {
      cleanupProcessedMessages();
      
      // Also check if queue is stuck and force clear if needed
      const queue = robustQueueRef.current;
      const now = Date.now();
      const stuckThreshold = 30 * 1000; // 30 seconds
      
      if (queue.isProcessing && queue.processingMessageId && 
          (now - queue.lastProcessedTime) > stuckThreshold) {
        //console.log('[ROBUST QUEUE] 🚨 Queue appears stuck, forcing cleanup');
        queue.isProcessing = false;
        queue.processingMessageId = null;
        processingStateRef.current.isProcessing = false;
        processingStateRef.current.processingMessageId = null;
        cleanupProcessedMessages();
      }
    }, 5000); // Run every 5 seconds
    
    return () => clearInterval(cleanupInterval);
  }, [selectedChat?._id]);

  // NEW: Auto-recording trigger for chat entry with unread messages
  useEffect(() => {
    if (!selectedChat || !user?.userId || isLoadingMessages || currentFetchingGroupId === selectedChat._id) {
      return;
    }

    // Check if there are unread messages
    const unreadMessages = messages.filter(m => 
      !m.isRead && m.senderId !== user.userId && m.groupChatId === selectedChat._id
    );

    if (unreadMessages.length > 0) {
      //console.log('[CHAT ENTRY] 📝 Found unread messages, triggering auto-recording');
      if (canAutoRecord('chat_entry')) {
        triggerAutoRecording('chat_entry');
      }
    } else {
      //console.log('[CHAT ENTRY] ❌ No unread messages found');
    }
  }, [selectedChat?._id, messages, user?.userId, isLoadingMessages, currentFetchingGroupId]);

  // NEW: Centralized processing lock to prevent race conditions
  const processingLockRef = useRef<{
    isLocked: boolean;
    lockTime: number;
    lockId: string | null;
  }>({
    isLocked: false,
    lockTime: 0,
    lockId: null
  });

  // NEW: Debounced queue processing to prevent multiple simultaneous calls
  const debouncedProcessQueueRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // NEW: Centralized queue processing function with proper locking
  const processQueueSafely = (context: string = 'unknown') => {
    const lock = processingLockRef.current;
    const now = Date.now();
    
    // Clear any existing debounced call
    if (debouncedProcessQueueRef.current) {
      clearTimeout(debouncedProcessQueueRef.current);
      debouncedProcessQueueRef.current = null;
    }
    
    // Check if already processing
    if (lock.isLocked) {
      const lockAge = now - lock.lockTime;
      // If lock is older than 5 seconds, force clear it (stuck lock)
      if (lockAge > 5000) {
       // console.log(`[QUEUE LOCK] 🔓 Force clearing stuck lock (${lockAge}ms old) from context: ${lock.lockId}`);
        lock.isLocked = false;
        lock.lockTime = 0;
        lock.lockId = null;
      } else {
        //console.log(`[QUEUE LOCK] ⏸️ Processing already locked by: ${lock.lockId}, skipping call from: ${context}`);
        return;
      }
    }
    
    // Set the lock
    lock.isLocked = true;
    lock.lockTime = now;
    lock.lockId = context;
    
    // Process with a small delay to ensure state consistency
    debouncedProcessQueueRef.current = setTimeout(() => {
      try {
        processRobustQueue();
      } finally {
        // Always clear the lock after processing
        lock.isLocked = false;
        lock.lockTime = 0;
        lock.lockId = null;
        debouncedProcessQueueRef.current = null;
      }
    }, 10); // Small delay to prevent race conditions
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      {/* Gradient Waves Animated Background */}
      <GradientWavesBackground />
      {/* Pulsating Background Layer - Only shown on Your Groups page */}
      {!selectedChat && !isEavesdropping && <PulsatingBackground />}
      {/* Animated SVG Background Layer (CONTAINED, zIndex 0) */}
      <View style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        zIndex: 0,
        borderRadius: 0,
        pointerEvents: 'none',
      }}>
        <AnimatedSVGBackground />
      </View>
      {/* Iridescent Gradient Overlay */}
      <LinearGradient
        colors={["#23272A", "#282828", "#26A7DE", "#fff0"]}
        style={styles.gradientOverlay}
        start={{ x: 0.1, y: 0.1 }}
        end={{ x: 0.9, y: 0.9 }}
      />
      {/* Full-page Glassmorphic Blur */}
      <BlurView intensity={90} tint="dark" style={styles.fullGlassBlur}>
        {selectedChat && (
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={handleBackPress}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            
            <View style={styles.groupInfoButton}>
              <View style={styles.groupNameContainer}>
                <Text style={styles.groupName} numberOfLines={1}>
                  {selectedChat?.name || 'Group Chat'}
                </Text>
                <TouchableOpacity
                  onPress={() => setIsGroupInfoVisible(true)}
                  activeOpacity={0.7}
                  style={styles.infoIconButton}
                >
                  <Ionicons 
                    name="information-circle-outline" 
                    size={18} 
                    color="rgba(255,255,255,0.6)" 
                    style={styles.infoIcon}
                  />
                </TouchableOpacity>
              </View>
              <Text style={styles.memberCount}>
                {`${selectedChat?.members?.length || 0} members`}
              </Text>
            </View>
          </View>
        )}
        




        <View style={{ flex: 1 }}>
          <KeyboardAvoidingView 
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.container}
            keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
          >
            <View style={styles.gcMainWrapper}>
              {/* Group Chat List - Only render when no chat is selected */}
              {!selectedChat && (
                <SafeAreaView style={{flex: 1}} edges={['top']}>
                  <Animated.View 
                    style={[
                      styles.gcListSection,
                      {
                        transform: [{ translateX: listTranslateX }],
                        opacity: listOpacity,
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 1,
                      }
                    ]}
                    pointerEvents={showUnreadPopup || checkingUnread ? 'none' : 'auto'}
                  >
                    <GroupChatList
                      groupChats={groupChats}
                      selectedChat={selectedChat}
                      onSelectChat={selectGroupChat}
                      onEavesdrop={handleEavesdrop}
                      onCreateChat={createGroupChat}
                      onDeleteChat={deleteGroupChat}
                      onLeaveChat={leaveGroupChat}
                      externalModalTrigger={externalModalTrigger}
                      onExternalModalTriggerReset={() => setExternalModalTrigger(false)}
                    />
                  </Animated.View>
                </SafeAreaView>
              )}

              {isEavesdropping && eavesdropChat ? (
                <EavesdropView
                  chat={eavesdropChat}
                  messages={messages}
                  onExit={handleExitEavesdrop}
                  onPlayMessage={playMessage}
                  isPlaying={isPlaying}
                  playbackPosition={playbackPosition}
                  playbackDuration={playbackDuration}
                  currentSound={currentSound}
                  onPause={pauseMessage}
                  onSeek={seekMessage}
                  visible={isEavesdropping}
                  markMessageAsViewed={markMessageAsViewed}
                  getAudioUrl={getAudioUrl}
                />
              ) : selectedChat ? (
                <PanGestureHandler
                  activeOffsetX={[-20, 20]}
                  failOffsetY={[-20, 20]}
                  shouldCancelWhenOutside={false}
                  onGestureEvent={onGestureEvent}
                  onHandlerStateChange={onHandlerStateChange}
                >
                  <Animated.View
                    style={[
                      styles.chatContainer,
                      {
                        transform: [
                          { translateX: translateX },
                          { scale: scale },
                          { rotateY: rotateY.interpolate({
                              inputRange: [0, 8],
                              outputRange: ['0deg', '8deg'],
                            }) },
                        ],
                        opacity: opacity,
                        zIndex: 2,
                      },
                    ]}
                  >
                    <View style={[styles.chatContainer, { flex: 1 }]}>
                      <FlatList
                        data={stableMessagesData}
                        renderItem={renderItem}
                        keyExtractor={(item) => item._id}
                        style={styles.messageList}
                        inverted
                        removeClippedSubviews={true}
                        initialNumToRender={10}
                        maxToRenderPerBatch={10}
                        windowSize={15}
                        scrollEventThrottle={16}
                        refreshControl={
                          <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor="#26A7DE"
                            colors={["#26A7DE"]}
                            progressBackgroundColor="rgba(255,255,255,0.1)"
                          />
                        }
                        ListHeaderComponent={() => (
                          <>
                            {/* Show loading indicator when fetching general messages */}
                            {isLoadingMessages && (
                              <View style={{ padding: 16, alignItems: 'center' }}>
                                <ActivityIndicator size="small" color="#26A7DE" />
                                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4 }}>
                                  Loading older messages...
                                </Text>
                              </View>
                            )}
                          </>
                        )}
                        onEndReachedThreshold={0.1}
                        onEndReached={() => {
                          if (selectedChat) {
                            fetchOlderMessages(selectedChat._id);
                          }
                        }}
                      />
                      {/* FIXED: Move GroupReadReceipts to bottom right position */}
                      {selectedChat && selectedChat.members && selectedChat.members.length > 2 ? (
                        <GroupReadReceipts
                          messages={messages}
                          groupMembers={selectedChat.members}
                          currentUserId={user?.userId || ''}
                          isVisible={true}
                        />
                      ) : null}
                      <RecordingControls
                        selectedChat={selectedChat}
                        user={user}
                        fetchMessages={fetchMessages}
                        setGroupChats={setGroupChats}
                        currentAudioData={currentAudioData}
                        isPlaying={!!isPlaying}
                        currentPlayingMessageId={isPlaying}
                        isPlayingMessage={isPlayingMessage}
                        isRobustQueueProcessing={robustQueueRef.current.isProcessing}
                        messages={messages}
                        setMessages={setMessages}
                        onMessagePlayed={(messageId) => {
                          playedMessageIdsRef.current.add(messageId);
                          setPlayedMessageIds(new Set(playedMessageIdsRef.current));
                        }}
                        isRecording={isRecording}
                        setIsRecording={setIsRecording}
                        stopRecording={stopRecording}
                        startRecording={startRecording}
                        isTranscribing={isTranscribing}
                        getAudioUrl={getAudioUrl}
                      />
                    </View>
                  </Animated.View>
                </PanGestureHandler>
              ) : null}
              
              {/* Skip to Latest Button - Positioned outside PanGestureHandler but inside selectedChat conditional */}
              {selectedChat && showSkipToLatest && (
                <View style={styles.skipToLatestContainer}>
                  <TouchableOpacity
                    style={styles.skipToLatestButton}
                    onPress={handleSkipToLatest}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="arrow-down-circle" size={20} color="#fff" />
                    <Text style={styles.skipToLatestText}>
                      Skip to Latest ({currentChatUnreadCount} unread)
                    </Text>
                    <Ionicons name="flash" size={16} color="#26A7DE" />
                  </TouchableOpacity>
                </View>
              )}


            </View>
          </KeyboardAvoidingView>
        </View>
      </BlurView>
      
      {/* UnreadMessagesPopup - Rendered at the very top with highest z-index */}
      {showUnreadPopup && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 10000,
          elevation: 10000,
        }}>
          <UnreadMessagesPopup
            visible={showUnreadPopup}
            onClose={handleCloseUnreadPopup}
            onViewSummaries={handleCloseUnreadPopup}
          />
        </View>
      )}
      
      {/* Group Info Modal */}
      <GroupInfoModal
        visible={isGroupInfoVisible}
        onClose={() => setIsGroupInfoVisible(false)}
        group={selectedChat}
        currentUser={user}
        onRemoveMember={removeMemberFromGroup}
        onAddMember={() => {
          /*console.log('[AddMember][Modal] Opening add member modal:', {
            selectedChatId: selectedChat?._id,
            selectedChatName: selectedChat?.name,
            currentUserId: user?.userId,
            timestamp: new Date().toISOString()
          });*/
          setIsGroupInfoVisible(false);
          setAddMemberModalVisible(true);
        }}
        onUpdateGroup={async (groupId, updates) => {
          try {
            const token = await AsyncStorage.getItem('accessToken');
            const response = await fetch(`${API_URL}/groupchats/${groupId}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(updates),
            });

            if (!response.ok) {
              return; // Silently return on error since functionality works
            }

            const updatedGroup = await response.json();
            setGroupChats(prevChats => 
              prevChats.map(chat => 
                chat._id === groupId ? { ...chat, ...updatedGroup } : chat
              )
            );

            if (selectedChat?._id === groupId) {
              setSelectedChat(prev => prev ? { ...prev, ...updatedGroup } : null);
            }
          } catch (error) {
            // Silently handle error since functionality works
            return;
          }
        }}
        onLeaveGroup={() => selectedChat && leaveGroupChat(selectedChat._id)}
      />
      
      {/* Add Member Modal */}
      <Modal
        visible={addMemberModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          //console.log('[AddMember][Modal] Modal closed via onRequestClose');
          setAddMemberModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => {
                  //console.log('[AddMember][Modal] Close button pressed');
                  setAddMemberModalVisible(false);
                }}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Add Member</Text>
            </View>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search users..."
                placeholderTextColor="#666"
                value={searchUserName}
                onChangeText={(text) => {
                  /*console.log('[AddMember][Modal] Search input changed:', {
                    newText: text,
                    previousText: searchUserName,
                    textLength: text.length,
                    timestamp: new Date().toISOString()
                  });*/
                  setSearchUserName(text);
                  if (text.trim().length > 0) {
                    searchUsers(text);
                  } else {
                    setSearchResults([]);
                  }
                }}
              />
              {isSearching && (
                <ActivityIndicator size="small" color={THEME.accentBlue} />
              )}
            </View>
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item._id}
              renderItem={({ item }) => {
                /*console.log('[AddMember][Modal] Rendering search result item:', {
                  itemId: item._id,
                  itemName: item.name,
                  isSelected: selectedUser?._id === item._id,
                  searchResultsCount: searchResults.length
                });*/
                return (
                  <TouchableOpacity
                    style={styles.userItem}
                    onPress={() => {
                      /*console.log('[AddMember][Modal] User selected:', {
                        selectedUser: {
                          _id: item._id,
                          name: item.name,
                          email: item.email
                        },
                        searchResultsCount: searchResults.length,
                        timestamp: new Date().toISOString()
                      });*/
                      // Don't immediately add the member
                      setSelectedUser(item);
                    }}
                  >
                    <View style={styles.userAvatar}>
                      <Text style={styles.userAvatarText}>
                        {item.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{item.name}</Text>
                    </View>
                    {selectedUser?._id === item._id && (
                      <TouchableOpacity
                        style={styles.confirmButton}
                        onPress={() => {
                          /* {
                            selectedUser: {
                              _id: item._id,
                              name: item.name,
                              email: item.email
                            },
                            selectedChatId: selectedChat?._id,
                            selectedChatName: selectedChat?.name,
                            timestamp: new Date().toISOString()
                          });*/
                          addMemberToGroup(item.name);
                          setSelectedUser(null);
                        }}
                      >
                        <Text style={styles.confirmButtonText}>Confirm</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              }}
              style={styles.searchResults}
            />
          </View>
        </View>
      </Modal>
      
      {/* FAB Button - Only show when no chat is selected */}
      {!selectedChat && !isEavesdropping && (
        <TouchableOpacity
          style={styles.fabButton}
          onPress={() => setExternalModalTrigger(true)}
          activeOpacity={0.8}
        >
          <AnimatedWaveform size={24} color="#fff" />
        </TouchableOpacity>
      )}
      
      <ScalableQueueIntegration />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    opacity: 0.55,
    borderRadius: 0,
  },
  fullGlassBlur: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    borderRadius: 0,
    backgroundColor: 'rgba(40,40,43,0.30)',
    borderWidth: 0,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 24,
    elevation: 10,
  },
  iconShadow: {
    textShadowColor: 'rgba(0,0,0,0.18)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  gcMainWrapper: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  gcListSection: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingRight: 0,
    borderRightWidth: 0,
  },
  gcChatSection: {
    flex: 2,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
    alignItems: 'stretch',
    paddingLeft: 0,
  },
  glassInput: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  chatContainer: {
    flex: 1,
    backgroundColor: 'rgba(40,40,43,0.10)',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 10,
    paddingHorizontal: 0,
    overflow: 'hidden',
    shadowColor: '#1a1a2e',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 10,
    borderWidth: 0,
    // Add perspective for 3D rotation effect
    backfaceVisibility: 'hidden',
  },
  messageList: {
    flex: 1,
    padding: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 60,
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: THEME.background,
    borderRadius: 12,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: THEME.white,
    flex: 1,
    textAlign: 'center',
  },
  closeButton: {
    padding: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: THEME.white,
    marginRight: 10,
  },
  searchResults: {
    flex: 1,
    minHeight: 200,
    maxHeight: 300,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: THEME.background,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(255,255,255,0.32)',
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: THEME.accentBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userAvatarText: {
    color: THEME.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: '500',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: Platform.OS === 'ios' ? 90 : 60,
    zIndex: 1000,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingBottom: Platform.OS === 'ios' ? 0 : 5,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
  },
  backButton: {
    position: 'absolute',
    left: 16,
    bottom: Platform.OS === 'ios' ? 0 : 5,
    padding: 8,
    zIndex: 1001,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  groupInfoModal: {
    backgroundColor: 'rgba(40,40,43,0.95)',
    borderRadius: 28,
    width: '90%',
    maxHeight: '80%',
    paddingTop: 20,
    overflow: 'hidden',
  },
  groupInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  groupInfoTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 15,
  },
  groupInfoContent: {
    alignItems: 'center',
    padding: 20,
  },
  groupInfoAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: THEME.accentBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  groupInfoAvatarText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  groupInfoName: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  groupInfoDescription: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginBottom: 24,
  },
  membersSection: {
    width: '100%',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  membersSectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  membersList: {
    width: '100%',
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  memberAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  memberInfo: {
    flex: 1,
  },
  memberNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  memberName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  memberJoinDate: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  creatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.5)',
  },
  creatorBadgeText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 2,
  },
  protectedMemberIcon: {
    marginLeft: 8,
  },
  confirmButton: {
    backgroundColor: THEME.accentBlue,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  confirmButtonText: {
    color: THEME.white,
    fontSize: 14,
    fontWeight: '600',
  },
  swipeIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.3)',
  },
  swipeIndicatorBar: {
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  groupInfoButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  groupName: {
    color: THEME.white,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  infoIcon: {
    marginLeft: 6,
  },
  infoIconButton: {
    padding: 4,
    borderRadius: 12,
  },
  memberCount: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    textAlign: 'center',
  },
  messagesList: {
    flex: 1,
    padding: 10,
  },
  messagesContainer: {
    paddingBottom: 100, // Adjust this value based on your RecordingControls height
  },
  skipToLatestContainer: {
    position: 'absolute',
    bottom: 100, // Position above RecordingControls
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'transparent',
    zIndex: 1000,
    pointerEvents: 'box-none',
  },
  skipToLatestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(40, 40, 43, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: 'rgba(38, 167, 222, 0.5)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    pointerEvents: 'auto',
  },
  skipToLatestText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginHorizontal: 8,
  },
  fabButton: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 80 : 70,
    right: 16,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: THEME.accentBlue,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
  },

});