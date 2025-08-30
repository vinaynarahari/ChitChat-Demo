import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ActivityIndicator, 
  TouchableOpacity, 
  Dimensions, 
  Animated,
  PanResponder,
  SafeAreaView,
  Platform,
  Pressable,
  BackHandler,
  Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from './context/AuthContext';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const API_URL = Constants.expoConfig?.extra?.API_URL;
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const CARD_WIDTH = screenWidth * 0.9;
const CARD_HEIGHT = screenHeight * 0.7;
const SWIPE_THRESHOLD = 120;
const UNDO_TIMEOUT = 5000;
const SESSION_REDIRECT_KEY = 'sessionRedirected';
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

interface GroupChat {
  _id: string;
  name: string;
  unreadCount: number;
  members: any[];
}

interface Summary {
  summary: string;
  messageCount: number;
  lastUpdated: string;
}

interface UnreadCountResponse {
  totalUnread: number;
  groupChats: { [key: string]: number };
}

// Helper to generate summary from transcripts (same as backend)
function generateSummaryFromTranscripts(transcripts: any[]): string {
  if (!Array.isArray(transcripts) || transcripts.length === 0) return '';
  const transcriptTexts = transcripts.map(t => {
    if (typeof t === 'string') return t;
    if (t.results?.transcripts?.[0]?.transcript) return t.results.transcripts[0].transcript;
    if (t.transcription?.results?.transcripts?.[0]?.transcript) return t.transcription.results.transcripts[0].transcript;
    if (t.results?.items) {
      return t.results.items.map(item => item.alternatives?.[0]?.content || '').join(' ').replace(/\s+/g, ' ').trim();
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

const TinderCard = ({
  item,
  summaries,
  onSwipe,
  isTop,
  isNext,
  isSwiping,
  setIsSwiping,
  onPress,
  mode,
  setMode,
  loadingSummary,
  index,
  totalCards
}: {
  item: GroupChat,
  summaries: { [key: string]: Summary | undefined },
  onSwipe: (id: string) => void,
  isTop: boolean,
  isNext: boolean,
  isSwiping: boolean,
  setIsSwiping: (swiping: boolean) => void,
  onPress: () => void,
  mode: string,
  setMode: (mode: string) => void,
  loadingSummary: boolean,
  index: number,
  totalCards: number
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  // Calculate scale and offset for stack effect
  const stackScale = isTop ? 1 : 1 - (index * 0.035);
  const stackOffsetY = index * 18;
  const stackOffsetX = index * 8;

  // Reset position when card becomes top, but only if not already at 0
  useEffect(() => {
    if (isTop && !isSwiping) {
      translateX.stopAnimation((x) => {
        if (x !== 0) {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: false,
            tension: 100,
            friction: 8,
          }).start();
        }
      });
      translateY.stopAnimation((y) => {
        if (y !== 0) {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: false,
            tension: 100,
            friction: 8,
          }).start();
        }
      });
      scale.stopAnimation((s) => {
        if (s !== 1) {
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: false,
            tension: 100,
            friction: 8,
          }).start();
        }
      });
    }
  }, [isTop, isSwiping, translateX, translateY, scale]);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (_, gestureState) => {
      if (isTop) {
        setIsSwiping(true);
        translateX.setValue(gestureState.dx);
        const rotation = gestureState.dx / (screenWidth / 2) * 30;
        rotate.setValue(rotation);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (isTop) {
        setIsSwiping(false);
        if (Math.abs(gestureState.dx) > screenWidth / 3) {
          const direction = gestureState.dx > 0 ? 1 : -1;
          Animated.spring(translateX, {
            toValue: direction * screenWidth,
            velocity: gestureState.vx,
            damping: 20,
            stiffness: 200,
            useNativeDriver: true,
          }).start();
          Animated.spring(rotate, {
            toValue: direction * 30,
            velocity: gestureState.vx,
            damping: 20,
            stiffness: 200,
            useNativeDriver: true,
          }).start();
          onSwipe(item._id);
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            velocity: gestureState.vx,
            damping: 20,
            stiffness: 200,
            useNativeDriver: true,
          }).start();
          Animated.spring(rotate, {
            toValue: 0,
            velocity: gestureState.vx,
            damping: 20,
            stiffness: 200,
            useNativeDriver: true,
          }).start();
        }
      }
    },
  });

  const rotation = translateX.interpolate({
    inputRange: [-screenWidth, 0, screenWidth],
    outputRange: ['-15deg', '0deg', '15deg'],
    extrapolate: 'clamp',
  });

  // Info rendering (shared for top and next card)
  const renderInfo = () => (
    <>
      {/* Mode Toggle */}
      <View style={styles.modeToggleContainer}>
        {SUMMARY_MODES.map((m) => (
          <Pressable
            key={m.key}
            style={[styles.modeToggleButton, mode === m.key && styles.modeToggleButtonActive]}
            onPress={() => setMode(m.key)}
          >
            <Text style={[styles.modeToggleText, mode === m.key && styles.modeToggleTextActive]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.cardHeader}>
        <View style={styles.groupAvatar}>
          {(() => {
            const displayName = item.name && typeof item.name === 'string' && item.name.trim().length > 0
              ? item.name.trim()
              : 'Unnamed';
            const avatarLetter = displayName.charAt(0).toUpperCase();
            return (
              <Text style={styles.groupAvatarText}>
                {avatarLetter}
              </Text>
            );
          })()}
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
            <ActivityIndicator size="large" color="#fff" />
            <Text style={{color:'#fff',marginTop:12}}>Loading summary...</Text>
          </View>
        ) : summaries[item._id] ? (
          <View style={styles.summaryContainer}>
            <Text style={styles.summaryLabel}>SUMMARY</Text>
            <Text style={styles.summaryText}>{summaries[item._id]?.summary ?? ''}</Text>
            <View style={styles.summaryFooter}>
              <Text style={styles.summaryMeta}>
                {summaries[item._id]?.messageCount ?? 0} messages
              </Text>
              <Text style={styles.summaryDate}>
                {summaries[item._id]?.lastUpdated ? new Date(summaries[item._id]!.lastUpdated).toLocaleDateString() : ''}
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
    </>
  );

  // Animated width and height for next card's mask (peek feature)
  const maskWidth = translateX.interpolate({
    inputRange: [-CARD_WIDTH, 0, CARD_WIDTH],
    outputRange: [CARD_WIDTH, 0, CARD_WIDTH],
    extrapolate: 'clamp',
  });
  const maskHeight = translateY.interpolate({
    inputRange: [-CARD_HEIGHT, 0, CARD_HEIGHT],
    outputRange: [CARD_HEIGHT, 0, CARD_HEIGHT],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.cardContainer,
        {
          zIndex: totalCards - index,
          transform: [
            { translateX: isTop ? translateX : stackOffsetX },
            { translateY: isTop ? translateY : stackOffsetY },
            { rotate: isTop ? rotate : '0deg' },
            { scale: stackScale },
          ],
        },
      ]}
      {...(isTop ? panResponder.panHandlers : {})}
    >
      <TouchableOpacity
        style={styles.card}
        onPress={() => !isSwiping && onPress()}
        activeOpacity={0.95}
        disabled={isSwiping || !isTop}
      >
        <LinearGradient
          colors={["#23272A", "#282828", "#26A7DE", "#fff0"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardGradient}
        >
          {isTop && renderInfo()}
          {isNext && (
            <Animated.View style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: maskWidth,
              height: maskHeight,
              overflow: 'hidden',
              zIndex: 20,
              pointerEvents: 'none',
            }}>
              <View style={{ flex: 1 }}>{renderInfo()}</View>
            </Animated.View>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
};

const UnreadSummariesPopup = ({ 
  onClose, 
  onViewSummaries,
  unreadCount,
  isLoading 
}: { 
  onClose: () => void, 
  onViewSummaries: () => void,
  unreadCount: number,
  isLoading: boolean
}) => {
  return (
    <View style={styles.popupContainer}>
      <BlurView intensity={20} style={styles.popupBlur}>
        <View style={styles.popupContent}>
          {isLoading ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <>
              <Text style={styles.popupTitle}>
                You have {unreadCount} unread {unreadCount === 1 ? 'summary' : 'summaries'}
              </Text>
              <Text style={styles.popupSubtitle}>
                Would you like to catch up on your unread messages?
              </Text>
              <View style={styles.popupButtons}>
                <TouchableOpacity 
                  style={[styles.popupButton, styles.primaryButton]} 
                  onPress={onViewSummaries}
                  disabled={isLoading}
                >
                  <Text style={styles.buttonText}>View Summaries</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.popupButton, styles.secondaryButton]} 
                  onPress={onClose}
                  disabled={isLoading}
                >
                  <Text style={styles.buttonText}>Not Now</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </BlurView>
    </View>
  );
};

const AllCaughtUpScreen = ({ onClose }: { onClose: () => void }) => {
  return (
    <View style={styles.allCaughtUpContainer}>
      <BlurView intensity={20} style={styles.allCaughtUpBlur}>
        <View style={styles.allCaughtUpContent}>
          <Ionicons name="checkmark-circle" size={64} color="#26A7DE" />
          <Text style={styles.allCaughtUpTitle}>All Caught Up!</Text>
          <Text style={styles.allCaughtUpSubtitle}>
            You've read all your unread summaries
          </Text>
          <TouchableOpacity 
            style={[styles.popupButton, styles.primaryButton]} 
            onPress={onClose}
          >
            <Text style={styles.buttonText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </BlurView>
    </View>
  );
};

const AnimatedGradientBackground = () => {
  const animation1 = useRef(new Animated.Value(0)).current;
  const animation2 = useRef(new Animated.Value(0)).current;
  const animation3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const startAnimation = () => {
      Animated.parallel([
        Animated.loop(
          Animated.sequence([
            Animated.timing(animation1, {
              toValue: 1,
              duration: 15000,
              useNativeDriver: true,
            }),
            Animated.timing(animation1, {
              toValue: 0,
              duration: 15000,
              useNativeDriver: true,
            }),
          ])
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(animation2, {
              toValue: 1,
              duration: 20000,
              useNativeDriver: true,
            }),
            Animated.timing(animation2, {
              toValue: 0,
              duration: 20000,
              useNativeDriver: true,
            }),
          ])
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(animation3, {
              toValue: 1,
              duration: 25000,
              useNativeDriver: true,
            }),
            Animated.timing(animation3, {
              toValue: 0,
              duration: 25000,
              useNativeDriver: true,
            }),
          ])
        ),
      ]).start();
    };

    startAnimation();
  }, []);

  const translateX1 = animation1.interpolate({
    inputRange: [0, 1],
    outputRange: [-screenWidth * 0.5, screenWidth * 0.5],
  });

  const translateY1 = animation1.interpolate({
    inputRange: [0, 1],
    outputRange: [-screenHeight * 0.5, screenHeight * 0.5],
  });

  const translateX2 = animation2.interpolate({
    inputRange: [0, 1],
    outputRange: [screenWidth * 0.5, -screenWidth * 0.5],
  });

  const translateY2 = animation2.interpolate({
    inputRange: [0, 1],
    outputRange: [screenHeight * 0.5, -screenHeight * 0.5],
  });

  const translateX3 = animation3.interpolate({
    inputRange: [0, 1],
    outputRange: [-screenWidth * 0.3, screenWidth * 0.3],
  });

  const translateY3 = animation3.interpolate({
    inputRange: [0, 1],
    outputRange: [screenHeight * 0.3, -screenHeight * 0.3],
  });

  return (
    <View style={styles.animatedBackgroundContainer}>
      <Animated.View
        style={[
          styles.gradientBlob,
          {
            transform: [{ translateX: translateX1 }, { translateY: translateY1 }],
          },
        ]}
      >
        <LinearGradient
          colors={['#26A7DE', '#282828']}
          style={styles.gradientBlobInner}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.gradientBlob,
          {
            transform: [{ translateX: translateX2 }, { translateY: translateY2 }],
          },
        ]}
      >
        <LinearGradient
          colors={['#282828', '#282828']}
          style={styles.gradientBlobInner}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.gradientBlob,
          {
            transform: [{ translateX: translateX3 }, { translateY: translateY3 }],
          },
        ]}
      >
        <LinearGradient
          colors={['#00FFB4', '#2979FF']}
          style={styles.gradientBlobInner}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>
    </View>
  );
};

// --- SummariesScreen is now deprecated. Do not use this file as a screen. ---
// export default function SummariesScreen() { ... }
// (Comment out or remove the export and main function body)

// You may keep helper functions and types for reference, but do not export a default screen. 
export { TinderCard }; 