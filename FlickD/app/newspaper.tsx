import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio, ResizeMode, Video } from 'expo-av';
import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
<<<<<<< Updated upstream
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
=======
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
>>>>>>> Stashed changes
import Animated, { FadeInUp, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaView as SNSafeAreaView } from 'react-native-safe-area-context';
import GradientWavesBackground from '../components/GradientWavesBackground';
import { useAuth } from './context/AuthContext';
import { useGroupChatContext } from './context/GroupChatContext';
import { getUserNewspapers, NewspaperSummary } from './services/newspaperService';
import { generateSummary } from './services/openAIService';

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
};

const API_URL = Constants.expoConfig?.extra?.API_URL;

// Explicit prop types
interface MediaPreviewProps {
  media: { type: string; uri: string }[];
}

function MediaPreview({ media }: MediaPreviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{ type: string; uri: string } | null>(null);
  const [imageError, setImageError] = useState<{[key: string]: boolean}>({});
  // Audio modal state
  const [audioSound, setAudioSound] = useState<Audio.Sound | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioPosition, setAudioPosition] = useState(0);
  const [audioDuration, setAudioDuration] = useState(1);

  if (!media || media.length === 0) return null;

  const handleScroll = (event: any) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / event.nativeEvent.layoutMeasurement.width);
    setCurrentIndex(index);
  };

  const onLayout = (event: any) => {
    setContainerWidth(event.nativeEvent.layout.width);
  };

  const handleImageError = (idx: number) => {
    setImageError(prev => ({...prev, [idx]: true}));
  };

  const handleMediaPress = async (item: { type: string; uri: string }) => {
    setSelectedMedia(item);
    setModalVisible(true);
    if (item.type === 'audio') {
      // Load audio
      try {
        if (audioSound) {
          await audioSound.unloadAsync();
          setAudioSound(null);
        }
        const { sound } = await Audio.Sound.createAsync(
          { uri: item.uri },
          { shouldPlay: false },
          (status) => {
            if (status.isLoaded) {
              setAudioPosition(status.positionMillis || 0);
              setAudioDuration(status.durationMillis || 1);
              setIsAudioPlaying(status.isPlaying || false);
            }
          }
        );
        setAudioSound(sound);
        const status = await sound.getStatusAsync();
        setAudioDuration(status.isLoaded && status.durationMillis ? status.durationMillis : 1);
        setAudioPosition(status.isLoaded && status.positionMillis ? status.positionMillis : 0);
      } catch (e) {
        // ignore
      }
    }
  };

  const closeModal = async () => {
    setModalVisible(false);
    setSelectedMedia(null);
    if (audioSound) {
      await audioSound.unloadAsync();
      setAudioSound(null);
    }
    setIsAudioPlaying(false);
    setAudioPosition(0);
    setAudioDuration(1);
  };

  const handleAudioPlayPause = async () => {
    if (!audioSound) return;
    const status = await audioSound.getStatusAsync();
    if (status.isLoaded) {
      if (status.isPlaying) {
        await audioSound.pauseAsync();
      } else {
        await audioSound.playAsync();
      }
    }
  };

  const handleAudioSeek = async (position: number) => {
    if (audioSound) {
      await audioSound.setPositionAsync(position);
    }
  };

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const renderMediaItem = (item: { type: string; uri: string }, idx: number) => {
    if (item.type === 'image') {
      return (
        <View style={styles.mediaContainer}>
          <Image 
            source={{ uri: imageError[idx] ? 'https://picsum.photos/400/300' : item.uri }} 
            style={styles.mediaImage} 
            resizeMode="cover"
            onError={() => handleImageError(idx)}
          />
        </View>
      );
    } 
    
    if (item.type === 'video') {
      return (
        <View style={styles.mediaVideoPlaceholder}>
          <Image 
            source={{ uri: 'https://picsum.photos/400/300?blur=2' }} 
            style={styles.mediaImage} 
            resizeMode="cover" 
          />
          <View style={styles.mediaOverlay}>
            <Ionicons name="play-circle" size={56} color="#26A7DE" style={{ opacity: 0.95, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 28 }} />
          </View>
        </View>
      );
    }
    
    if (item.type === 'audio') {
      return (
        <View style={styles.mediaAudioPlaceholder}>
          <View style={styles.audioCard}>
            <Ionicons name="musical-notes-outline" size={32} color="#fff" style={{ opacity: 0.8 }} />
            <Text style={styles.audioText}>Audio Clip</Text>
          </View>
        </View>
      );
    }
    
    return null;
  };

  return (
    <View onLayout={onLayout} style={{ width: '100%' }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={{ width: '100%' }}
        contentContainerStyle={{ width: containerWidth * media.length }}
      >
        {media.map((item, idx) => (
          <Pressable 
            key={idx} 
            style={[styles.mediaContainer, { width: containerWidth }]} 
            onPress={() => handleMediaPress(item)}
          >
            {renderMediaItem(item, idx)}
          </Pressable>
        ))}
      </ScrollView>
      {/* Carousel indicators */}
      {media.length > 1 && (
        <View style={styles.carouselIndicators}>
          {media.map((_, idx) => (
            <View
              key={idx}
              style={[
                styles.carouselDot,
                currentIndex === idx && styles.carouselDotActive,
              ]}
            />
          ))}
        </View>
      )}
      {/* Media Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <TouchableWithoutFeedback onPress={closeModal}>
          <View style={styles.modalBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                {selectedMedia && selectedMedia.type === 'image' && (
                  <Image 
                    source={{ uri: selectedMedia.uri }} 
                    style={styles.modalImage} 
                    resizeMode="contain"
                    defaultSource={{ uri: 'https://picsum.photos/400/300' }}
                  />
                )}
                {selectedMedia && selectedMedia.type === 'video' && (
                  <Video
                    source={{ uri: selectedMedia.uri }}
                    style={styles.modalImage}
                    resizeMode={ResizeMode.CONTAIN}
                    useNativeControls
                    shouldPlay
                  />
                )}
                {selectedMedia && selectedMedia.type === 'audio' && (
                  <View style={styles.audioModalContainer}>
                    <Ionicons name={isAudioPlaying ? 'pause' : 'play'} size={48} color="#26A7DE" onPress={handleAudioPlayPause} style={{ marginBottom: 16 }} />
                    <View style={styles.audioProgressBarContainer}>
                      <View style={[styles.audioProgressBar, { width: `${(audioPosition / audioDuration) * 100}%` }]} />
                    </View>
                    <View style={styles.audioTimeRow}>
                      <Text style={styles.audioTime}>{formatTime(audioPosition)}</Text>
                      <Text style={styles.audioTime}>{formatTime(audioDuration)}</Text>
                    </View>
                  </View>
                )}
                <Pressable onPress={closeModal} style={styles.closeButton}>
                  <Ionicons name="close" size={24} color="#888" />
                </Pressable>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

interface SummaryCardProps {
  summary: NewspaperSummary;
  highlight: boolean;
}

function SummaryCard({ summary, highlight, onPress }: SummaryCardProps & { onPress?: () => void }) {
  const scale = useSharedValue(1);
  const [pressed, setPressed] = React.useState(false);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    shadowColor: '#000',
    shadowOpacity: pressed ? 0.18 : 0.10,
    shadowRadius: pressed ? 32 : 24,
    borderColor: 'transparent',
    borderWidth: 0,
  }));

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(16).mass(0.8)}
      style={[styles.summaryCard, animatedStyle]}
    >
      <Pressable
        onPressIn={() => { scale.value = withSpring(0.97); setPressed(true); }}
        onPressOut={() => { scale.value = withSpring(1); setPressed(false); }}
        onPress={onPress}
        style={{ borderRadius: 28, overflow: 'hidden' }}
      >
        <BlurView intensity={highlight ? 130 : 110} tint="dark" style={styles.innerGlassBlur}>      
          <MediaPreview media={summary.media || []} />
          <View style={styles.cardContent}>
            <Text style={[styles.cardHeadline, { fontSize: 22, fontWeight: '900', letterSpacing: 0.1 }]}>{summary.headline}</Text>
            <Text style={styles.cardSummary}>{summary.summary}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.cardTimestamp}>{summary.timestamp}</Text>
              <Text style={styles.cardGroup}>in {summary.group}</Text>
            </View>
          </View>
        </BlurView>
      </Pressable>
    </Animated.View>
  );
}

export default function Newspaper() {
  const router = useRouter();
  const { user } = useAuth();
  const { groupChats, socket } = useGroupChatContext();
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedSummary, setSelectedSummary] = useState<NewspaperSummary | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaries, setSummaries] = useState<NewspaperSummary[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [lastSummaryGeneration, setLastSummaryGeneration] = useState<Date | null>(null);
  
  // Live message tracking state
  const [messageCountTracker, setMessageCountTracker] = useState<{ [groupId: string]: { count: number; lastReset: number } }>({});
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);

  // Initialize message tracking for user's groups
  useEffect(() => {
    const initializeMessageTracking = async () => {
      if (!user?.userId || !groupChats.length) return;
      
      try {
        // Load existing tracking data from storage
        const stored = await AsyncStorage.getItem(`newspaper_message_tracking_${user.userId}`);
        if (stored) {
          const parsedData = JSON.parse(stored);
          setMessageCountTracker(parsedData);
        } else {
          // Initialize tracking for all user groups
          const initialTracker: { [groupId: string]: { count: number; lastReset: number } } = {};
          groupChats.forEach(group => {
            initialTracker[group._id] = { count: 0, lastReset: Date.now() };
          });
          setMessageCountTracker(initialTracker);
          await AsyncStorage.setItem(`newspaper_message_tracking_${user.userId}`, JSON.stringify(initialTracker));
        }
      } catch (error) {
        console.error('[Newspaper] Error initializing message tracking:', error);
      }
    };

    initializeMessageTracking();
  }, [user?.userId, groupChats]);

  // Live message tracking - Listen for new messages and auto-generate summaries
  useEffect(() => {
    if (!socket || !user?.userId) return;

    const handleNewMessage = async (message: any) => {
      // Only track messages from other users (not own messages)
      if (message.senderId === user.userId) return;
      
      // Only track voice and text messages
      if (!['voice', 'text'].includes(message.type)) return;
      
      const groupId = message.groupChatId;
      
      // Update message count for this group
      setMessageCountTracker(prev => {
        const currentData = prev[groupId] || { count: 0, lastReset: Date.now() };
        const newCount = currentData.count + 1;
        
        const updatedTracker = {
          ...prev,
          [groupId]: {
            ...currentData,
            count: newCount
          }
        };
        
        // Save to storage
        AsyncStorage.setItem(`newspaper_message_tracking_${user.userId}`, JSON.stringify(updatedTracker))
          .catch(error => console.error('[Newspaper] Error saving message tracking:', error));
        
        // Check if we've hit the 10-message threshold
        if (newCount >= 10 && !isAutoGenerating) {
          triggerAutoSummaryGeneration(groupId, updatedTracker);
        }
        
        return updatedTracker;
      });
    };

    socket.on('new_message', handleNewMessage);

    return () => {
      socket.off('new_message', handleNewMessage);
    };
  }, [socket, user?.userId, isAutoGenerating]);

  // Automatically fetch user-specific summaries on mount
  useEffect(() => {
    if (user?.userId) {
      handleFetchUserNewspapers();
    }
  }, [user?.userId]);

  // Set up periodic summary generation
  useEffect(() => {
    if (!user?.userId) return;

    const generatePeriodicSummaries = async () => {
      const now = new Date();
      const lastGen = lastSummaryGeneration;
      
      // Generate summaries if:
      // 1. Never generated before (lastGen is null)
      // 2. Last generation was more than 6 hours ago
      if (!lastGen || (now.getTime() - lastGen.getTime()) > 6 * 60 * 60 * 1000) {
        try {
          // Get user's group chats
          
          const response = await fetch(`${API_URL}/groupchats?userId=${user.userId}`, {
            headers: {
              'Content-Type': 'application/json',
            },
          });

          
          if (!response.ok) {
            console.error('Failed to fetch group chats for periodic summary - response not ok - UPDATED VERSION');
            return;
          }

          // Try to parse the response
          let userGroups;
          try {
            const responseText = await response.text();
            userGroups = JSON.parse(responseText);
          } catch (parseError) {
            console.error('Failed to parse group chats response:', parseError);
            return;
          }
          
          // Check if any group has enough activity
          let hasActiveGroups = false;
          for (const group of userGroups) {
            const oneDayAgo = new Date();
            oneDayAgo.setDate(oneDayAgo.getDate() - 1);
            
            const messagesResponse = await fetch(
              `${API_URL}/messages/${group._id}?userId=${user.userId}&since=${oneDayAgo.toISOString()}`,
              {
                headers: {
                  'Content-Type': 'application/json',
                },
              }
            );

            if (!messagesResponse.ok) continue;

            const recentMessages = await messagesResponse.json();
            
            // Extract transcripts from voice messages using the same robust logic as the backend
            let transcripts: string[] = [];
            let transcriptCount = 0;
            
            for (const msg of recentMessages) {
              if (
                msg.type === 'voice' &&
                msg.transcription &&
                msg.transcription.results &&
                Array.isArray(msg.transcription.results.transcripts)
              ) {
                for (const transcriptObj of msg.transcription.results.transcripts) {
                  let transcriptText = '';
                  if (typeof transcriptObj.transcript === 'string') {
                    transcriptText = transcriptObj.transcript;
                  } else if (Array.isArray(transcriptObj.items)) {
                    transcriptText = transcriptObj.items.map((item: any) => item.alternatives?.[0]?.content || "").join(" ");
                  }
                  if (transcriptText && transcriptText.trim().length > 0) {
                    const sender = msg.senderName || "Unknown";
                    transcripts.push(`${sender}: ${transcriptText.trim()}`);
                    transcriptCount++;
                  }
                }
              }
            }
            
            transcripts = transcripts.filter(Boolean);
            
                      // Only generate summary if there are 10 or more transcripts
          if (transcriptCount < 10) {
              continue;
            }

            // Call the backend newspaper endpoint to generate AND save the summary
            const summaryResponse = await fetch(`${API_URL}/newspaper/user/${user.userId}`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });

            if (!summaryResponse.ok) {
            }
          }
        } catch (error) {
          console.error('Error in periodic summary generation:', error);
        }
      }
    };

    // Run immediately on mount
    generatePeriodicSummaries();

    // Set up interval to check every hour
    const interval = setInterval(generatePeriodicSummaries, 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user?.userId, lastSummaryGeneration]);

  // Add auto-refresh interval to poll for new summaries every 30 minutes
  useEffect(() => {
    if (!user?.userId) return;
    const interval = setInterval(() => {
      handleFetchUserNewspapers();
    }, 1800000); // 30 minutes
    return () => clearInterval(interval);
  }, [user?.userId]);

  // Auto-generate summary for a specific group when threshold is reached
  const triggerAutoSummaryGeneration = async (groupId: string, currentTracker: { [groupId: string]: { count: number; lastReset: number } }) => {
    if (isAutoGenerating) {
      return;
    }

    setIsAutoGenerating(true);
    
    try {
      // Find the group
      const targetGroup = groupChats.find(g => g._id === groupId);
      if (!targetGroup) {
        return;
      }

      // Get recent messages for this group (last 10-15 messages or since last reset)
      const lastReset = currentTracker[groupId]?.lastReset || Date.now() - (24 * 60 * 60 * 1000);
      const sinceDate = new Date(lastReset);
      
      const messagesResponse = await fetch(
        `${API_URL}/messages/${groupId}?userId=${user?.userId}&since=${sinceDate.toISOString()}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!messagesResponse.ok) {
        console.error('[Newspaper] Failed to fetch recent messages for auto-generation');
        return;
      }

      const recentMessages = await messagesResponse.json();
      
      // Extract transcripts from voice messages using the same robust logic as the backend
      let transcripts: string[] = [];
      let transcriptCount = 0;
      
      for (const msg of recentMessages) {
        if (
          msg.type === 'voice' &&
          msg.transcription &&
          msg.transcription.results &&
          Array.isArray(msg.transcription.results.transcripts)
        ) {
          for (const transcriptObj of msg.transcription.results.transcripts) {
            let transcriptText = '';
            if (typeof transcriptObj.transcript === 'string') {
              transcriptText = transcriptObj.transcript;
            } else if (Array.isArray(transcriptObj.items)) {
              transcriptText = transcriptObj.items.map((item: any) => item.alternatives?.[0]?.content || "").join(" ");
            }
            if (transcriptText && transcriptText.trim().length > 0) {
              const sender = msg.senderName || "Unknown";
              transcripts.push(`${sender}: ${transcriptText.trim()}`);
              transcriptCount++;
            }
          }
        }
      }
      
      transcripts = transcripts.filter(Boolean);

      if (transcriptCount < 10) {
        return;
      }

      // Generate the summary
      const result = await generateSummary({
        transcripts,
        groupName: targetGroup.name
      });

      if (result) {
        // Reset the message count for this group
        const resetTracker = {
          ...currentTracker,
          [groupId]: {
            count: 0,
            lastReset: Date.now()
          }
        };
        
        setMessageCountTracker(resetTracker);
        await AsyncStorage.setItem(`newspaper_message_tracking_${user?.userId}`, JSON.stringify(resetTracker));
        
        // Refresh the newspaper to show the new summary
        await handleFetchUserNewspapers();
        
      }
      
    } catch (error) {
      console.error('[Newspaper] Error in auto-summary generation:', error);
    } finally {
      setIsAutoGenerating(false);
    }
  };

  const handleFetchUserNewspapers = async () => {
    if (!user?.userId) return;
    
    setApiLoading(true);
    setApiError(null);
    try {
      const userNewspapers = await getUserNewspapers(user.userId);
      setSummaries(userNewspapers);

      // If no summaries exist, generate them automatically
      if (userNewspapers.length === 0) {
        await handleGenerateSummary();
        // Fetch again after generation
        const updatedNewspapers = await getUserNewspapers(user.userId);
        setSummaries(updatedNewspapers);
      }
    } catch (err: any) {
      setApiError(err.message || 'Failed to fetch your newspaper summaries');

    } finally {
      setApiLoading(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!user?.userId) {
      setApiError('Please log in to generate summaries');
      return;
    }

    setIsGeneratingSummary(true);
    try {
      // Get user's group chats
      const response = await fetch(`${API_URL}/groupchats?userId=${user.userId}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch group chats');
      }

      const userGroups = await response.json();
      
      if (!userGroups.length) {
        setApiError('You are not a member of any group chats');
        return;
      }

      // Generate summaries for each group
      let hasGroupsWithEnoughTranscripts = false;
      
      for (const group of userGroups) {
        try {
          // Get group messages from the last 24 hours
          const oneDayAgo = new Date();
          oneDayAgo.setDate(oneDayAgo.getDate() - 1);
          
          const messagesResponse = await fetch(
            `${API_URL}/messages/${group._id}?userId=${user.userId}&since=${oneDayAgo.toISOString()}`,
            {
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );

          if (!messagesResponse.ok) {
            console.error(`Failed to fetch messages for group ${group.name}`);
            continue;
          }

          const messages = await messagesResponse.json();
          
          // Extract transcripts from voice messages using the same robust logic as the backend
          let transcripts: string[] = [];
          let transcriptCount = 0;
          
          for (const msg of messages) {
            if (
              msg.type === 'voice' &&
              msg.transcription &&
              msg.transcription.results &&
              Array.isArray(msg.transcription.results.transcripts)
            ) {
              for (const transcriptObj of msg.transcription.results.transcripts) {
                let transcriptText = '';
                if (typeof transcriptObj.transcript === 'string') {
                  transcriptText = transcriptObj.transcript;
                } else if (Array.isArray(transcriptObj.items)) {
                  transcriptText = transcriptObj.items.map((item: any) => item.alternatives?.[0]?.content || "").join(" ");
                }
                if (transcriptText && transcriptText.trim().length > 0) {
                  const sender = msg.senderName || "Unknown";
                  transcripts.push(`${sender}: ${transcriptText.trim()}`);
                  transcriptCount++;
                }
              }
            }
          }
          
          transcripts = transcripts.filter(Boolean);
          
          // Only generate summary if there are 10 or more transcripts
          if (transcriptCount < 10) {
            continue;
          }
          hasGroupsWithEnoughTranscripts = true;
        } catch (error) {
          console.error(`Error checking group ${group.name}:`, error);
        }
      }

      // If any groups have enough transcripts, call the backend to generate and save summaries
      if (hasGroupsWithEnoughTranscripts) {
        
        const summaryResponse = await fetch(`${API_URL}/newspaper/user/${user.userId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (summaryResponse.ok) {
        } else {
        }
      } else {
      }

      // Refresh the newspapers after generating new ones
      await handleFetchUserNewspapers();
    } catch (error) {
      console.error('Error generating summaries:', error);
      setApiError('Failed to generate summaries');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const openDetailModal = (summary: NewspaperSummary) => {
    setSelectedSummary(summary);
    setDetailModalVisible(true);
  };

  const closeDetailModal = () => {
    setDetailModalVisible(false);
    setSelectedSummary(null);
  };

  const highlight = summaries[0];
  const rest = summaries.slice(1);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <GradientWavesBackground />
      <BlurView intensity={90} tint="dark" style={styles.fullGlassBlur}>
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            <SafeAreaView style={{flex: 1}} edges={['top']}>
              <View 
                style={[
                  styles.newspaperSection,
                  {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 1,
                  }
                ]}
              >
                <View style={styles.header}>
                  <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                    activeOpacity={0.7}
                    accessibilityLabel="Go back"
                  >
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                  </TouchableOpacity>
                  
                  <Text style={styles.headerTitle}>Your Newspapers</Text>
                  
                  <View style={styles.placeholderRight} />
                </View>
                <ScrollView contentContainerStyle={{ paddingTop: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
                  {!user?.userId ? (
                    <Text style={styles.noContentText}>Please log in to view your newspaper</Text>
                  ) : apiLoading || isGeneratingSummary || isAutoGenerating ? (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator size="large" color="#26A7DE" />
                      <Text style={styles.loadingText}>
                        {isAutoGenerating ? 'Auto-generating live summary...' : 
                         isGeneratingSummary ? 'Generating new summaries...' : 'Loading your newspaper...'}
                      </Text>
                    </View>
                  ) : summaries.length === 0 ? (
                    <Text style={styles.noContentText}>No newspaper summaries available for your groups.</Text>
                  ) : (
                    <>
                      {highlight && <SummaryCard summary={highlight} highlight={true} onPress={() => openDetailModal(highlight)} />}
                      {rest.map((item) => (
                        <SummaryCard key={item.id} summary={item} highlight={false} onPress={() => openDetailModal(item)} />
                      ))}
                    </>
                  )}
                </ScrollView>
              </View>
            </SafeAreaView>
          </View>
        </View>
      </BlurView>

      {/* Detailed Summary Modal */}
      <Modal
        visible={detailModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeDetailModal}
      >
        <TouchableWithoutFeedback onPress={closeDetailModal}>
          <View style={styles.modalBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                {selectedSummary && (
                  <ScrollView style={styles.newspaperLayout} showsVerticalScrollIndicator={false}>
                    {/* Newspaper Header */}
                    <View style={styles.newspaperHeader}>
                      <View style={styles.newspaperTitleSection}>
                        <Text style={styles.newspaperTitle}>CHITCHAT</Text>
                        <Text style={styles.newspaperSubtitle}>Digital News</Text>
                      </View>
                      <View style={styles.newspaperDateSection}>
                        <Text style={styles.newspaperDate}>{new Date().toLocaleDateString('en-US', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })}</Text>
                        <Text style={styles.newspaperTime}>{selectedSummary.timestamp}</Text>
                      </View>
                    </View>

                    {/* Group Info Section */}
                    <View style={styles.groupInfoSection}>
                      <View style={styles.groupAvatarContainer}>
                        {selectedSummary.groupIcon ? (
                          <Image 
                            source={{ uri: selectedSummary.groupIcon }} 
                            style={styles.groupAvatarImage}
                          />
                        ) : (
                          <View style={[styles.groupAvatar, { backgroundColor: `hsl(${((selectedSummary.groupName || 'A').charCodeAt(0) * 7) % 360}, 70%, 60%)` }]}>
                            <Text style={styles.groupAvatarText}>
                              {(selectedSummary.groupName || 'A').charAt(0).toUpperCase()}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.groupDetails}>
                        <Text style={styles.groupName}>{selectedSummary.groupName || 'Unknown Group'}</Text>
                        <Text style={styles.messageCount}>{selectedSummary.messageCount || 0} messages</Text>
                      </View>
                    </View>

                    {/* Main Headline */}
                    <View style={styles.headlineSection}>
                      <Text style={styles.mainHeadline}>{selectedSummary.headline}</Text>
                    </View>

                    {/* Media Section */}
                    {selectedSummary.media && selectedSummary.media.length > 0 && (
                      <View style={styles.mediaSection}>
                        <MediaPreview media={selectedSummary.media} />
                      </View>
                    )}

                    {/* Article Content */}
                    <View style={styles.articleSection}>
                      {(() => {
                        const summaryParts = selectedSummary.summary.split('\n\n');
                        return (
                          <>
                            {summaryParts.slice(0, -1).map((part, index) => (
                              <Text key={index} style={styles.articleText}>
                                {part}
                              </Text>
                            ))}
                            {summaryParts.length > 1 && <View style={styles.summaryDivider} />}
                            <Text style={styles.currentArticleText}>
                              {summaryParts[summaryParts.length - 1]}
                            </Text>
                          </>
                        );
                      })()}
                    </View>

                    {/* Newspaper Footer */}
                    <View style={styles.newspaperFooter}>
                      <Text style={styles.footerText}>Generated by ChitChat AI</Text>
                      <Text style={styles.footerText}>© 2025 ChitChat News</Text>
                    </View>
                  </ScrollView>
                )}
                
                {/* Close Button */}
                <Pressable onPress={closeDetailModal} style={styles.closeButton}>
                  <Ionicons name="close" size={24} color="#888" />
                </Pressable>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {apiError && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{apiError}</Text>
        </View>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  newspaperSection: {
    flex: 1,
    backgroundColor: 'transparent',
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
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 60,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    flex: 1,
    textAlign: 'center',
  },
  settingsButton: {
    padding: 8,
    paddingRight: 16,
  },
  backButton: {
    padding: 8,
    paddingLeft: 16,
  },
  placeholderLeft: {
    width: 32,
    height: 32,
  },
  placeholderRight: {
    width: 32,
    height: 32,
  },
  summaryCard: {
    marginHorizontal: 20,
    marginBottom: 36,
    borderRadius: 28,
    backgroundColor: 'rgba(40,40,43,0.45)',
    borderWidth: 0,
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 16,
    overflow: 'hidden',
    padding: 0,
  },
  innerGlassBlur: {
    flex: 1,
    borderRadius: 28,
    backgroundColor: 'rgba(40,40,43,0.30)',
    borderWidth: 0,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 24,
    elevation: 10,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  mediaContainer: {
    width: '100%',
    height: 220,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#23272A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  mediaVideoPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  mediaOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  mediaAudioPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(40,40,43,0.7)',
  },
  audioCard: {
    backgroundColor: 'rgba(36, 37, 50, 0.55)',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#26A7DE',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  audioText: {
    color: '#fff',
    marginTop: 8,
    fontSize: 15,
    opacity: 0.8,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  cardContent: {
    padding: 18,
  },
  cardHeadline: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textShadowColor: '#23272A',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginBottom: 2,
  },
  highlightHeadline: {
    fontSize: 22,
    color: '#26A7DE',
    textShadowColor: '#23272A',
    textShadowRadius: 6,
  },
  cardSummary: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.85,
    marginBottom: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  cardTimestamp: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.6,
  },
  cardGroup: {
    color: '#26A7DE',
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.8,
  },
  carouselIndicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 12,
    zIndex: 10,
  },
  carouselDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 4,
  },
  carouselDotActive: {
    backgroundColor: '#26A7DE',
    width: 12,
    height: 8,
    borderRadius: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '100%',
    height: '100%',
    backgroundColor: '#28282B',
    borderRadius: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  modalImage: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
  },
  closeButton: {
    position: 'absolute',
    top: 40,
    right: 8,
    zIndex: 10,
    padding: 4,
  },
  audioModalContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(36, 37, 50, 0.55)',
    borderRadius: 18,
  },
  audioProgressBarContainer: {
    width: '80%',
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 3,
    marginVertical: 12,
    overflow: 'hidden',
  },
  audioProgressBar: {
    height: 6,
    backgroundColor: '#26A7DE',
    borderRadius: 3,
  },
  audioTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '80%',
    marginTop: 4,
  },
  audioTime: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 100,
  },
  loadingText: {
    color: '#fff',
    marginTop: 16,
    fontSize: 16,
    opacity: 0.8,
  },
  noContentText: {
    color: '#fff',
    textAlign: 'center',
    marginTop: 100,
    fontSize: 16,
    opacity: 0.7,
    paddingHorizontal: 32,
  },
  errorContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 0, 0, 0.3)',
  },
  errorText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 14,
  },
  newspaperLayout: {
    flex: 1,
    backgroundColor: '#28282B',
    paddingTop: 60,
  },
  newspaperHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  newspaperTitleSection: {
    flex: 1,
  },
  newspaperTitle: {
    color: '#26A7DE',
    fontSize: 28,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  newspaperSubtitle: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.7,
    marginTop: 2,
  },
  newspaperDateSection: {
    alignItems: 'flex-end',
  },
  newspaperDate: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.7,
    textAlign: 'right',
  },
  newspaperTime: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.7,
    textAlign: 'right',
    marginTop: 2,
  },
  groupInfoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: 'rgba(38, 167, 222, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  groupAvatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#23272A',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  groupAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupAvatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  groupDetails: {
    flex: 1,
    marginLeft: 12,
  },
  groupName: {
    color: '#26A7DE',
    fontSize: 16,
    fontWeight: 'bold',
  },
  messageCount: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.7,
    marginTop: 2,
  },
  headlineSection: {
    padding: 18,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#26A7DE',
  },
  mainHeadline: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    lineHeight: 28,
    textAlign: 'left',
  },
  mediaSection: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  articleSection: {
    padding: 18,
    paddingTop: 16,
    flex: 1,
  },
  articleText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.9,
    textAlign: 'justify',
  },
  newspaperFooter: {
    padding: 18,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  footerText: {
    color: '#fff',
    fontSize: 11,
    opacity: 0.6,
  },
  groupAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 12,
  },
  currentArticleText: {
    color: '#26A7DE',
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.8,
    textAlign: 'justify',
  },
<<<<<<< Updated upstream
}); 
=======
  // --- NYT-inspired styles ---
  nytModalBackdrop: {
    flex: 1,
    backgroundColor: '#f7f6f3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nytModalContent: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f7f6f3',
    borderRadius: 0,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  paperTexture: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  nytPageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 4,
    marginBottom: 2,
  },
  nytPageVol: {
    fontFamily: 'Georgia',
    fontSize: 12,
    color: '#444',
    fontWeight: '600',
  },
  nytPageDate: {
    fontFamily: 'Georgia',
    fontSize: 12,
    color: '#444',
    textAlign: 'center',
  },
  nytPageNum: {
    fontFamily: 'Georgia',
    fontSize: 12,
    color: '#444',
    fontWeight: '600',
  },
  nytNewspaperLayout: {
    flex: 1,
    backgroundColor: '#f7f6f3',
    paddingTop: 40,
    paddingHorizontal: 0,
  },
  nytMastheadSection: {
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 8,
  },
  nytMasthead: {
    fontFamily: 'Georgia',
    fontSize: 38,
    fontWeight: 'bold',
    letterSpacing: 2,
    color: '#222',
    textAlign: 'center',
  },
  nytMastheadUnderline: {
    width: 120,
    height: 2,
    backgroundColor: '#222',
    marginVertical: 4,
    alignSelf: 'center',
    opacity: 0.15,
  },
  nytSubtitle: {
    fontFamily: 'Georgia',
    fontSize: 16,
    color: '#444',
    opacity: 0.7,
    textAlign: 'center',
    marginBottom: 2,
  },
  nytHeadlineSection: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  nytHeadline: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: 'bold',
    color: '#111',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 32,
    paddingHorizontal: 10,
  },
  nytByline: {
    fontFamily: 'Georgia',
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 2,
  },
  nytGroupInfoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(38, 167, 222, 0.06)',
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(38, 167, 222, 0.1)',
  },
  nytGroupAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  nytGroupAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    backgroundColor: '#26A7DE',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  nytGroupAvatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  nytGroupDetails: {
    flex: 1,
  },
  nytGroupName: {
    color: '#222',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  nytMessageCount: {
    color: '#666',
    fontSize: 13,
    fontStyle: 'italic',
  },
  nytMediaSection: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  nytArticleSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  nytArticleColumns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  nytArticleText: {
    fontFamily: 'Georgia',
    color: '#222',
    fontSize: 16,
    lineHeight: 26,
    textAlign: 'left',
    marginBottom: 18,
  },
  nytArticleTextColumn: {
    fontFamily: 'Georgia',
    color: '#222',
    fontSize: 17,
    lineHeight: 28,
    textAlign: 'justify',
    marginBottom: 16,
    flexBasis: '48%',
    minWidth: 0,
    marginRight: 16,
  },
  nytDropCap: {
    fontFamily: 'Georgia',
    fontSize: 48,
    color: '#222',
    fontWeight: 'bold',
    lineHeight: 48,
    marginRight: 6,
    marginTop: 2,
  },
  nytSectionDivider: {
    height: 1,
    backgroundColor: '#ccc',
    marginHorizontal: 24,
    marginVertical: 12,
    opacity: 0.25,
  },
  nytFooter: {
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: 'transparent',
  },
  nytFooterText: {
    fontFamily: 'Georgia',
    color: '#888',
    fontSize: 12,
    opacity: 0.7,
    textAlign: 'center',
  },
  nytCloseButton: {
    position: 'absolute',
    top: 44,
    left: 16,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  epaperRoot: {
    flex: 1,
    backgroundColor: '#f7f7f5',
    paddingTop: TOP_SAFE_AREA,
    paddingHorizontal: 0,
  },
  epaperTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: '#000',
    backgroundColor: '#f7f7f5',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  epaperLogo: {
    fontFamily: 'Georgia',
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  epaperTopBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  epaperEdition: {
    fontFamily: 'Georgia',
    fontSize: 14,
    color: '#444',
    marginRight: 8,
    fontWeight: '500',
  },
  epaperDate: {
    fontFamily: 'Georgia',
    fontSize: 14,
    color: '#444',
    fontWeight: '500',
  },
  epaperMasthead: {
    fontFamily: 'Georgia',
    fontSize: 48,
    fontWeight: '300',
    letterSpacing: 6,
    color: '#000',
    textAlign: 'center',
    marginVertical: 16,
    paddingBottom: 12,
    backgroundColor: '#f7f7f5',
    borderBottomWidth: 3,
    borderBottomColor: '#000',
    textShadowColor: '#ddd',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  epaperGridScroll: {
    paddingBottom: 32,
    backgroundColor: '#fff',
  },
  epaperGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 8,
  },
  epaperGridMobile: {
    // 1 column
    gap: 0,
  },
  epaperGridTablet: {
    // 2 columns
    gap: 0,
  },
  epaperCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    margin: 8,
    padding: 12,
    minWidth: 0,
    borderRadius: 2,
    elevation: 1,
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    alignSelf: 'flex-start',
  },
  epaperCardImage: {
    width: '100%',
    height: 120,
    marginBottom: 8,
    borderRadius: 0,
    backgroundColor: '#eee',
  },
  epaperCardHeadline: {
    fontFamily: 'Georgia',
    fontSize: 18,
    fontWeight: 'bold',
    color: '#222',
    marginBottom: 4,
  },
  epaperCardSnippet: {
    fontSize: 14,
    color: '#444',
    marginBottom: 8,
  },
  epaperCardDivider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 8,
  },
  epaperCardByline: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
    textAlign: 'right',
  },
  epaperCloseButton: {
    position: 'absolute',
    top: 24,
    right: 16,
    zIndex: 10,
    padding: 8,
    backgroundColor: 'rgba(240,240,240,0.7)',
    borderRadius: 20,
  },
  // NYT-style newspaper layout styles
  newspaperLargeArticle: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    marginBottom: 8,
    borderRadius: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  newspaperLargeImage: {
    width: '100%',
    height: 140,
    marginBottom: 8,
    borderRadius: 0,
    backgroundColor: '#f5f5f5',
  },
  newspaperLargeHeadline: {
    fontFamily: 'Georgia',
    fontSize: 22,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 6,
    lineHeight: 26,
  },
  newspaperLargeText: {
    fontFamily: 'Georgia',
    fontSize: 15,
    color: '#333',
    lineHeight: 22,
    marginBottom: 8,
    textAlign: 'left',
  },
  newspaperByline: {
    fontFamily: 'Georgia',
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 4,
  },
  newspaperMediumArticle: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    padding: 10,
    marginBottom: 6,
    borderRadius: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  newspaperMediumImage: {
    width: 80,
    height: 60,
    borderRadius: 0,
    backgroundColor: '#f5f5f5',
    marginRight: 8,
  },
  newspaperMediumHeadline: {
    fontFamily: 'Georgia',
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
    lineHeight: 20,
  },
  newspaperMediumText: {
    fontFamily: 'Georgia',
    fontSize: 13,
    color: '#444',
    lineHeight: 18,
    textAlign: 'left',
  },
  newspaperSmallArticle: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#f0f0f0',
    padding: 8,
    marginBottom: 4,
    borderRadius: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  newspaperSmallHeadline: {
    fontFamily: 'Georgia',
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 3,
    lineHeight: 18,
  },
  newspaperSmallText: {
    fontFamily: 'Georgia',
    fontSize: 12,
    color: '#555',
    lineHeight: 16,
    textAlign: 'left',
  },
  // AP News Style Components
  apHeaderSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 3,
    borderBottomColor: '#e40046',
    backgroundColor: '#fff',
  },
  apLogoContainer: {
    width: 50,
    height: 50,
    backgroundColor: '#e40046',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  apLogo: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1,
  },
  apDate: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  apBreakingTag: {
    backgroundColor: '#e40046',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 20,
    marginVertical: 4,
    borderRadius: 2,
  },
  apBreakingText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  apFeaturedArticle: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginVertical: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    overflow: 'hidden',
    borderWidth: 0,
  },
  apFeaturedImage: {
    width: '100%',
    height: 200,
    backgroundColor: '#f0f0f0',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  apFeaturedContent: {
    padding: 18,
  },
  apFeaturedHeadline: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#000',
    lineHeight: 28,
    marginBottom: 8,
  },
  apFeaturedSummary: {
    fontSize: 16,
    color: '#555',
    lineHeight: 22,
    marginBottom: 12,
  },
  apMetadata: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  apByline: {
    fontSize: 14,
    color: '#26A7DE',
    fontWeight: '600',
    opacity: 0.8,
  },
  apTimestamp: {
    fontSize: 12,
    color: '#666',
  },
  apMoreCoverageSection: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginVertical: 8,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
  },
  apMoreCoverageTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#e40046',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  apSecondaryArticle: {
    flexDirection: 'row',
    backgroundColor: '#f8f8f8',
    padding: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  apSecondaryContent: {
    flex: 1,
    paddingRight: 12,
  },
  apSecondaryHeadline: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    lineHeight: 20,
    marginBottom: 4,
  },
  apSecondaryMeta: {
    fontSize: 12,
    color: '#26A7DE',
    fontWeight: '600',
    opacity: 0.8,
  },
  apSecondaryImage: {
    width: 80,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  apAdditionalSection: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  apMediumArticle: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#eee',
  },
  apSmallArticle: {
    backgroundColor: '#fff',
    padding: 10,
    marginBottom: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  apArticleContent: {
    flex: 1,
    paddingRight: 8,
  },
  apMediumHeadline: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    lineHeight: 20,
    marginBottom: 4,
  },
  apSmallHeadline: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000',
    lineHeight: 18,
    marginBottom: 3,
  },
  apMediumSummary: {
    fontSize: 14,
    color: '#555',
    lineHeight: 18,
    marginBottom: 6,
  },
  apArticleMeta: {
    fontSize: 12,
    color: '#666',
  },
  apThumbnailImage: {
    width: 60,
    height: 45,
    borderRadius: 4,
    backgroundColor: '#f5f5f5',
  },
  readMoreText: {
    fontSize: 12,
    color: '#26A7DE',
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  apSecondaryPreview: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
    marginBottom: 4,
  },
  apTopLatestSection: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginVertical: 8,
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#26A7DE',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
  },
  apTopLatestTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#e40046',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  apLatestArticle: {
    flexDirection: 'row',
    backgroundColor: '#f8f8f8',
    padding: 14,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  apLatestContent: {
    flex: 1,
    paddingRight: 12,
  },
  apLatestHeadline: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#000',
    lineHeight: 22,
    marginBottom: 6,
  },
  apLatestPreview: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    marginBottom: 8,
  },
  apLatestMeta: {
    fontSize: 12,
    color: '#26A7DE',
    fontWeight: '600',
    opacity: 0.8,
  },
  apLatestImage: {
    width: 90,
    height: 70,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  // Newspaper Preview Cards
  previewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 20,
    marginVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: 200,
    backgroundColor: '#f0f0f0',
  },
  previewContent: {
    padding: 16,
  },
  previewDate: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    fontWeight: '500',
  },
  previewHeadline: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 8,
    lineHeight: 24,
  },
  previewSummary: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    marginBottom: 12,
  },
  previewMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewSource: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  previewReadMore: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
  },
  // Search styles
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
  },
});

export default function Newspaper() {
  const router = useRouter();
  const { user } = useAuth();
  const { groupChats, socket } = useGroupChatContext();
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedSummary, setSelectedSummary] = useState<NewspaperSummary | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaries, setSummaries] = useState<NewspaperSummary[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [lastSummaryGeneration, setLastSummaryGeneration] = useState<Date | null>(null);
  // View state
  const [showFullNewspaper, setShowFullNewspaper] = useState(false);
  const [selectedNewspaper, setSelectedNewspaper] = useState<NewspaperSummary | null>(null);
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const scrollRef = useRef<ScrollView>(null);
  
  // Live message tracking state
  const [messageCountTracker, setMessageCountTracker] = useState<{ [groupId: string]: { count: number; lastReset: number } }>({});
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);

  // Initialize message tracking for user's groups
  useEffect(() => {
    const initializeMessageTracking = async () => {
      if (!user?.userId || !groupChats.length) return;
      
      try {
        // Load existing tracking data from storage
        const stored = await AsyncStorage.getItem(`newspaper_message_tracking_${user.userId}`);
        if (stored) {
          const parsedData = JSON.parse(stored);
          setMessageCountTracker(parsedData);
        } else {
          // Initialize tracking for all user groups
          const initialTracker: { [groupId: string]: { count: number; lastReset: number } } = {};
          groupChats.forEach(group => {
            initialTracker[group._id] = { count: 0, lastReset: Date.now() };
          });
          setMessageCountTracker(initialTracker);
          await AsyncStorage.setItem(`newspaper_message_tracking_${user.userId}`, JSON.stringify(initialTracker));
        }
      } catch (error) {
        console.error('[Newspaper] Error initializing message tracking:', error);
      }
    };

    initializeMessageTracking();
  }, [user?.userId, groupChats]);

  // Live message tracking - Listen for new messages and auto-generate summaries
  useEffect(() => {
    if (!socket || !user?.userId) return;

    const handleNewMessage = async (message: any) => {
      // Only track messages from other users (not own messages)
      if (message.senderId === user.userId) return;
      
      // Only track voice and text messages
      if (!['voice', 'text'].includes(message.type)) return;
      
      const groupId = message.groupChatId;
      
      // Update message count for this group
      setMessageCountTracker(prev => {
        const currentData = prev[groupId] || { count: 0, lastReset: Date.now() };
        const newCount = currentData.count + 1;
        
        const updatedTracker = {
          ...prev,
          [groupId]: {
            ...currentData,
            count: newCount
          }
        };
        
        // Save to storage
        AsyncStorage.setItem(`newspaper_message_tracking_${user.userId}`, JSON.stringify(updatedTracker))
          .catch(error => console.error('[Newspaper] Error saving message tracking:', error));
        
        // Check if we've hit the 10-message threshold
        if (newCount >= 10 && !isAutoGenerating) {
          triggerAutoSummaryGeneration(groupId, updatedTracker);
        }
        
        return updatedTracker;
      });
    };

    socket.on('new_message', handleNewMessage);

    return () => {
      socket.off('new_message', handleNewMessage);
    };
  }, [socket, user?.userId, isAutoGenerating]);

  // Automatically fetch user-specific summaries on mount
  useEffect(() => {
    if (user?.userId) {
      handleFetchUserNewspapers();
    }
  }, [user?.userId]);

  // Set up periodic summary generation
  useEffect(() => {
    if (!user?.userId) return;

    const generatePeriodicSummaries = async () => {
      const now = new Date();
      const lastGen = lastSummaryGeneration;
      
      // Generate summaries if:
      // 1. Never generated before (lastGen is null)
      // 2. Last generation was more than 6 hours ago
      if (!lastGen || (now.getTime() - lastGen.getTime()) > 6 * 60 * 60 * 1000) {
        try {
          // Get user's group chats
          
          const response = await fetch(`${API_URL}/groupchats?userId=${user.userId}`, {
            headers: {
              'Content-Type': 'application/json',
            },
          });

          
          if (!response.ok) {
            console.error('Failed to fetch group chats for periodic summary - response not ok - UPDATED VERSION');
            return;
          }

          // Try to parse the response
          let userGroups;
          try {
            const responseText = await response.text();
            userGroups = JSON.parse(responseText);
          } catch (parseError) {
            console.error('Failed to parse group chats response:', parseError);
            return;
          }
          
          // Check if any group has enough activity
          let hasActiveGroups = false;
          for (const group of userGroups) {
            const oneDayAgo = new Date();
            oneDayAgo.setDate(oneDayAgo.getDate() - 1);
            
            const messagesResponse = await fetch(
              `${API_URL}/messages/${group._id}?userId=${user.userId}&since=${oneDayAgo.toISOString()}`,
              {
                headers: {
                  'Content-Type': 'application/json',
                },
              }
            );

            if (!messagesResponse.ok) continue;

            const recentMessages = await messagesResponse.json();
            
            // Extract transcripts from voice messages using the same robust logic as the backend
            let transcripts: string[] = [];
            let transcriptCount = 0;
            
            for (const msg of recentMessages) {
              if (
                msg.type === 'voice' &&
                msg.transcription &&
                msg.transcription.results &&
                Array.isArray(msg.transcription.results.transcripts)
              ) {
                for (const transcriptObj of msg.transcription.results.transcripts) {
                  let transcriptText = '';
                  if (typeof transcriptObj.transcript === 'string') {
                    transcriptText = transcriptObj.transcript;
                  } else if (Array.isArray(transcriptObj.items)) {
                    transcriptText = transcriptObj.items.map((item: any) => item.alternatives?.[0]?.content || "").join(" ");
                  }
                  if (transcriptText && transcriptText.trim().length > 0) {
                    const sender = msg.senderName || "Unknown";
                    transcripts.push(`${sender}: ${transcriptText.trim()}`);
                    transcriptCount++;
                  }
                }
              }
            }
            
            transcripts = transcripts.filter(Boolean);
            
                      // Only generate summary if there are 10 or more transcripts
          if (transcriptCount < 10) {
              continue;
            }

            // Call the backend newspaper endpoint to generate AND save the summary
            const summaryResponse = await fetch(`${API_URL}/newspaper/user/${user.userId}`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });

            if (!summaryResponse.ok) {
            }
          }
        } catch (error) {
          console.error('Error in periodic summary generation:', error);
        }
      }
    };

    // Run immediately on mount
    generatePeriodicSummaries();

    // Set up interval to check every hour
    const interval = setInterval(generatePeriodicSummaries, 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user?.userId, lastSummaryGeneration]);

  // Add auto-refresh interval to poll for new summaries every 30 minutes
  useEffect(() => {
    if (!user?.userId) return;
    const interval = setInterval(() => {
      handleFetchUserNewspapers();
    }, 1800000); // 30 minutes
    return () => clearInterval(interval);
  }, [user?.userId]);

  // Auto-generate summary for a specific group when threshold is reached
  const triggerAutoSummaryGeneration = async (groupId: string, currentTracker: { [groupId: string]: { count: number; lastReset: number } }) => {
    if (isAutoGenerating) {
      return;
    }

    setIsAutoGenerating(true);
    
    try {
      // Find the group
      const targetGroup = groupChats.find(g => g._id === groupId);
      if (!targetGroup) {
        return;
      }

      // Get recent messages for this group (last 10-15 messages or since last reset)
      const lastReset = currentTracker[groupId]?.lastReset || Date.now() - (24 * 60 * 60 * 1000);
      const sinceDate = new Date(lastReset);
      
      const messagesResponse = await fetch(
        `${API_URL}/messages/${groupId}?userId=${user?.userId}&since=${sinceDate.toISOString()}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!messagesResponse.ok) {
        console.error('[Newspaper] Failed to fetch recent messages for auto-generation');
        return;
      }

      const recentMessages = await messagesResponse.json();
      
      // Extract transcripts from voice messages using the same robust logic as the backend
      let transcripts: string[] = [];
      let transcriptCount = 0;
      
      for (const msg of recentMessages) {
        if (
          msg.type === 'voice' &&
          msg.transcription &&
          msg.transcription.results &&
          Array.isArray(msg.transcription.results.transcripts)
        ) {
          for (const transcriptObj of msg.transcription.results.transcripts) {
            let transcriptText = '';
            if (typeof transcriptObj.transcript === 'string') {
              transcriptText = transcriptObj.transcript;
            } else if (Array.isArray(transcriptObj.items)) {
              transcriptText = transcriptObj.items.map((item: any) => item.alternatives?.[0]?.content || "").join(" ");
            }
            if (transcriptText && transcriptText.trim().length > 0) {
              const sender = msg.senderName || "Unknown";
              transcripts.push(`${sender}: ${transcriptText.trim()}`);
              transcriptCount++;
            }
          }
        }
      }
      
      transcripts = transcripts.filter(Boolean);

      if (transcriptCount < 10) {
        return;
      }

      // Generate the summary
      const result = await generateSummary({
        transcripts,
        groupName: targetGroup.name
      });

      if (result) {
        // Reset the message count for this group
        const resetTracker = {
          ...currentTracker,
          [groupId]: {
            count: 0,
            lastReset: Date.now()
          }
        };
        
        setMessageCountTracker(resetTracker);
        await AsyncStorage.setItem(`newspaper_message_tracking_${user?.userId}`, JSON.stringify(resetTracker));
        
        // Refresh the newspaper to show the new summary
        await handleFetchUserNewspapers();
        
      }
      
    } catch (error) {
      console.error('[Newspaper] Error in auto-summary generation:', error);
    } finally {
      setIsAutoGenerating(false);
    }
  };

  const handleFetchUserNewspapers = async () => {
    if (!user?.userId) return;
    
    setApiLoading(true);
    setApiError(null);
    try {
      const userNewspapers = await getUserNewspapers(user.userId);
      console.log('[FetchNewspapers] Received data:', userNewspapers);
      setSummaries(userNewspapers);

      // If no summaries exist, generate them automatically
      if (userNewspapers.length === 0) {
        await handleGenerateSummary();
        // Fetch again after generation
        const updatedNewspapers = await getUserNewspapers(user.userId);
        setSummaries(updatedNewspapers);
      }
    } catch (err: any) {
      setApiError(err.message || 'Failed to fetch your newspaper summaries');

    } finally {
      setApiLoading(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!user?.userId) {
      setApiError('Please log in to generate summaries');
      return;
    }

    setIsGeneratingSummary(true);
    try {
      // Get user's group chats
      const response = await fetch(`${API_URL}/groupchats?userId=${user.userId}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch group chats');
      }

      const userGroups = await response.json();
      
      if (!userGroups.length) {
        setApiError('You are not a member of any group chats');
        return;
      }

      // Generate summaries for each group
      let hasGroupsWithEnoughTranscripts = false;
      
      for (const group of userGroups) {
        try {
          // Get group messages from the last 24 hours
          const oneDayAgo = new Date();
          oneDayAgo.setDate(oneDayAgo.getDate() - 1);
          
          const messagesResponse = await fetch(
            `${API_URL}/messages/${group._id}?userId=${user.userId}&since=${oneDayAgo.toISOString()}`,
            {
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );

          if (!messagesResponse.ok) {
            console.error(`Failed to fetch messages for group ${group.name}`);
            continue;
          }

          const messages = await messagesResponse.json();
          
          // Extract transcripts from voice messages using the same robust logic as the backend
          let transcripts: string[] = [];
          let transcriptCount = 0;
          
          for (const msg of messages) {
            if (
              msg.type === 'voice' &&
              msg.transcription &&
              msg.transcription.results &&
              Array.isArray(msg.transcription.results.transcripts)
            ) {
              for (const transcriptObj of msg.transcription.results.transcripts) {
                let transcriptText = '';
                if (typeof transcriptObj.transcript === 'string') {
                  transcriptText = transcriptObj.transcript;
                } else if (Array.isArray(transcriptObj.items)) {
                  transcriptText = transcriptObj.items.map((item: any) => item.alternatives?.[0]?.content || "").join(" ");
                }
                if (transcriptText && transcriptText.trim().length > 0) {
                  const sender = msg.senderName || "Unknown";
                  transcripts.push(`${sender}: ${transcriptText.trim()}`);
                  transcriptCount++;
                }
              }
            }
          }
          
          transcripts = transcripts.filter(Boolean);
          
          // Only generate summary if there are 10 or more transcripts
          if (transcriptCount < 10) {
            continue;
          }
          hasGroupsWithEnoughTranscripts = true;
        } catch (error) {
          console.error(`Error checking group ${group.name}:`, error);
        }
      }

      // If any groups have enough transcripts, call the backend to generate and save summaries
      if (hasGroupsWithEnoughTranscripts) {
        
        const summaryResponse = await fetch(`${API_URL}/newspaper/user/${user.userId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (summaryResponse.ok) {
        } else {
        }
      } else {
      }

      // Refresh the newspapers after generating new ones
      await handleFetchUserNewspapers();
    } catch (error) {
      console.error('Error generating summaries:', error);
      setApiError('Failed to generate summaries');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const openDetailModal = (summary: NewspaperSummary) => {
    console.log('[DetailModal] Opening with summary:', summary);
    setSelectedSummary(summary);
    setDetailModalVisible(true);
  };

  const closeDetailModal = () => {
    setDetailModalVisible(false);
    setSelectedSummary(null);
  };

  const openFullNewspaper = (summary: NewspaperSummary) => {
    setSelectedNewspaper(summary);
    setShowFullNewspaper(true);
  };

  const closeFullNewspaper = () => {
    setShowFullNewspaper(false);
    setSelectedNewspaper(null);
  };

  // Search functionality - only search group names and group members
  const filteredSummaries = summaries.filter(summary => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase();
    const groupName = (summary.groupName || summary.group || '').toLowerCase();
    
    // Find the corresponding group chat to get member names
    const correspondingGroup = groupChats.find(group => 
      group.name.toLowerCase() === groupName || group._id === summary.group
    );
    
    // Search in group name
    if (groupName.includes(query)) {
      return true;
    }
    
    // Search in group member names
    if (correspondingGroup) {
      const memberMatch = correspondingGroup.members.some(member => 
        member.name.toLowerCase().includes(query)
      );
      if (memberMatch) {
        return true;
      }
    }
    
    return false;
  });

  const theme = useTheme();
  const { width: SCREEN_WIDTH } = Dimensions.get('window');
  const isTablet = SCREEN_WIDTH >= 768;
  const numColumns = isTablet ? 3 : 2;
  const rowsPerPage = 3;
  const summariesPerPage = numColumns * rowsPerPage;
  // Subtle paper texture SVG as base64 (seamless, very light)
  const PAPER_TEXTURE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IiNmZmZmZmYiLz48Y2lyY2xlIGN4PSI2NCIgY3k9IjY0IiByPSIxIiBmaWxsPSIjZWVlZWVlIi8+PGNpcmNsZSBjeD0iMzIiIGN5PSI5NiIgcj0iMSIgZmlsbD0iI2VlZWVlZSIvPjxjaXJjbGUgY3g9Ijk2IiBjeT0iMzIiIHI9IjEiIGZpbGw9IiNlZWVlZWUiLz48L3N2Zz4=';

  // Horizontal pagination logic
  const pages: NewspaperSummary[][] = [];
  for (let i = 0; i < summaries.length; i += summariesPerPage) {
    pages.push(summaries.slice(i, i + summariesPerPage));
  }
  const handleHorizontalScroll = (event: any) => {
    const page = Math.round(event.nativeEvent.contentOffset.x / event.nativeEvent.layoutMeasurement.width) + 1;
    setCurrentPage(page);
  };

  return (
    <SNSafeAreaView style={{flex: 1}} edges={Platform.OS === 'android' ? ['top'] : undefined}>
      <StatusBar barStyle={theme.background === '#0A0E1A' ? "light-content" : "dark-content"} />
      <GradientWavesBackground />
      <BlurView intensity={90} tint={theme.background === '#0A0E1A' ? "dark" : "light"} style={[styles.fullGlassBlur, { backgroundColor: theme.background }]}>
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={{ flex: 1 }}>
            <SNSafeAreaView style={{flex: 1}} edges={['top']}>
              {showFullNewspaper && selectedNewspaper ? (
                /* Full Newspaper View */
                <View style={{ flex: 1 }}>
                  <View style={styles.header}>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={closeFullNewspaper}
                      activeOpacity={0.7}
                      accessibilityLabel="Back to newspaper list"
                    >
                      <Ionicons name="arrow-back" size={24} color={theme.text} />
                    </TouchableOpacity>
                    
                    <Text style={[styles.headerTitle, { color: theme.text }]}>Full Newspaper</Text>
                    
                    <View style={styles.placeholderRight} />
                  </View>
                  
                  {/* Single Newspaper Full View */}
                  <ScrollView
                    style={{ flex: 1, backgroundColor: 'transparent' }}
                    contentContainerStyle={{ paddingBottom: 100, paddingTop: 20 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {/* Main Featured Article */}
                    <Pressable style={[styles.apFeaturedArticle, { 
                      backgroundColor: theme.card,
                      shadowColor: theme.background === '#0A0E1A' ? '#000' : '#000',
                      shadowOpacity: theme.background === '#0A0E1A' ? 0.3 : 0.1
                    }]} onPress={() => openDetailModal(selectedNewspaper)}>
                      <Image 
                        source={{ 
                          uri: selectedNewspaper.media?.[0]?.uri || 
                               selectedNewspaper.groupIcon || 
                               `https://picsum.photos/400/250?seed=${selectedNewspaper.group}-${selectedNewspaper.id}`
                        }} 
                        style={styles.apFeaturedImage} 
                        resizeMode="cover" 
                      />
                      <View style={styles.apFeaturedContent}>
                        <Text style={[styles.apFeaturedHeadline, { color: theme.text }]}>{selectedNewspaper.headline}</Text>
                        <Text style={[styles.apFeaturedSummary, { color: theme.secondaryText }]}>
                          {selectedNewspaper.summary}
                        </Text>
                        <View style={styles.apMetadata}>
                          <Text style={[styles.apByline, { color: theme.accent }]}>From {selectedNewspaper.groupName || selectedNewspaper.group}</Text>
                          <Text style={[styles.apTimestamp, { color: theme.secondaryText }]}>{new Date(selectedNewspaper.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
                        </View>
                        <Text style={[styles.readMoreText, { color: theme.accent }]}>Tap to read detailed article</Text>
                      </View>
                    </Pressable>
                  </ScrollView>
                </View>
              ) : (
                /* Newspaper Preview List */
                <View 
                  style={[
                    styles.newspaperSection,
                    {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: 1,
                    }
                  ]}
                >
                <View style={styles.header}>
                  <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                    activeOpacity={0.7}
                    accessibilityLabel="Go back"
                  >
                    <Ionicons name="arrow-back" size={24} color={theme.text} />
                  </TouchableOpacity>
                  
                  <Text style={[styles.headerTitle, { color: theme.text }]}>Your Newspapers</Text>
                  
                  <TouchableOpacity
                    style={styles.settingsButton}
                    onPress={() => setIsSearchVisible(!isSearchVisible)}
                    activeOpacity={0.7}
                    accessibilityLabel="Toggle search"
                  >
                    <Ionicons name={isSearchVisible ? "close" : "search"} size={24} color={theme.text} />
                  </TouchableOpacity>
                </View>
                
                {/* Search Input */}
                {isSearchVisible && (
                  <View style={[styles.searchContainer, { 
                    backgroundColor: theme.card, 
                    borderColor: theme.border,
                    shadowColor: theme.background === '#0A0E1A' ? '#000' : '#000',
                    shadowOpacity: theme.background === '#0A0E1A' ? 0.3 : 0.1
                  }]}>
                    <Ionicons name="search" size={20} color={theme.secondaryText} style={styles.searchIcon} />
                    <TextInput
                      style={[styles.searchInput, { color: theme.text }]}
                      placeholder="Search by group name or member names..."
                      placeholderTextColor={theme.secondaryText}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {searchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
                        <Ionicons name="close-circle" size={20} color={theme.secondaryText} />
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                
                {!user?.userId ? (
                  <View style={styles.loadingContainer}>
                    <Text style={[styles.noContentText, { color: theme.text }]}>Please log in to view your newspaper</Text>
                  </View>
                ) : apiLoading || isGeneratingSummary || isAutoGenerating ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.accent} />
                    <Text style={[styles.loadingText, { color: theme.text }]}>
                      {isAutoGenerating ? 'Auto-generating live summary...' : 
                       isGeneratingSummary ? 'Generating new summaries...' : 'Loading your newspaper...'}
                    </Text>
                  </View>
                ) : filteredSummaries.length === 0 && summaries.length > 0 ? (
                  <View style={styles.loadingContainer}>
                    <Text style={[styles.noContentText, { color: theme.text }]}>No newspapers found matching your search.</Text>
                  </View>
                ) : summaries.length === 0 ? (
                  <View style={styles.loadingContainer}>
                    <Text style={[styles.noContentText, { color: theme.text }]}>No newspaper summaries available for your groups.</Text>
                  </View>
                ) : (
                  /* Newspaper Preview Cards */
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: 100 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {searchQuery.trim() ? (
                      /* Search Results - Only Big Preview Cards */
                      filteredSummaries.map((summary, index) => (
                        <Pressable 
                          key={summary.id} 
                          style={[styles.apFeaturedArticle, { 
                            backgroundColor: theme.card,
                            shadowColor: theme.background === '#0A0E1A' ? '#000' : '#000',
                            shadowOpacity: theme.background === '#0A0E1A' ? 0.3 : 0.1
                          }]} 
                          onPress={() => openFullNewspaper(summary)}
                        >
                          <Image 
                            source={{ 
                              uri: summary.media?.[0]?.uri || 
                                   summary.groupIcon || 
                                   `https://picsum.photos/400/250?seed=${summary.group}-${summary.id}`
                            }} 
                            style={styles.apFeaturedImage} 
                            resizeMode="cover" 
                          />
                          <View style={styles.apFeaturedContent}>
                            <Text style={[styles.apFeaturedHeadline, { color: theme.text }]}>{summary.headline}</Text>
                            <Text style={[styles.apFeaturedSummary, { color: theme.secondaryText }]} numberOfLines={3}>
                              {summary.summary.length > 120 
                                ? `${summary.summary.substring(0, 120)}...` 
                                : summary.summary}
                            </Text>
                            <View style={styles.apMetadata}>
                              <Text style={[styles.apByline, { color: theme.accent }]}>From {summary.groupName || summary.group}</Text>
                              <Text style={[styles.apTimestamp, { color: theme.secondaryText }]}>
                                {new Date(summary.timestamp).toLocaleDateString('en-US', { 
                                  month: 'short', 
                                  day: 'numeric', 
                                  hour: 'numeric', 
                                  minute: '2-digit' 
                                })}
                              </Text>
                            </View>
                            <Text style={[styles.readMoreText, { color: theme.accent }]}>Tap to read full newspaper</Text>
                          </View>
                        </Pressable>
                      ))
                    ) : (
                      /* Normal View - All Sections */
                      <>
                        {/* Main Featured Article - Most Recent */}
                        {filteredSummaries.length > 0 && (
                          <Pressable style={[styles.apFeaturedArticle, { 
                            backgroundColor: theme.card,
                            shadowColor: theme.background === '#0A0E1A' ? '#000' : '#000',
                            shadowOpacity: theme.background === '#0A0E1A' ? 0.3 : 0.1
                          }]} onPress={() => openFullNewspaper(filteredSummaries[0])}>
                            <Image 
                              source={{ 
                                uri: filteredSummaries[0].media?.[0]?.uri || 
                                     filteredSummaries[0].groupIcon || 
                                     `https://picsum.photos/400/250?seed=${filteredSummaries[0].group}-${filteredSummaries[0].id}`
                              }} 
                              style={styles.apFeaturedImage} 
                              resizeMode="cover" 
                            />
                            <View style={styles.apFeaturedContent}>
                              <Text style={[styles.apFeaturedHeadline, { color: theme.text }]}>{filteredSummaries[0].headline}</Text>
                              <Text style={[styles.apFeaturedSummary, { color: theme.secondaryText }]} numberOfLines={3}>
                                {filteredSummaries[0].summary.length > 120 
                                  ? `${filteredSummaries[0].summary.substring(0, 120)}...` 
                                  : filteredSummaries[0].summary}
                              </Text>
                              <View style={styles.apMetadata}>
                                <Text style={[styles.apByline, { color: theme.accent }]}>From {filteredSummaries[0].groupName || filteredSummaries[0].group}</Text>
                                <Text style={[styles.apTimestamp, { color: theme.secondaryText }]}>{new Date(filteredSummaries[0].timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
                              </View>
                              <Text style={[styles.readMoreText, { color: theme.accent }]}>Tap to read full newspaper</Text>
                            </View>
                          </Pressable>
                        )}

                        {/* Top Latest Newspapers Section - Top 3 */}
                        {filteredSummaries.length > 1 && (
                          <View style={[styles.apTopLatestSection, { 
                            backgroundColor: theme.card,
                            shadowColor: theme.background === '#0A0E1A' ? '#000' : '#000',
                            shadowOpacity: theme.background === '#0A0E1A' ? 0.3 : 0.1
                          }]}>
                            <Text style={[styles.apTopLatestTitle, { color: theme.background === '#0A0E1A' ? '#FFFFFF' : theme.accent }]}>Latest Newspapers</Text>
                            {filteredSummaries.slice(0, 3).map((summary, idx) => (
                              <Pressable key={`latest-${summary.id}`} style={[styles.apLatestArticle, { 
                                backgroundColor: theme.background === '#0A0E1A' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
                              }]} onPress={() => openFullNewspaper(summary)}>
                                <View style={styles.apLatestContent}>
                                  <Text style={[styles.apLatestHeadline, { color: theme.text }]} numberOfLines={2}>{summary.headline}</Text>
                                  <Text style={[styles.apLatestPreview, { color: theme.secondaryText }]} numberOfLines={2}>
                                    {summary.summary.length > 100 
                                      ? `${summary.summary.substring(0, 100)}...` 
                                      : summary.summary}
                                  </Text>
                                  <Text style={[styles.apLatestMeta, { color: theme.accent }]}>From {summary.groupName || summary.group} • {new Date(summary.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
                                </View>
                                {summary.media?.[0]?.uri && (
                                  <Image 
                                    source={{ 
                                      uri: summary.media[0].uri || `https://picsum.photos/120/90?seed=${summary.group}-${summary.id}`
                                    }} 
                                    style={styles.apLatestImage} 
                                    resizeMode="cover" 
                                  />
                                )}
                              </Pressable>
                            ))}
                          </View>
                        )}

                        {/* More Coverage Section - Limited to 3 articles */}
                        {filteredSummaries.length > 3 && (
                          <View style={[styles.apMoreCoverageSection, { 
                            backgroundColor: theme.card,
                            shadowColor: theme.background === '#0A0E1A' ? '#000' : '#000',
                            shadowOpacity: theme.background === '#0A0E1A' ? 0.3 : 0.1
                          }]}>
                            <Text style={[styles.apMoreCoverageTitle, { color: theme.background === '#0A0E1A' ? '#FFFFFF' : theme.accent }]}>More Coverage</Text>
                            {filteredSummaries.slice(3, 6).map((summary, idx) => (
                              <Pressable key={summary.id} style={[styles.apSecondaryArticle, { 
                                backgroundColor: theme.background === '#0A0E1A' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
                              }]} onPress={() => openFullNewspaper(summary)}>
                                <View style={styles.apSecondaryContent}>
                                  <Text style={[styles.apSecondaryHeadline, { color: theme.text }]} numberOfLines={2}>{summary.headline}</Text>
                                  <Text style={[styles.apSecondaryPreview, { color: theme.secondaryText }]} numberOfLines={1}>
                                    {summary.summary.length > 80 
                                      ? `${summary.summary.substring(0, 80)}...` 
                                      : summary.summary}
                                  </Text>
                                  <Text style={[styles.apSecondaryMeta, { color: theme.accent }]}>From {summary.groupName || summary.group} • {new Date(summary.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                                </View>
                                {summary.media?.[0]?.uri && (
                                  <Image 
                                    source={{ 
                                      uri: summary.media[0].uri || `https://picsum.photos/100/75?seed=${summary.group}-${summary.id}`
                                    }} 
                                    style={styles.apSecondaryImage} 
                                    resizeMode="cover" 
                                  />
                                )}
                              </Pressable>
                            ))}
                          </View>
                        )}

                        {/* Older Newspapers - Smaller Preview Cards */}
                        {filteredSummaries.length > 6 && (
                          <>
                            <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
                              <Text style={[styles.apMoreCoverageTitle, { marginBottom: 8, color: theme.background === '#0A0E1A' ? '#FFFFFF' : theme.accent }]}>Older Newspapers</Text>
                            </View>
                            {filteredSummaries.slice(6).map((summary, idx) => (
                              <Pressable 
                                key={summary.id} 
                                style={[styles.previewCard, { 
                                  backgroundColor: theme.card,
                                  shadowColor: theme.background === '#0A0E1A' ? '#000' : '#000',
                                  shadowOpacity: theme.background === '#0A0E1A' ? 0.3 : 0.1
                                }]}
                                onPress={() => openFullNewspaper(summary)}
                              >
                                <Image 
                                  source={{ 
                                    uri: summary.media?.[0]?.uri || 
                                         summary.groupIcon || 
                                         `https://picsum.photos/400/250?seed=${summary.group}-${summary.id}`
                                  }} 
                                  style={styles.previewImage} 
                                  resizeMode="cover" 
                                />
                                <View style={styles.previewContent}>
                                  <Text style={[styles.previewDate, { color: theme.secondaryText }]}>
                                    {new Date(summary.timestamp).toLocaleDateString('en-US', { 
                                      weekday: 'long',
                                      year: 'numeric',
                                      month: 'long', 
                                      day: 'numeric' 
                                    })}
                                  </Text>
                                  <Text style={[styles.previewHeadline, { color: theme.text }]} numberOfLines={2}>
                                    {summary.headline}
                                  </Text>
                                  <Text style={[styles.previewSummary, { color: theme.secondaryText }]} numberOfLines={3}>
                                    {summary.summary.length > 120 
                                      ? `${summary.summary.substring(0, 120)}...` 
                                      : summary.summary}
                                  </Text>
                                  <View style={styles.previewMeta}>
                                    <Text style={[styles.previewSource, { color: theme.secondaryText }]}>
                                      From {summary.groupName || summary.group}
                                    </Text>
                                    <Text style={[styles.previewReadMore, { color: theme.accent }]}>
                                      Read Full Newspaper →
                                    </Text>
                                  </View>
                                </View>
                              </Pressable>
                            ))}
                          </>
                        )}
                      </>
                    )}
                  </ScrollView>
                )}
              </View>
              )}
            </SNSafeAreaView>
          </View>
        </View>
      </BlurView>

      {/* Detailed Article Modal */}
      <Modal
        visible={detailModalVisible}
        transparent={false}
        animationType="slide"
        onRequestClose={closeDetailModal}
      >
        <View style={[styles.nytModalContent, { backgroundColor: theme.card }]}>
          <ScrollView style={styles.paperTexture} contentContainerStyle={{ paddingTop: 80, paddingBottom: 60 }}>
            {/* Header */}
            <View style={styles.nytPageHeader}>
              <Text style={[styles.nytPageVol, { color: theme.secondaryText }]}>VOL. CLXXI No. {Math.floor(Math.random() * 365) + 1}</Text>
              <Text style={[styles.nytPageDate, { color: theme.secondaryText }]}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}</Text>
              <Text style={[styles.nytPageNum, { color: theme.secondaryText }]}>A1</Text>
            </View>
            
            {/* Masthead */}
            <View style={styles.nytMastheadSection}>
              <Text style={[styles.nytMasthead, { color: theme.text }]}>The FlickD Times</Text>
              <View style={[styles.nytMastheadUnderline, { backgroundColor: theme.text }]} />
              <Text style={[styles.nytSubtitle, { color: theme.secondaryText }]}>"All the News That's Fit to Flick"</Text>
            </View>
            
            {selectedSummary && (
              <>
                {/* Headline */}
                <View style={styles.nytHeadlineSection}>
                  <Text style={[styles.nytHeadline, { color: theme.text }]}>{selectedSummary.headline || 'Group Chat Summary'}</Text>
                  <Text style={[styles.nytByline, { color: theme.secondaryText }]}>By FlickD AI • Special to The FlickD Times</Text>
                </View>
                
                {/* Group Info */}
                <View style={[styles.nytGroupInfoSection, { 
                  backgroundColor: theme.background === '#0A0E1A' ? 'rgba(38, 167, 222, 0.1)' : 'rgba(38, 167, 222, 0.06)',
                  borderColor: theme.background === '#0A0E1A' ? 'rgba(38, 167, 222, 0.2)' : 'rgba(38, 167, 222, 0.1)'
                }]}>
                  <View style={styles.nytGroupAvatar}>
                    <Text style={styles.nytGroupAvatarText}>{(selectedSummary.groupName || selectedSummary.group)?.charAt(0)?.toUpperCase() || 'G'}</Text>
                  </View>
                  <View style={styles.nytGroupDetails}>
                    <Text style={[styles.nytGroupName, { color: theme.text }]}>{selectedSummary.groupName || selectedSummary.group || 'Unknown Group'}</Text>
                    <Text style={[styles.nytMessageCount, { color: theme.secondaryText }]}>Group Chat Summary</Text>
                  </View>
                </View>
                
                {/* Media */}
                {selectedSummary.media && selectedSummary.media.length > 0 && (
                  <View style={styles.nytMediaSection}>
                    <MediaPreview media={selectedSummary.media} />
                  </View>
                )}
                
                {/* Article Content */}
                <View style={styles.nytArticleSection}>
                  {selectedSummary.summary && (
                    <Text style={[styles.nytArticleText, { color: theme.text }]}>
                      <Text style={[styles.nytDropCap, { color: theme.text }]}>{selectedSummary.summary.charAt(0)}</Text>
                      {selectedSummary.summary.slice(1)}
                    </Text>
                  )}
                  
                  <View style={[styles.nytSectionDivider, { backgroundColor: theme.border }]} />
                  
                  <Text style={[styles.nytArticleText, { color: theme.text }]}>
                    This summary was automatically generated from voice messages and conversations in the {selectedSummary.groupName || selectedSummary.group || 'group'} chat. 
                    The FlickD AI system analyzes voice transcripts to create these daily summaries, helping users stay informed about 
                    important discussions and developments within their communities.
                  </Text>
                  
                  <View style={[styles.nytSectionDivider, { backgroundColor: theme.border }]} />
                  
                  <Text style={[styles.nytArticleText, { color: theme.text }]}>
                    Generated on {new Date(selectedSummary.timestamp).toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })} at {new Date(selectedSummary.timestamp).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    })}.
                  </Text>
                </View>
                
                {/* Footer */}
                <View style={styles.nytFooter}>
                  <Text style={[styles.nytFooterText, { color: theme.secondaryText }]}>© 2025 The FlickD Times. All rights reserved.</Text>
                </View>
              </>
            )}
          </ScrollView>
          {/* Close Button */}
          <Pressable onPress={closeDetailModal} style={[styles.nytCloseButton, { 
            backgroundColor: theme.background === '#0A0E1A' ? 'rgba(255,255,255,0.9)' : 'rgba(240,240,240,0.7)'
          }]}>
            <Ionicons name="arrow-back" size={24} color={theme.background === '#0A0E1A' ? '#222' : '#222'} />
          </Pressable>
        </View>
      </Modal>

      {apiError && (
        <View style={[styles.errorContainer, { 
          backgroundColor: theme.background === '#0A0E1A' ? 'rgba(255, 0, 0, 0.15)' : 'rgba(255, 0, 0, 0.1)',
          borderColor: theme.background === '#0A0E1A' ? 'rgba(255, 0, 0, 0.4)' : 'rgba(255, 0, 0, 0.3)'
        }]}>
          <Text style={[styles.errorText, { color: theme.text }]}>{apiError}</Text>
        </View>
      )}
    </SNSafeAreaView>
  );
} 
>>>>>>> Stashed changes
