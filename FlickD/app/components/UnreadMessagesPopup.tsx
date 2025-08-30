import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Easing,
    PanResponder,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getAvatarColor, getInitials } from '../utils/avatarUtils';
import { ModernCarousel } from './ModernCarousel';

const API_URL = Constants.expoConfig?.extra?.API_URL;
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const CARD_WIDTH = Math.round(Dimensions.get('window').width * 0.85);
const CARD_HEIGHT = Math.round(Dimensions.get('window').height * 0.6);
const SWIPE_THRESHOLD = 120;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 500;

interface GroupChat {
  _id: string;
  name: string;
  unreadCount: number;
  members: any[];
}

interface Summary {
  summary: string;
  messageCount: number;
  lastUpdated: string | null;
  generating?: boolean;
}

interface UnreadCountResponse {
  totalUnread: number;
  groupChats: { [key: string]: number };
}

// Helper to generate summary from transcripts (same as backend)
function generateSummaryFromTranscripts(transcripts: Array<any>): string {
  if (!Array.isArray(transcripts) || transcripts.length === 0) return '';
  const transcriptTexts = transcripts.map(t => {
    if (typeof t === 'string') return t;
    if (t.results?.transcripts?.[0]?.transcript) return t.results.transcripts[0].transcript;
    if (t.transcription?.results?.transcripts?.[0]?.transcript) return t.transcription.results.transcripts[0].transcript;
    if (t.results?.items) {
      return t.results.items.map((item: any) => item.alternatives?.[0]?.content || '').join(' ').replace(/\s+/g, ' ').trim();
    }
    return '';
  });
  const text = transcriptTexts.map(t => t.trim()).filter(t => t.length > 0).join('. ');
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
  if (sentences.length === 0) return '';
  if (sentences.length <= 3) return text;
  const firstSentence = sentences[0];
  const middleSentence = sentences[Math.floor(sentences.length / 2)];
  const lastSentence = sentences[sentences.length - 1];
  const summary = [firstSentence, middleSentence, lastSentence].filter(s => s && s.length > 0).join('. ');
  return summary.endsWith('.') ? summary : summary + '.';
}

const SUMMARY_MODES = [
  { key: 'unread', label: 'Unread' },
  { key: 'hour', label: 'Last Hour' },
  { key: 'day', label: 'Last Day' },
];

// Inline presentational TinderCard for this popup only
const PopupTinderCard = ({
  item,
  summaries,
  onPress,
  loadingSummary,
}: {
  item: GroupChat,
  summaries: { [key: string]: Summary | undefined },
  onPress: () => void,
  loadingSummary: boolean,
}) => {
  return (
    <View style={styles.cardContainerRefined}>
      <TouchableOpacity
        style={styles.cardRefined}
        onPress={onPress}
        activeOpacity={0.95}
      >
        <View style={styles.cardBlackBg}>
          <View style={styles.cardHeader}>
            <View style={[
              styles.groupAvatar,
              { backgroundColor: getAvatarColor(item._id) }
            ]}>
              <Text style={styles.groupAvatarText}>
                {getInitials(item.name)}
              </Text>
            </View>
            <View style={styles.groupInfo}>
              <Text style={styles.groupName}>{(item.name && typeof item.name === 'string' && item.name.trim().length > 0) ? item.name.trim() : 'Unnamed'}</Text>
              <Text style={styles.groupMeta}>
                {item.unreadCount > 0 ? `${item.unreadCount} unread` : 'Up to date'}
              </Text>
            </View>
            <View style={styles.statusIndicator}>
              <Ionicons 
                name={summaries[item._id] ? "checkmark-circle" : "time-outline"} 
                size={24} 
                color={summaries[item._id] ? "#26A7DE" : "#282828"} 
              />
            </View>
          </View>
          <View style={styles.cardContent}>
            {loadingSummary ? (
              <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={{color:'#fff',marginTop:8, fontSize: 14}}>Loading...</Text>
              </View>
            ) : summaries[item._id] ? (
              <View style={styles.summaryContainer}>
                <Text style={styles.summaryLabel}>SUMMARY</Text>
                <Text style={styles.summaryText}>{summaries[item._id]?.summary ?? ''}</Text>
                <View style={styles.summaryFooter}>
                  <Text style={styles.summaryMeta}>
                    {item.unreadCount} messages
                  </Text>
                  <Text style={styles.summaryDate}>
                    {summaries[item._id]?.lastUpdated ? new Date(summaries[item._id]!.lastUpdated!).toLocaleDateString() : ''}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.summaryContainer}>
                <Text style={styles.summaryLabel}>NO SUMMARY AVAILABLE</Text>
                <Text style={styles.summaryText}>No messages to summarize in this time period.</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
};

interface UnreadMessagesPopupProps {
  visible: boolean;
  onClose: () => void;
  onViewSummaries: () => void;
}

export default function UnreadMessagesPopup({ visible, onClose, onViewSummaries }: UnreadMessagesPopupProps) {
  const router = useRouter();
  const { user, accessToken, isLoading, isAuthenticated, refreshAccessToken } = useAuth();
  const [groupChats, setGroupChats] = useState<GroupChat[]>([]);
  const [summaries, setSummaries] = useState<{ [key: string]: Summary | undefined }>({});
  const [loading, setLoading] = useState(true);
  const [cardStack, setCardStack] = useState<GroupChat[]>([]);
  const [loadingSummary, setLoadingSummary] = useState<{[groupId:string]: boolean}>({});
  const [allMessages, setAllMessages] = useState<{[groupId:string]: any[]}>({});
  const [isSwiping, setIsSwiping] = useState(false);
  const [cardsLoaded, setCardsLoaded] = useState(false);
  const [swipedCardIds, setSwipedCardIds] = useState<Set<string>>(new Set());
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [isCheckingUnread, setIsCheckingUnread] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const didRetryRef = useRef(false);

  // Popup swipe-to-close gesture
  const popupTranslateY = useRef(new Animated.Value(0)).current;
  const popupOpacity = useRef(new Animated.Value(1)).current;

  // Pulsing animation for swipe hint
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const popupPanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      // More responsive vertical gesture detection
      return Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && Math.abs(gestureState.dy) > 5;
    },
    onPanResponderGrant: () => {
      // Stop any ongoing animations
      popupTranslateY.stopAnimation();
      popupOpacity.stopAnimation();
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dy > 0) { // Only allow downward swipes
        // Direct mapping for immediate response
        popupTranslateY.setValue(gestureState.dy);
        // Smooth fade out
        const opacity = Math.max(0, 1 - (gestureState.dy / 150));
        popupOpacity.setValue(opacity);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 80 || gestureState.vy > 300) {
        // Swipe down to close - more lenient
        Animated.parallel([
          Animated.timing(popupTranslateY, {
            toValue: 400,
            duration: 200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(popupOpacity, {
            toValue: 0,
            duration: 200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start(() => {
          onClose();
        });
      } else {
        // Snap back to original position
        Animated.parallel([
          Animated.spring(popupTranslateY, {
            toValue: 0,
            velocity: gestureState.vy,
            damping: 10,
            stiffness: 250,
            mass: 0.8,
            useNativeDriver: true,
          }),
          Animated.spring(popupOpacity, {
            toValue: 1,
            velocity: gestureState.vy,
            damping: 10,
            stiffness: 250,
            mass: 0.8,
            useNativeDriver: true,
          }),
        ]).start();
      }
    },
  });

  const fetchGroupChats = async () => {
    try {
      setLoading(true);
      
      // OPTIMIZATION: Use Promise.all for parallel loading
      const [groupChatsResponse] = await Promise.all([
        fetch(`${API_URL}/groupchats?userId=${user?.userId}`)
      ]);
      
      if (groupChatsResponse.ok) {
        const data = await groupChatsResponse.json();
        setGroupChats(data);
        
        // OPTIMIZATION: Show cards immediately without waiting for summaries
        setCardsLoaded(true);
        
        // OPTIMIZATION: Load summaries and cached messages in parallel
        const chatsWithUnread = data.filter((chat: GroupChat) => chat.unreadCount > 0);
        
        // Start loading summaries and cached messages in parallel for better performance
        const parallelTasks = chatsWithUnread.map((chat: GroupChat) => [
          fetchSummary(chat._id, 'unread'),
          fetchCachedMessages(chat._id)
        ]).flat();
        
        // Don't await - let them load in background
        Promise.allSettled(parallelTasks).catch(error => {
          console.error('[UnreadMessagesPopup] Background loading error:', error);
        });
      } else {
        console.error('[UnreadMessagesPopup] Failed to fetch group chats:', groupChatsResponse.status);
      }
    } catch (error) {
      console.error('[UnreadMessagesPopup] Error fetching group chats:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCachedMessages = async (groupId: string) => {
    try {
      // OPTIMIZATION: Use cached messages endpoint for faster loading
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // Reduced timeout
      
      const response = await fetch(`${API_URL}/cached-messages/${groupId}?limit=20`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        setAllMessages(prev => ({ ...prev, [groupId]: data }));
      }
    } catch (error) {
      console.error('[UnreadMessagesPopup] Error fetching cached messages:', error);
      // OPTIMIZATION: Don't retry, just continue
    }
  };

  const fetchAllMessages = async (groupId: string) => {
    // OPTIMIZATION: Use cached messages instead of full fetch
    return fetchCachedMessages(groupId);
  };

  const fetchSummary = async (groupId: string, mode: string) => {
    // OPTIMIZATION: Only show loading indicator for first few cards to avoid UI clutter
    const shouldShowLoading = Object.keys(loadingSummary).length < 3;
    if (shouldShowLoading) {
      setLoadingSummary(prev => ({ ...prev, [groupId]: true }));
    }
    
    if (mode === 'unread') {
      try {
        // OPTIMIZATION: Reduced timeout for faster response
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // Reduced from 5000ms to 3000ms
        
        const summaryUrl = `${API_URL}/groupchats/${groupId}/summary?userId=${user?.userId}`;
        const response = await fetch(summaryUrl, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          
          // PHASE 3: Handle new response format with generating flag
          if (data.generating) {
            // Set a placeholder and poll for the actual summary
            setSummaries(prev => ({
              ...prev,
              [groupId]: {
                summary: 'Generating summary...',
                messageCount: 0,
                lastUpdated: null,
                generating: true
              }
            }));
            
            // OPTIMIZATION: Reduced polling interval and max polls for faster response
            let pollCount = 0;
            const maxPolls = 3; // Reduced from 5 to 3
            const pollInterval = setInterval(async () => {
              pollCount++;
              try {
                const cachedResponse = await fetch(`${API_URL}/cached-summary/${groupId}/${user?.userId}`);
                if (cachedResponse.ok) {
                  const cachedData = await cachedResponse.json();
                  if (cachedData.cached && cachedData.data.summary) {
                    setSummaries(prev => ({
                      ...prev,
                      [groupId]: {
                        summary: cachedData.data.summary,
                        messageCount: cachedData.data.messageCount,
                        lastUpdated: cachedData.data.lastUpdated
                      }
                    }));
                    clearInterval(pollInterval);
                  }
                }
              } catch (error) {
                console.error('[UnreadMessagesPopup] Error polling for cached summary:', error);
              }
              
              if (pollCount >= maxPolls) {
                clearInterval(pollInterval);
              }
            }, 1500); // Reduced from 2000ms to 1500ms
          } else if (data.summary) {
            setSummaries(prev => ({
              ...prev,
              [groupId]: {
                summary: data.summary,
                messageCount: data.messageCount,
                lastUpdated: data.lastUpdated
              }
            }));
          } else {
            setSummaries(prev => ({ ...prev, [groupId]: undefined }));
          }
        } else {
          // OPTIMIZATION: Don't retry on 404, just mark as no summary
          if (response.status === 404) {
            setSummaries(prev => ({ ...prev, [groupId]: undefined }));
          }
        }
      } catch (error) {
        console.error('Error fetching summary:', error);
        // OPTIMIZATION: Mark as no summary on error to avoid infinite loading
        setSummaries(prev => ({ ...prev, [groupId]: undefined }));
      }
      
      if (shouldShowLoading) {
        setLoadingSummary(prev => ({ ...prev, [groupId]: false }));
      }
    } else {
      // last hour or last day - OPTIMIZATION: Use cached messages if available
      const messages = allMessages[groupId] || [];
      let since = 0;
      if (mode === 'hour') since = Date.now() - 60 * 60 * 1000;
      if (mode === 'day') since = Date.now() - 24 * 60 * 60 * 1000;
      const filtered = messages.filter((msg: any) => new Date(msg.timestamp).getTime() >= since);
      const transcripts = filtered.filter((msg: any) => msg.transcription).map((msg: any) => msg.transcription);
      const summary = generateSummaryFromTranscripts(transcripts);
      setSummaries(prev => ({
        ...prev,
        [groupId]: summary
          ? {
              summary,
              messageCount: filtered.length,
              lastUpdated: filtered[0]?.timestamp || new Date().toISOString(),
            }
          : undefined,
      }));
      
      if (shouldShowLoading) {
        setLoadingSummary(prev => ({ ...prev, [groupId]: false }));
      }
    }
  };

  useEffect(() => {
    // Only show chats with unread messages
    const stack = groupChats.filter(chat => chat.unreadCount > 0);
    setCardStack(stack);
  }, [groupChats]);

  const handleCardSwipe = (cardIndex: number) => {
    // Track which card IDs have been swiped using the cardIndex
    const swipedCard = cardStack[cardIndex];
    if (swipedCard) {
      setSwipedCardIds(prev => new Set([...prev, swipedCard._id]));
    }
  };

  const checkUnreadMessages = async () => {
    if (!user?.userId || !accessToken) {
      return;
    }
    setIsCheckingUnread(true);
    try {
      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected) {
        throw new Error('No internet connection');
      }
      
      // OPTIMIZATION: Reduced timeout for faster response
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // Reduced from 5000ms to 3000ms
      
      const response = await fetch(`${API_URL}/group-chats/unread-count`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.status === 401 && !didRetryRef.current) {
        // Try to refresh token and retry ONCE
        console.warn('[UnreadMessagesPopup] 401 received, attempting token refresh...');
        await refreshAccessToken();
        didRetryRef.current = true;
        return checkUnreadMessages();
      }
      if (!response.ok) {
        console.error('[UnreadMessagesPopup] API call failed:', response.status, response.statusText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      didRetryRef.current = false; // Reset for next time
      const data: UnreadCountResponse = await response.json();
      const unreadCount = data.totalUnread || 0;
      setTotalUnreadCount(unreadCount);
      if (unreadCount > 0) {
        // OPTIMIZATION: Load group chats immediately without waiting
        fetchGroupChats();
      }
    } catch (error) {
      console.error('[UnreadMessagesPopup] Error checking unread messages:', error);
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        // OPTIMIZATION: Further reduced retry delay for faster response
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
          checkUnreadMessages();
        }, 300); // Reduced from 500ms to 300ms
      } else {
        console.error('[UnreadMessagesPopup] Max retry attempts reached');
        Alert.alert(
          'Error',
          'Failed to check unread messages. Please try again later.',
          [{ text: 'OK', onPress: () => onClose() }]
        );
      }
    } finally {
      setIsCheckingUnread(false);
    }
  };

  useEffect(() => {
    if (visible && user) {
      checkUnreadMessages();
    }
  }, [visible, user]);

  const handleViewSummaries = () => {
    onViewSummaries();
  };

  const handleClosePopup = () => {
    onClose();
  };

  // When all cards are swiped and cardsLoaded, close popup (do not navigate)
  useEffect(() => {
    if (cardsLoaded && cardStack.length > 0 && swipedCardIds.size === cardStack.length && visible) {
      onClose && onClose();
    }
  }, [cardStack.length, swipedCardIds.size, cardsLoaded, visible, onClose]);

  // Start pulsing animation when swipe hint becomes visible
  useEffect(() => {
    const shouldShowHint = !isCheckingUnread && !loading && cardStack.length > 0 && swipedCardIds.size < cardStack.length;
    
    if (shouldShowHint) {
      const pulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.08,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimation.start();
      
      return () => {
        pulseAnimation.stop();
        pulseAnim.setValue(1);
      };
    } else {
      // Stop animation when hint shouldn't be shown
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isCheckingUnread, loading, cardStack.length, swipedCardIds.size]);

  if (!visible) return null;

  return (
    <Animated.View 
      style={[
        styles.popupContainer,
        {
          transform: [{ translateY: popupTranslateY }],
          opacity: popupOpacity,
        }
      ]}
      {...popupPanResponder.panHandlers}
    >
      {/* Full screen blur background */}
      <BlurView intensity={20} style={styles.fullScreenBlur}>
        {/* Centered content container */}
        <View style={styles.popupContent}>
          <View style={styles.popupHeader}>
            <TouchableOpacity onPress={handleClosePopup} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.stackContainer}>
            {isCheckingUnread ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.loadingText}>Checking unread messages...</Text>
              </View>
            ) : loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.loadingText}>Loading cards...</Text>
              </View>
            ) : (cardStack.length === 0 || swipedCardIds.size === cardStack.length) && cardsLoaded ? (
              // No UI, handled by useEffect
              null
            ) : (
              <ModernCarousel
                key={`carousel-${swipedCardIds.size}`}
                cards={cardStack.filter(card => !swipedCardIds.has(card._id))}
                renderCard={(item, idx) => (
                  <PopupTinderCard
                    item={item}
                    summaries={summaries}
                    onPress={() => {
                      // Handle tap to remove
                      const activeCards = cardStack.filter(card => !swipedCardIds.has(card._id));
                      const tappedCard = activeCards[idx];
                      if (tappedCard) {
                        setSwipedCardIds(prev => new Set([...prev, tappedCard._id]));
                      }
                    }}
                    loadingSummary={loadingSummary[item._id] || false}
                  />
                )}
                onSwipe={(cardIndex, direction) => {
                  // Find the actual card in the original array and mark it as swiped
                  const activeCards = cardStack.filter(card => !swipedCardIds.has(card._id));
                  const swipedCard = activeCards[cardIndex];
                  if (swipedCard) {
                    setSwipedCardIds(prev => new Set([...prev, swipedCard._id]));
                  }
                }}
              />
            )}
          </View>
        </View>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  popupContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  fullScreenBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupContent: {
    width: '95%',
    height: '90%',
    padding: 20,
    paddingTop: 60,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    width: '100%',
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10,
  },
  closeButton: {
    padding: 8,
  },
  stackContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 16,
    fontWeight: '500',
  },
  cardContainerRefined: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    alignSelf: 'center',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
    backgroundColor: 'transparent',
  },
  cardRefined: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(255,255,255,0.32)',
  },
  cardBlackBg: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: 'space-between',
    backgroundColor: '#000',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    paddingBottom: 8,
    paddingTop: 4,
  },
  groupAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  groupAvatarText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.18)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.18)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  groupMeta: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.10)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  statusIndicator: {
    marginLeft: 12,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  summaryContainer: {
    flex: 1,
    paddingVertical: 8,
  },
  summaryLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 2,
    textShadowColor: 'rgba(0,0,0,0.18)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  summaryText: {
    fontSize: 18,
    color: '#fff',
    lineHeight: 26,
    flex: 1,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.18)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  summaryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.13)',
    paddingBottom: 4,
  },
  summaryMeta: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.10)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  summaryDate: {
    fontSize: 12,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.10)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  modeToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 0,
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  modeToggleButton: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  modeToggleButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  modeToggleText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  modeToggleTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  unreadCounterContainer: {
    position: 'absolute',
    left: 24,
    bottom: 24,
    backgroundColor: '#23272A',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.13,
    shadowRadius: 6,
    elevation: 3,
    zIndex: 10,
  },
  unreadCounterText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 1,
  },
  swipeHintContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  swipeHintText: {
    color: '#E74C3C',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
}); 