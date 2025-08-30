import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Ionicons } from '@expo/vector-icons';
import { decode as base64Decode } from 'base-64';
import { Audio, ResizeMode, Video } from 'expo-av';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    FlatList,
    Image,
    Linking,
    Modal,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View
} from 'react-native';
import type { PanGestureHandlerGestureEvent } from 'react-native-gesture-handler';
import { State as GestureState, PanGestureHandler, TapGestureHandler } from 'react-native-gesture-handler';
import ReanimatedAnimated, { Easing, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import EnhancedVoiceComment from '../components/EnhancedVoiceComment';
import { VMAnimationDisplay } from '../components/VMAnimationDisplay';
import { BUCKET_NAME, s3Client } from '../config/aws-config';
import { useRecording } from '../hooks/useRecording';
import { AudioAnalyzer } from '../utils/AudioAnalyzer';
import { globalNavigateToGC, globalOpenPostModal, globalTabBarHidden } from './(tabs)/_layout';
import ModernCameraModal from './components/ModernCameraModal';
import { useAuth } from './context/AuthContext';
import { getAvatarColor, getInitials } from './utils/avatarUtils';

const THEME = {
  primary: '#282828',
  accentBlue: '#26A7DE',
  white: '#FFFFFF',
  black: '#000000',
  gray: '#666666',
  lightGray: '#EEEEEE'
};

const API_URL = Constants.expoConfig?.extra?.API_URL;
const SCREEN_WIDTH = Dimensions.get('window').width;

interface User {
  userId: string;
  email: string;
  name: string;
  accessToken?: string;
}

interface MediaItem {
  type: 'image' | 'video' | 'audio';
  url: string;
  duration?: number;
  thumbnail?: string;
  size: number;
  mimeType: string;
}

interface Post {
  _id: string;
  userId: string;
  userName?: string;
  content: string;
  media: MediaItem[];
  createdAt: string;
  likes: number;
  comments: Comment[];
}

interface Comment {
  _id: string;
  userId: string;
  userName?: string;
  content: string;
  media?: MediaItem[];
  createdAt: string;
  likes?: number;
}

// Helper function to convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = base64Decode(base64);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Add a local lively animation component for the audio section
const LivelyVMAnimation = () => {
  const [bars, setBars] = React.useState<Float32Array>(new Float32Array(64).fill(0.1));
  const phase = React.useRef(Math.random() * 1000);
  const frame = React.useRef<number | null>(null);

  React.useEffect(() => {
    let mounted = true;
    const animate = () => {
      phase.current += 0.08;
      const newBars = Array.from({ length: 64 }, (_, i) =>
        0.5 + 0.5 * Math.sin(phase.current + i * 0.25 + Math.sin(phase.current * 0.5 + i))
      );
      if (mounted) setBars(Float32Array.from(newBars));
      frame.current = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      mounted = false;
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);
  return <VMAnimationDisplay frequencyData={bars} isPlaying={true} />;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
const INITIAL_HEIGHT = SCREEN_HEIGHT * 0.75;
const FULL_HEIGHT = SCREEN_HEIGHT * 0.75;
const MIN_HEIGHT = SCREEN_HEIGHT * 0.2;

// Add this before the PostItem component
const getUserHandle = (post: Post) => post.userName ? `@${post.userName.replace(/\s+/g, '').toLowerCase()}` : '';

// Update the User type to match the auth context
interface User {
  userId: string;
  email: string;
  name: string;
  accessToken?: string;
}

// Add this interface for the profile modal
interface ProfileModalProps {
  visible: boolean;
  onClose: () => void;
  userName: string;
  userHandle: string;
  joinDate: string;
}

// Add the ProfileModal component
const ProfileModal = ({ visible, onClose, userName, userHandle, joinDate }: ProfileModalProps) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    onRequestClose={onClose}
  >
    <TouchableWithoutFeedback onPress={onClose}>
      <View style={styles.profileModalOverlay}>
        <TouchableWithoutFeedback>
          <View style={styles.profileModalContent}>
            <View style={styles.profileHeader}>
              <View style={[
                styles.profileAvatar,
                { backgroundColor: getAvatarColor(userName) }
              ]}>
                <Text style={styles.profileAvatarText}>{getInitials(userName)}</Text>
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.profileName}>{userName}</Text>
                <Text style={styles.profileHandle}>{userHandle}</Text>
                <Text style={styles.profileJoinDate}>Joined {new Date(joinDate).toLocaleDateString()}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.profileCloseButton}
              onPress={onClose}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </TouchableWithoutFeedback>
      </View>
    </TouchableWithoutFeedback>
  </Modal>
);

// Memoized comment item component for better performance
const CommentItem = React.memo(({ 
  comment, 
  playingCommentAudioId, 
  commentAudioIsPlaying, 
  onPlayPauseCommentAudio, 
  onOpenImageFullscreen, 
  onOpenVideoFullscreen, 
  activeCommentPostId,
  setShouldReopenComments 
}: {
  comment: Comment;
  playingCommentAudioId: string | null;
  commentAudioIsPlaying: boolean;
  onPlayPauseCommentAudio: (commentId: string, audioUrl: string) => Promise<void>;
  onOpenImageFullscreen: (imageUri: string) => void;
  onOpenVideoFullscreen: (videoUri: string) => Promise<void>;
  activeCommentPostId: string | null;
  setShouldReopenComments: (postId: string | null) => void;
}) => (
  <View style={styles.commentItem}>
    <View style={styles.commentHeader}>
      <View style={[
        styles.commentAvatar,
        { backgroundColor: getAvatarColor(comment.userId || comment.userName || '') }
      ]}>
        <Text style={styles.commentAvatarText}>
          {getInitials(comment.userName || 'Unknown')}
        </Text>
      </View>
      <View style={styles.commentContent}>
        <Text style={styles.commentTextLine}>
          <Text style={styles.commentUser}>{comment.userName || 'Unknown User'} </Text>
          {comment.content && (
            <Text style={styles.commentText}>{comment.content}</Text>
          )}
        </Text>
        {comment.media && comment.media.map((media, index) => (
          <View key={index} style={styles.commentMediaContainer}>
            {media.type === 'image' && (
              <Pressable 
                onPress={() => {
                  //console.log('[Fullscreen] Opening image from comments:', media.url);
                  setShouldReopenComments(activeCommentPostId);
                  onOpenImageFullscreen(media.url);
                }}
                style={({ pressed }) => [
                  styles.commentMediaPressable,
                  pressed && styles.commentMediaPressed
                ]}
                hitSlop={10}
                pressRetentionOffset={10}
              >
                <Image
                  source={{ uri: media.url }}
                  style={styles.commentMediaImage}
                  resizeMode="cover"
                />
              </Pressable>
            )}
            {media.type === 'video' && (
              <Pressable 
                onPress={() => {
                  //console.log('[Fullscreen] Opening video:', media.url);
                  onOpenVideoFullscreen(media.url);
                }}
                style={({ pressed }) => [
                  styles.commentMediaPressable,
                  pressed && styles.commentMediaPressed
                ]}
                hitSlop={10}
                pressRetentionOffset={10}
              >
                <Video
                  source={{ uri: media.url }}
                  style={styles.commentMediaImage}
                  resizeMode={ResizeMode.COVER}
                  useNativeControls={false}
                  shouldPlay={false}
                  isLooping={false}
                  isMuted={true}
                />
                <View style={styles.videoPlayOverlay}>
                  <Ionicons name="play" size={32} color="#fff" />
                </View>
              </Pressable>
            )}
            {media.type === 'audio' && (
              <EnhancedVoiceComment
                isPlaying={playingCommentAudioId === comment._id && commentAudioIsPlaying}
                duration={media.duration || 0}
                onPlayPause={() => onPlayPauseCommentAudio(comment._id, media.url)}
                showWaveform={true}
              />
            )}
          </View>
        ))}
      </View>
    </View>
  </View>
));

const PostItem = React.memo(({ post, onOpenComments, onDeletePost, onPlayPauseAudio, playingAudioId, audioIsPlaying, user, onImageLoad, isHeaderVisible, onToggleHeader, headerAnimation }: {
  post: Post;
  onOpenComments: (id: string) => void;
  onDeletePost: (id: string) => void;
  onPlayPauseAudio: (id: string, url: string) => void;
  playingAudioId: string | null;
  audioIsPlaying: boolean;
  user: User | null;
  onImageLoad: (url: string, width: number, height: number) => void;
  isHeaderVisible: boolean;
  onToggleHeader: () => void;
  headerAnimation: ReanimatedAnimated.SharedValue<number>;
}) => {
  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onOpenComments(post._id);
  };

  const handleTap = () => {

    onToggleHeader();
  };

  const headerStyle = useAnimatedStyle(() => {
    return {
      transform: [{
        translateY: headerAnimation.value * -100
      }],
      opacity: 1 - headerAnimation.value
    };
  });

  const sortedMedia = post.media?.slice().sort((a, b) => {
    if (a.type === 'image') return -1;
    if (b.type === 'image') return 1;
    return 0;
  }) || [];
  const isThisPostPlaying = playingAudioId === post._id && audioIsPlaying;
  const isPostOwner = user?.userId === post.userId;

  return (
    <Pressable
      onLongPress={handleLongPress}
      onPress={handleTap}
      delayLongPress={500}
      style={styles.glassPost}
    >
      {/* Media content fills entire screen */}
      {sortedMedia.length > 0 && sortedMedia.map((media, index) => (
        <View key={index} style={media.type === 'audio' ? styles.audioPlayerContainer : styles.fullScreenMediaContainer}>
          {media.type === 'audio' ? (
            <View style={styles.audioPlayerOverlay}>
              <TouchableOpacity
                style={styles.audioPlayBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  onPlayPauseAudio(post._id, media.url);
                }}
              >
                <Ionicons
                  name={isThisPostPlaying ? 'pause' : 'play'}
                  size={23}
                  color="#26A7DE"
                />
              </TouchableOpacity>
              <Text style={styles.feedAudioDuration}>{Math.round(media.duration || 0)}s</Text>
              {isThisPostPlaying && (
                <View style={styles.audioVisualizationContainer}>
                  <LivelyVMAnimation />
                </View>
              )}
            </View>
          ) : (
            <TapGestureHandler
              numberOfTaps={2}
              onActivated={() => onOpenComments(post._id)}
            >
              <View style={styles.fullScreenMediaContainer}>
                {media.type === 'image' && (
                  <Image
                    source={{ uri: media.url }}
                    style={styles.mediaWrapper}
                    resizeMode="cover"
                    onLoad={e => {
                      const { width, height } = e.nativeEvent.source;
                      onImageLoad(media.url, width, height);
                    }}
                  />
                )}
                {media.type === 'video' && (
                  <Video
                    source={{ uri: media.url }}
                    style={styles.mediaWrapper}
                    resizeMode={ResizeMode.COVER}
                    useNativeControls
                    shouldPlay={false}
                    isLooping={false}
                    isMuted={true}
                  />
                )}
              </View>
            </TapGestureHandler>
          )}
        </View>
      ))}

      {/* Header overlays on top of media */}
      <ReanimatedAnimated.View style={[styles.postHeaderRow, headerStyle]}>
        {/* Back Button integrated into header */}
        <TouchableOpacity
          style={styles.headerBackButton}
          onPress={(e) => {
            e.stopPropagation();
            console.log('[Navigation] Back button pressed, navigating to GC tab');
            globalNavigateToGC.value = Date.now();
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        
        <View style={[
          styles.avatar,
          { backgroundColor: getAvatarColor(post.userId || post.userName || '') }
        ]}>
          <Text style={styles.avatarText}>{getInitials(post.userName || 'Unknown')}</Text>
        </View>
        <View style={styles.postContentWrap}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.postUserName}>{post.userName || 'Unknown User'}</Text>
            <Text style={styles.postUserHandle}>{getUserHandle(post)}</Text>
          </View>
          <Text style={styles.postDate}>{new Date(post.createdAt).toLocaleDateString()}</Text>
          {/* Trash icon temporarily hidden
          {isPostOwner && (
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={(e) => {
                e.stopPropagation();
                onDeletePost(post._id);
              }}
            >
              <Ionicons name="trash-outline" size={20} color="rgba(255,0,0,0.7)" />
            </TouchableOpacity>
          )}
          */}
        </View>
      </ReanimatedAnimated.View>
    </Pressable>
  );
});

PostItem.displayName = "PostItem";

export default function FeedScreen() {
  const router = useRouter();
  const { user, accessToken, refreshAccessToken } = useAuth();
  const { isRecording, duration: recordingDuration, startRecording: startCentralizedRecording, stopRecording: stopCentralizedRecording } = useRecording();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newPost, setNewPost] = useState('');
  const [selectedImage, setSelectedImage] = useState<MediaItem | null>(null);
  const [selectedAV, setSelectedAV] = useState<MediaItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showMediaOptions, setShowMediaOptions] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [frequencyData, setFrequencyData] = useState<Float32Array>(new Float32Array(64).fill(0.1));
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioSound, setAudioSound] = useState<Audio.Sound | null>(null);
  const [audioIsPlaying, setAudioIsPlaying] = useState(false);
  const audioAnalyzer = React.useRef<AudioAnalyzer | null>(null);
  const animationFrame = React.useRef<number | null>(null);
  const animationPhase = React.useRef(Math.random() * 1000);
  const [imageAspectRatios, setImageAspectRatios] = useState<{ [url: string]: number }>({});
  const containerWidth = Dimensions.get('window').width;
  const [activeCommentPostId, setActiveCommentPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentMedia, setCommentMedia] = useState<MediaItem | null>(null);
  const [sendingComment, setSendingComment] = useState(false);
  const [commentPage, setCommentPage] = useState(1);
  const [commentHasMore, setCommentHasMore] = useState(true);
  const [commentRecording, setCommentRecording] = useState(false);
  const [commentRecordingObj, setCommentRecordingObj] = useState<Audio.Recording | null>(null);
  const [commentRecordingTimer, setCommentRecordingTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const [playingCommentAudioId, setPlayingCommentAudioId] = useState<string | null>(null);
  const [commentAudioSound, setCommentAudioSound] = useState<Audio.Sound | null>(null);
  const [commentAudioIsPlaying, setCommentAudioIsPlaying] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isMovingUp, setIsMovingUp] = useState(false);
  const scrollY = useRef(0);
  const [previewAudioSound, setPreviewAudioSound] = useState<Audio.Sound | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isModalClosing, setIsModalClosing] = useState(false);

  // Global header visibility state
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const globalHeaderAnimation = useSharedValue(0);

  const isAndroid = Platform.OS === 'android';

  // Listen for global post modal trigger
  useEffect(() => {
    const checkPostModalTrigger = () => {
      const currentValue = globalOpenPostModal.value;
      if (currentValue === true) {
        setShowComposer(true);
        globalOpenPostModal.value = false;
      }
    };

    const interval = setInterval(checkPostModalTrigger, 100);
    
    return () => {
      clearInterval(interval);
    };
  }, []);

  // Debug showMediaOptions state changes
  useEffect(() => {
  }, [showMediaOptions]);

  // Global header toggle handler
  const handleToggleHeader = () => {

    const newVisibility = !isHeaderVisible;
    setIsHeaderVisible(newVisibility);
    
    // Animate header to the new state
    globalHeaderAnimation.value = withSpring(newVisibility ? 0 : 1, {
      damping: 15,
      stiffness: 100
    });

    // Control tab bar visibility with the same toggle
    globalTabBarHidden.value = !newVisibility; // Hide tab bar when header is hidden
  };

  // Fullscreen media viewing state
  const [isImageFullscreen, setIsImageFullscreen] = useState(false);
  const [fullscreenImages, setFullscreenImages] = useState<{ uri: string }[]>([]);
  const [fullscreenImageIndex, setFullscreenImageIndex] = useState(0);
  const [fullscreenVideoVisible, setFullscreenVideoVisible] = useState(false);
  const [fullscreenVideoUri, setFullscreenVideoUri] = useState<string>('');
  const [shouldReopenComments, setShouldReopenComments] = useState<string | null>(null);
  const videoRef = useRef<Video>(null);



  // Use traditional Animated API for better stability
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  // Create PanResponder for gesture handling - only for drag handle
  const dragHandlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to downward gestures with some threshold
        return gestureState.dy > 10;
      },
              onPanResponderMove: (_, gestureState) => {
  
          if (gestureState.dy > 0) {
            // Add resistance for smoother feel
            const resistance = 0.7;
            const dragDistance = gestureState.dy * resistance;
            
            translateY.setValue(dragDistance);
            // Smoother opacity transition
            const opacityValue = Math.max(0.3, 1 - (dragDistance / SCREEN_HEIGHT) * 0.8);
            opacity.setValue(opacityValue);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
  
          const shouldClose = gestureState.dy > SCREEN_HEIGHT * 0.2 || gestureState.vy > 800;
          
          if (shouldClose) {
    
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
            ]).start(() => {
              closeComments();
            });
          } else {
            console.log('[DragHandle] Returning to original position');
            
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
            ]).start();
          }
        },
    })
  ).current;

  // Reset modal closing state when modal is opened
  useEffect(() => {
    if (activeCommentPostId) {
      setIsModalClosing(false);
      // Reset animation values
      translateY.setValue(0);
      opacity.setValue(1);
    }
  }, [activeCommentPostId]);



  // Handle reopening comments when fullscreen closes
  useEffect(() => {
    if (!isImageFullscreen && shouldReopenComments) {
      //console.log('[Fullscreen] Reopening comments for post:', shouldReopenComments);
      requestAnimationFrame(() => {
        openComments(shouldReopenComments);
        setShouldReopenComments(null);
      });
    }
  }, [isImageFullscreen, shouldReopenComments]);

  const fetchPosts = async (pageNum = 1) => {
    try {
      if (!accessToken) {
        console.log('No access token available');
        setLoading(false);
        return;
      }

      // Set appropriate loading state
      if (pageNum === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      if (user?.userId && accessToken) {
        const response = await fetch(`${API_URL}/posts?page=${pageNum}&limit=10`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch posts');
        }

        const data = await response.json();
        
        if (pageNum === 1) {
          setPosts(data.posts);
        } else {
          setPosts(prevPosts => [...prevPosts, ...data.posts]);
        }
        
        setHasMore(data.hasMore);
      }
    } catch (error) {
      console.error('Error fetching posts:', error);
      Alert.alert('Error', 'Failed to fetch posts. Please try again.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  };

  // Initialize feed on mount
  useEffect(() => {
    if (user?.userId && accessToken) {
      fetchPosts(1);
    }
  }, [user?.userId, accessToken]);

  // VM animation update effect (runs only while recording)
  useEffect(() => {
    let animationFrame: number | null = null;
    let cancelled = false;

    async function updateFrequency() {
      if (!isRecording) return;
      // Simulate frequency data for now (replace with real audio analysis if available)
      const newData = new Float32Array(64).map(() => Math.random() * 0.5 + 0.5);
      setFrequencyData(newData);
      if (!cancelled) {
        animationFrame = requestAnimationFrame(updateFrequency);
      }
    }

    if (isRecording) {
      
      updateFrequency();
    }
    return () => {
      cancelled = true;
      if (animationFrame) {

        cancelAnimationFrame(animationFrame);
      }
    };
  }, [isRecording]);

  // Log recording state changes
  useEffect(() => {
  }, [isRecording, recordingDuration]);

  // Log when animation is rendered
  useEffect(() => {
    if (isRecording) {
      
    }
  }, [isRecording]);

  // Clean up audio on unmount or when playing a new one
  useEffect(() => {
    return () => {
      if (audioSound) {
        audioSound.unloadAsync();
      }
    };
  }, [audioSound]);

  const onRefresh = () => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true); // Reset hasMore when refreshing
    fetchPosts(1); // Explicitly pass page 1
  };

  const uploadMedia = async (media: MediaItem): Promise<string> => {
    try {
      const timestamp = Date.now();
      const fileExtension = media.type === 'image' ? 'jpg' : 
                           media.type === 'video' ? 'mp4' : 'm4a';
      const key = `posts/${media.type}/${timestamp}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
      
      // For videos, we need to handle the file differently
      if (media.type === 'video') {
        const fileInfo = await FileSystem.getInfoAsync(media.url);
        if (!fileInfo.exists) {
          throw new Error('Video file not found');
        }

        // Read the file as base64
        const fileContent = await FileSystem.readAsStringAsync(media.url, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const fileData = base64ToUint8Array(fileContent);

        const uploadParams = {
          Bucket: BUCKET_NAME,
          Key: key,
          Body: fileData,
          ContentType: 'video/mp4'
        };

        await s3Client.send(new PutObjectCommand(uploadParams));

        // Clean up the temporary file
        await FileSystem.deleteAsync(media.url, { idempotent: true });
      } else {
        // Handle other media types (images and audio)
        const fileContent = await FileSystem.readAsStringAsync(media.url, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const fileData = base64ToUint8Array(fileContent);

        const uploadParams = {
          Bucket: BUCKET_NAME,
          Key: key,
          Body: fileData,
          ContentType: media.mimeType
        };

        await s3Client.send(new PutObjectCommand(uploadParams));
      }

      const finalUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;
      return finalUrl;
    } catch (error) {
      console.error('[FeedScreen] Error uploading media:', error);
      throw error;
    }
  };

  const handleCreatePost = async () => {
    if (!user) {
      console.error('[CreatePost] No user found, cannot create post');
      Alert.alert('Error', 'You must be logged in to create a post');
      return;
    }
    if (!accessToken) {
      console.error('[CreatePost] No access token found, cannot create post');
      Alert.alert('Error', 'You must be logged in to create a post');
      return;
    }

    try {
      setIsSubmitting(true);
      let media: MediaItem[] = [];
      
      // Upload selected image if present
      if (selectedImage) {
        try {
          const uploadedUrl = await uploadMedia(selectedImage);
          
          const imageMediaItem = {
            type: selectedImage.type,
            url: uploadedUrl,
            duration: selectedImage.duration,
            size: selectedImage.size,
            mimeType: selectedImage.mimeType
          };
          media.push(imageMediaItem);
        } catch (error) {
          console.error('[CreatePost] Error uploading image:', error);
          Alert.alert('Error', 'Failed to upload image. Please try again.');
          return;
        }
      }

      // Upload selected audio/video if present
      if (selectedAV) {
        try {
          const uploadedUrl = await uploadMedia(selectedAV);
          
          const avMediaItem = {
            type: selectedAV.type,
            url: uploadedUrl,
            duration: selectedAV.duration,
            size: selectedAV.size,
            mimeType: selectedAV.mimeType
          };
          media.push(avMediaItem);
        } catch (error) {
          console.error('[CreatePost] Error uploading audio/video:', error);
          Alert.alert('Error', 'Failed to upload audio/video. Please try again.');
          return;
        }
      }

      // If no media is selected, show error
      if (media.length === 0) {
        console.error('[CreatePost] No media selected for post');
        Alert.alert('Error', 'Please select media to post');
        return;
      }

      const postData = {
        userId: user.userId,
        media
      };

      const response = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.trim()}`,
        },
        body: JSON.stringify(postData)
      });

      if (!response.ok) {
        if (response.status === 401) {
          await refreshAccessToken();
          return handleCreatePost();
        }
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create post');
      }

      // Reset states after successful post
      setSelectedImage(null);
      setSelectedAV(null);
      setShowComposer(false);
      setShowMediaOptions(false);
      
      // Refresh the feed
      setPage(1);
      setHasMore(true);
      fetchPosts(1);
    } catch (error) {
      console.error('[CreatePost] Error creating post:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create post');
    } finally {
      setIsSubmitting(false);
      setShowMediaOptions(false);
    }
  };

  const pickMedia = async (type: 'image' | 'video') => {
    try {
      const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        const { status: newStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (newStatus !== 'granted') {
          Alert.alert(
            'Permission Required',
            `Please grant media library access to upload a ${type}.`,
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
      }
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: type === 'image' ? 
          ImagePicker.MediaTypeOptions.Images : 
          ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: type === 'image' ? 0.8 : 0.7,
        videoMaxDuration: 60,
      });
      
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];

        const fileInfo = await FileSystem.getInfoAsync(asset.uri);
        
        if (!fileInfo.exists) {
          console.error('[CreatePostImagePicker] File does not exist at URI:', asset.uri);
          throw new Error('Selected file not found.');
        }

        const mediaItem: MediaItem = {
          type,
          url: asset.uri,
          duration: asset.duration || 0,
          size: fileInfo.exists ? (fileInfo as any).size || 0 : 0,
          mimeType: asset.mimeType || (type === 'image' ? 'image/jpeg' : 'video/mp4')
        };
        
        if (type === 'image') {
          setSelectedImage(mediaItem);
        } else {
          setSelectedAV(mediaItem);
        }
      }
    } catch (error) {
      console.error('[CreatePostImagePicker] Error in pickMedia:', error);
      Alert.alert('Error', `Failed to pick ${type}. Please try again.`);
    }
  };

  const startRecording = async () => {
    console.log('[MAIN_RECORDING_DEBUG] 🎤 Starting main recording');
    if (isRecording) return;
    
    const success = await startCentralizedRecording();
    if (success) {
      console.log('[MAIN_RECORDING_DEBUG] ✅ Main recording started successfully');
    } else {
      console.log('[MAIN_RECORDING_DEBUG] ❌ Main recording failed to start');
    }
  };

  const stopRecording = async () => {
    console.log('[MAIN_RECORDING_DEBUG] 🛑 Stopping main recording');
    if (!isRecording) return;
    
    const uri = await stopCentralizedRecording();
    if (uri) {
      console.log('[MAIN_RECORDING_DEBUG] ✅ Main recording stopped successfully, URI:', uri);
      try {
        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (!fileInfo.exists) {
          console.error('[MAIN_RECORDING_DEBUG] ❌ Recording file not found:', uri);
          return;
        }

        const { sound } = await Audio.Sound.createAsync({ uri });
        const status = await sound.getStatusAsync();
        const duration = status.isLoaded && 'durationMillis' in status && status.durationMillis ? status.durationMillis / 1000 : 0;
        await sound.unloadAsync();

        const mediaItem: MediaItem = {
          type: 'audio',
          url: uri,
          duration,
          size: fileInfo.exists ? (fileInfo as any).size || 0 : 0,
          mimeType: 'audio/m4a'
        };

        setSelectedAV(mediaItem);
        console.log('[MAIN_RECORDING_DEBUG] ✅ Main recording processed successfully');
      } catch (error) {
        console.error('[MAIN_RECORDING_DEBUG] ❌ Error processing main recording:', error);
      }
    } else {
      console.log('[MAIN_RECORDING_DEBUG] ❌ Main recording stopped but no URI returned');
    }
  };

  // Helper function to check current audio mode
  const logCurrentAudioMode = async () => {
    return null;
  };

  const handleModernModalPost = async (media: any) => {
    try {
      if (media.type === 'combined') {
        // Handle combined photo + audio
        const imageItem: MediaItem = {
          type: media.image.type,
          url: media.image.url,
          duration: media.image.duration || 0,
          size: media.image.size || 0,
          mimeType: media.image.mimeType || 'image/jpeg',
        };
        
        const audioItem: MediaItem = {
          type: media.audio.type,
          url: media.audio.url,
          duration: media.audio.duration || 0,
          size: media.audio.size || 0,
          mimeType: media.audio.mimeType || 'audio/m4a',
        };
        
        await handleCreatePostWithCombinedMedia(imageItem, audioItem);
      } else {
        // Handle single media item
        const mediaItem: MediaItem = {
          type: media.type,
          url: media.url,
          duration: media.duration || 0,
          size: media.size || 0,
          mimeType: media.mimeType || (media.type === 'image' ? 'image/jpeg' : 'audio/m4a'),
        };
        
        await handleCreatePostWithMedia(mediaItem);
      }
      
    } catch (error) {
      console.error('Error handling modern modal post:', error);
      Alert.alert('Error', 'Failed to post media');
    }
  };

  const handleCreatePostWithMedia = async (mediaItem: MediaItem) => {
    if (!user) {
      console.error('[CreatePost] No user found, cannot create post');
      Alert.alert('Error', 'You must be logged in to create a post');
      return;
    }
    if (!accessToken) {
      console.error('[CreatePost] No access token found, cannot create post');
      Alert.alert('Error', 'You must be logged in to create a post');
      return;
    }

    try {
      setIsSubmitting(true);
      
      // Upload the media
      const uploadedUrl = await uploadMedia(mediaItem);
      
      const uploadedMediaItem = {
        type: mediaItem.type,
        url: uploadedUrl,
        duration: mediaItem.duration,
        size: mediaItem.size,
        mimeType: mediaItem.mimeType
      };

      const postData = {
        userId: user.userId,
        media: [uploadedMediaItem]
      };

      const response = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.trim()}`,
        },
        body: JSON.stringify(postData)
      });

      if (!response.ok) {
        if (response.status === 401) {
          await refreshAccessToken();
          return handleCreatePostWithMedia(mediaItem);
        }
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create post');
      }

      // Reset states after successful post
      setSelectedImage(null);
      setSelectedAV(null);
      setShowComposer(false);
      setShowMediaOptions(false);
      
      // Refresh the feed
      setPage(1);
      setHasMore(true);
      fetchPosts(1);
      
    } catch (error) {
      console.error('[CreatePost] Error creating post:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create post');
    } finally {
      setIsSubmitting(false);
      setShowMediaOptions(false);
    }
  };

  const handleCreatePostWithCombinedMedia = async (imageItem: MediaItem, audioItem: MediaItem) => {
    if (!user) {
      console.error('[CreatePost] No user found, cannot create post');
      Alert.alert('Error', 'You must be logged in to create a post');
      return;
    }
    if (!accessToken) {
      console.error('[CreatePost] No access token found, cannot create post');
      Alert.alert('Error', 'You must be logged in to create a post');
      return;
    }

    try {
      setIsSubmitting(true);
      
      // Upload both media items
      const [uploadedImageUrl, uploadedAudioUrl] = await Promise.all([
        uploadMedia(imageItem),
        uploadMedia(audioItem)
      ]);
      
      const uploadedMediaItems = [
        {
          type: imageItem.type,
          url: uploadedImageUrl,
          duration: imageItem.duration,
          size: imageItem.size,
          mimeType: imageItem.mimeType
        },
        {
          type: audioItem.type,
          url: uploadedAudioUrl,
          duration: audioItem.duration,
          size: audioItem.size,
          mimeType: audioItem.mimeType
        }
      ];

      const postData = {
        userId: user.userId,
        media: uploadedMediaItems
      };

      const response = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.trim()}`,
        },
        body: JSON.stringify(postData)
      });

      if (!response.ok) {
        if (response.status === 401) {
          await refreshAccessToken();
          return handleCreatePostWithCombinedMedia(imageItem, audioItem);
        }
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create post');
      }

      // Reset states after successful post
      setSelectedImage(null);
      setSelectedAV(null);
      setShowComposer(false);
      setShowMediaOptions(false);
      
      // Refresh the feed
      setPage(1);
      setHasMore(true);
      fetchPosts(1);
      
    } catch (error) {
      console.error('[CreatePost] Error creating post:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create post');
    } finally {
      setIsSubmitting(false);
      setShowMediaOptions(false);
    }
  };

  const handlePlayPauseAudio = async (postId: string, audioUrl: string) => {
    if (playingAudioId === postId && audioSound) {
      if (audioIsPlaying) {
        await audioSound.pauseAsync();
        setAudioIsPlaying(false);
        if (animationFrame.current) {
          cancelAnimationFrame(animationFrame.current);
          animationFrame.current = null;
        }
        setFrequencyData(new Float32Array(64).fill(0.1));
      } else {
        await audioSound.playAsync();
        setAudioIsPlaying(true);
        updateFrequencyData();
      }
      return;
    }

    // Stop previous
    if (audioSound) {
      await audioSound.unloadAsync();
      setAudioSound(null);
    }
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
    setFrequencyData(new Float32Array(64).fill(0.1));

    // FIX: Add longer delay to ensure recording service cleanup completes
    await new Promise(resolve => setTimeout(resolve, 200)); // Increased from 50ms to 200ms

    // Set audio mode for playback (stereo speakers)
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('Error setting audio mode:', error);
    }

    // FIX: Add additional delay after setting audio mode
    await new Promise(resolve => setTimeout(resolve, 100)); // Increased from 50ms to 100ms

    // Play new
    const { sound } = await Audio.Sound.createAsync(
      { uri: audioUrl }, 
      { 
        shouldPlay: true,
        volume: 1.0,
        rate: 1.0,
        shouldCorrectPitch: true,
        progressUpdateIntervalMillis: 100
      }, 
      (status) => {
        if (status.isLoaded) {
          setAudioIsPlaying(status.isPlaying ?? false);
          if (status.didJustFinish) {
            setPlayingAudioId(null);
            setAudioIsPlaying(false);
            if (animationFrame.current) {
              cancelAnimationFrame(animationFrame.current);
              animationFrame.current = null;
            }
            setFrequencyData(new Float32Array(64).fill(0.1));
          }
        }
      }
    );

    // Set up audio analyzer
    if (!audioAnalyzer.current) {
      audioAnalyzer.current = new AudioAnalyzer();
    }
    try {
      await audioAnalyzer.current.setupAudio(sound);
    } catch (error) {
      console.error('Error setting up audio analyzer:', error);
      Alert.alert('Audio Analyzer Error', 'Could not analyze audio for animation.');
      setFrequencyData(new Float32Array(64).fill(0.1));
      return;
    }

    setAudioSound(sound);
    setPlayingAudioId(postId);
    await sound.playAsync();
    setAudioIsPlaying(true);
    updateFrequencyData();
  };

  const updateFrequencyData = () => {
    if (!audioIsPlaying) return;
    animationPhase.current += 0.08; // Animation speed
    const newData = Array.from({ length: 64 }, (_, i) =>
      0.5 + 0.5 * Math.sin(animationPhase.current + i * 0.25 + Math.sin(animationPhase.current * 0.5 + i))
    );
    setFrequencyData(Float32Array.from(newData));
    animationFrame.current = requestAnimationFrame(updateFrequencyData);
  };

  // Clean up audio and animation on unmount
  useEffect(() => {
    return () => {
      if (audioSound) {
        audioSound.unloadAsync();
      }
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }
      if (audioAnalyzer.current) {
        audioAnalyzer.current.cleanup();
        audioAnalyzer.current = null;
      }
    };
  }, [audioSound]);

  const onImageLoad = (url: string, width: number, height: number) => {
    if (width && height) {
      setImageAspectRatios(prev => ({ ...prev, [url]: width / height }));
    }
  };

  const renderMediaPreview = () => {
    
    return (
      <>
        {selectedImage && (
          <View style={styles.createPostMediaPreview}>
            <View style={styles.createPostMediaPreviewContainer}>
              <Image
                source={{ uri: selectedImage.url }}
                style={styles.createPostMediaPreviewImage}
                resizeMode="cover"
                onLoad={() => {
                  // Image preview loaded successfully
                }}
                onError={(error) => {
                  console.error('[CreatePostMediaPreview] Image preview load error:', error);
                  console.error('[CreatePostMediaPreview] Failed URL:', selectedImage.url);
                }}
              />
              <TouchableOpacity
                style={styles.removeMediaButton}
                onPress={() => {
                  setSelectedImage(null);
                }}
              >
                <Ionicons name="close-circle" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}
        {selectedAV && selectedAV.type === 'video' && (
          <View style={styles.createPostMediaPreview}>
            <View style={styles.createPostMediaPreviewContainer}>
              <Video
                source={{ uri: selectedAV.url }}
                style={styles.createPostMediaPreviewImage}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls
                onLoad={() => {
                  // Video preview loaded successfully
                }}
                onError={(error) => {
                  console.error('[CreatePostMediaPreview] Video preview load error:', error);
                  console.error('[CreatePostMediaPreview] Failed URL:', selectedAV.url);
                }}
              />
              <TouchableOpacity
                style={styles.removeMediaButton}
                onPress={() => {
                  setSelectedAV(null);
                }}
              >
                <Ionicons name="close-circle" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}
        {selectedAV && selectedAV.type === 'audio' && (
          <View style={styles.audioPreviewContainer}>
            <Ionicons name="musical-notes" size={32} color="#26A7DE" />
            <Text style={styles.audioDuration}>{Math.round(selectedAV.duration || 0)}s</Text>
            <TouchableOpacity
              style={styles.removeMediaButton}
              onPress={() => {
                setSelectedAV(null);
              }}
            >
              <Ionicons name="close-circle" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </>
    );
  };

  const renderMediaOptions = () => {
    return (
      <Modal
        visible={showMediaOptions}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowMediaOptions(false);
        }}
      >
        <TouchableOpacity 
          style={[styles.modalOverlay, { zIndex: 9999 }]}
          activeOpacity={1}
          onPress={() => {
            setShowMediaOptions(false);
          }}
        >
          <View style={styles.modalContent}>
            <TouchableOpacity
              style={styles.mediaOption}
              onPress={() => {
                setShowMediaOptions(false);
                setTimeout(() => {
                  pickMedia('image');
                }, 300);
              }}
            >
              <Ionicons name="image" size={24} color="#26A7DE" />
              <Text style={styles.mediaOptionText}>Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.mediaOption}
              onPress={() => {
                setShowMediaOptions(false);
                setTimeout(() => {
                  pickMedia('video');
                }, 300);
              }}
            >
              <Ionicons name="videocam" size={24} color="#26A7DE" />
              <Text style={styles.mediaOptionText}>Video</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.mediaOption}
              onPress={() => {
                setShowMediaOptions(false);
                setTimeout(() => {
                  if (isRecording) {
                    stopRecording();
                  } else {
                    startRecording();
                  }
                }, 300);
              }}
            >
              <Ionicons name={isRecording ? "stop-circle" : "mic"} size={24} color="#26A7DE" />
              <Text style={styles.mediaOptionText}>
                {isRecording ? "Stop Recording" : "Voice Message"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                setShowMediaOptions(false);
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };

  // Using centralized avatar utilities

  // Add handleDeletePost function after other handler functions
  const handleDeletePost = async (postId: string) => {
    try {
      if (!accessToken || !user?.userId) {
        Alert.alert('Error', 'You must be logged in to delete posts');
        return;
      }

      // Show confirmation dialog
      Alert.alert(
        'Delete Post',
        'Are you sure you want to delete this post? This action cannot be undone.',
        [
          {
            text: 'Cancel',
            style: 'cancel'
          },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                const response = await fetch(`${API_URL}/posts/${postId}`, {
                  method: 'DELETE',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken.trim()}`,
                  },
                  body: JSON.stringify({
                    userId: user.userId,
                  }),
                });

                if (!response.ok) {
                  if (response.status === 401) {
                    await refreshAccessToken();
                    return handleDeletePost(postId);
                  }
                  const errorData = await response.json();
                  throw new Error(errorData.error || 'Failed to delete post');
                }

                // Optimistically update the UI
                setPosts(prev => prev.filter(post => post._id !== postId));
                
                // Show success message
                Alert.alert('Success', 'Post deleted successfully');
              } catch (error) {
                console.error('Error deleting post:', error);
                Alert.alert('Error', error instanceof Error ? error.message : 'Failed to delete post');
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error in delete post flow:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    }
  };

  // Fetch comments for a post
  const fetchComments = async (postId: string, page = 1) => {
    setCommentsLoading(true);
    try {
      const response = await fetch(`${API_URL}/posts/${postId}/comments?page=${page}&limit=20`, {
        headers: {
          'Authorization': `Bearer ${accessToken?.trim()}`,
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          await refreshAccessToken();
          return fetchComments(postId, page);
        }
        throw new Error('Failed to fetch comments');
      }
      
      const data = await response.json();
      if (page === 1) {
        setComments(data.comments);
      } else {
        setComments(prev => [...prev, ...data.comments]);
      }
      setCommentPage(page);
      setCommentHasMore(page < data.totalPages);
    } catch (error) {
      console.error('Error fetching comments:', error);
      Alert.alert('Error', 'Failed to load comments');
    } finally {
      setCommentsLoading(false);
    }
  };

  // Send a comment
  const handleSendComment = async () => {
    if (!user || !accessToken || !commentMedia) {
      return;
    }
    
    setSendingComment(true);
    try {
      let mediaArr: MediaItem[] = [];
      
      // Upload the media using the same uploadMedia function used for posts
      if (commentMedia) {
        try {
          const uploadedUrl = await uploadMedia(commentMedia);
          
          mediaArr.push({
            type: commentMedia.type,
            url: uploadedUrl,
            duration: commentMedia.duration,
            size: commentMedia.size,
            mimeType: commentMedia.mimeType
          });
        } catch (error) {
          console.error('[CommentPost] Error uploading comment media:', error);
          Alert.alert('Error', 'Failed to upload media. Please try again.');
          return;
        }
      }
      
      // Send the comment with the uploaded media and required fields
      const commentData = {
        userId: user.userId,
        userName: user.name, // Include the user's name
        content: ' ', // Empty content since text input is removed
        media: mediaArr,
        createdAt: new Date().toISOString() // Include timestamp
      };


      const response = await fetch(`${API_URL}/posts/${activeCommentPostId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.trim()}`,
        },
        body: JSON.stringify(commentData)
      });

      if (!response.ok) {
        if (response.status === 401) {
          await refreshAccessToken();
          return handleSendComment();
        }
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send comment');
      }

      // Reset states after successful comment
      setCommentMedia(null);
      
      // Refresh comments
      fetchComments(activeCommentPostId!, 1);
    } catch (error) {
      console.error('[CommentPost] Error sending comment:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to send comment');
    } finally {
      setSendingComment(false);
    }
  };

  // Open comments modal
  const openComments = useCallback((postId: string) => {

    setActiveCommentPostId(postId);
    setComments([]);
    setCommentPage(1);
    setCommentHasMore(true);
    fetchComments(postId, 1);

  }, [fetchComments]);

  // Add this to the FeedScreen component, right after the openComments function
  useEffect(() => {
    if (activeCommentPostId) {
      // Modal is opening, ensure animation values are reset
      translateY.setValue(0);
      opacity.setValue(1);
    }
  }, [activeCommentPostId]);

  // Close comments modal
  const closeComments = async () => {

    try {
      // Set modal closing state
      setIsModalClosing(true);

      // Stop and unload any playing audio first
      const audioSound = commentAudioSound;
      if (audioSound) {
        console.log('[Close] Cleaning up audio');
        try {
          await audioSound.stopAsync();
          await audioSound.unloadAsync();
        } catch (error) {
          console.log('[Close] Error cleaning up audio:', error);
        }
      }

      // Clean up recording if active
      if (commentRecording) {
        try {
          await commentRecordingObj?.stopAndUnloadAsync();
        } catch (error) {
          console.log('[Close] Error stopping recording:', error);
        }
      }

      // Clear recording timer
      if (commentRecordingTimer) {
        clearInterval(commentRecordingTimer);
      }

      // Clean up preview audio
      if (previewAudioSound) {
        try {
          await previewAudioSound.unloadAsync();
        } catch (error) {
          console.log('[Close] Error cleaning up preview audio:', error);
        }
      }

      // Reset all state
      setCommentAudioSound(null);
      setPlayingCommentAudioId(null);
      setCommentAudioIsPlaying(false);
      setCommentRecording(false);
      setCommentRecordingObj(null);
      setCommentRecordingTimer(null);
      setPreviewAudioSound(null);
      setIsPreviewPlaying(false);
      setActiveCommentPostId(null);
      setComments([]);
      setCommentMedia(null);

      // Don't reset animation values here - let them stay in final state
      // Animation values will be reset when modal opens again

  
    } catch (error) {
      console.error('[Close] Error during cleanup:', error);
      // Even if there's an error, still close the modal
      setActiveCommentPostId(null);
      setComments([]);
      setCommentMedia(null);
      // Don't reset animation values here either
    } finally {
      setIsModalClosing(false);
    }
  };

  // Remove the separate audio cleanup effect since we handle it in closeComments
  useEffect(() => {
    return () => {
      if (commentAudioSound) {
        commentAudioSound.unloadAsync().catch(error => {
          console.log('[Effect] Error cleaning up audio:', error);
        });
      }
    };
  }, [commentAudioSound]);

  const pickCommentMedia = async (type: 'image') => {
    try {
      const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        const { status: newStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        
        if (newStatus !== 'granted') {
          console.error('[CommentImagePicker] User denied media library permission');
          Alert.alert('Permission Required', 'Please grant media library access to upload photos.');
          return;
        }
      }
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const fileInfo = await FileSystem.getInfoAsync(asset.uri);
        
        if (!fileInfo.exists) {
          console.error('[CommentImagePicker] File does not exist at URI:', asset.uri);
          throw new Error('File not found');
        }
        
        const mediaItem: MediaItem = {
          type: 'image',
          url: asset.uri,
          duration: asset.duration || 0,
          size: fileInfo.exists ? (fileInfo as any).size || 0 : 0,
          mimeType: asset.mimeType || 'image/jpeg'
        };
        
        setCommentMedia(mediaItem);
      }
    } catch (error) {
      console.error('[CommentImagePicker] Error in pickCommentMedia:', error);
      Alert.alert('Error', 'Failed to pick image.');
    }
  };

  const startCommentRecording = async () => {
    console.log('[COMMENT_RECORDING_DEBUG] 🎤 Starting comment recording');
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        console.log('[COMMENT_RECORDING_DEBUG] ❌ Microphone permission denied');
        Alert.alert('Permission Required', 'Please grant microphone access to record voice messages.');
        return;
      }
      console.log('[COMMENT_RECORDING_DEBUG] 🔊 Setting audio mode for recording (allowsRecordingIOS: true)');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      console.log('[COMMENT_RECORDING_DEBUG] ✅ Recording audio mode set successfully');
      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await newRecording.startAsync();
      setCommentRecordingObj(newRecording);
      setCommentRecording(true);
      const timer = setInterval(() => {}, 1000);
      setCommentRecordingTimer(timer);
      console.log('[COMMENT_RECORDING_DEBUG] ✅ Comment recording started successfully');
    } catch (error) {
      console.error('[COMMENT_RECORDING_DEBUG] ❌ Error starting comment recording:', error);
      Alert.alert('Recording Error', 'Failed to start recording.');
    }
  };

  const stopCommentRecording = async () => {
    console.log('[COMMENT_RECORDING_DEBUG] 🛑 Stopping comment recording');
    if (!commentRecordingObj) return;
    try {
      await commentRecordingObj.stopAndUnloadAsync();
      const uri = commentRecordingObj.getURI();
      if (!uri) throw new Error('No recording URI available');
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) throw new Error('Recording file not found');
      const sound = new Audio.Sound();
      await sound.loadAsync({ uri });
      const status = await sound.getStatusAsync();
      await sound.unloadAsync();
      const duration = status.isLoaded && status.durationMillis ? status.durationMillis / 1000 : 0;
      setCommentMedia({
        type: 'audio',
        url: uri,
        duration: duration,
        size: fileInfo.exists ? (fileInfo as any).size || 0 : 0,
        mimeType: 'audio/m4a'
      });
      console.log('[COMMENT_RECORDING_DEBUG] ✅ Comment recording processed successfully');
    } catch (error) {
      console.error('[COMMENT_RECORDING_DEBUG] ❌ Error processing comment recording:', error);
      Alert.alert('Recording Error', 'Failed to process recording.');
    } finally {
      setCommentRecordingObj(null);
      setCommentRecording(false);
      if (commentRecordingTimer) {
        clearInterval(commentRecordingTimer);
        setCommentRecordingTimer(null);
      }

      console.log('[COMMENT_RECORDING_DEBUG] 🔊 Resetting audio mode to playback mode (stereo speakers)');
      // Reset audio mode to playback mode (stereo speakers)
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
        console.log('[COMMENT_RECORDING_DEBUG] ✅ Audio mode reset to playback mode successfully');
      } catch (error) {
        console.error('[COMMENT_RECORDING_DEBUG] ❌ Error resetting audio mode:', error);
      }
    }
  };

  // Add play/pause logic for audio comments
  const handlePlayPauseCommentAudio = async (commentId: string, audioUrl: string) => {
    if (playingCommentAudioId === commentId && commentAudioSound) {
      if (commentAudioIsPlaying) {
        await commentAudioSound.pauseAsync();
        setCommentAudioIsPlaying(false);
      } else {
        await commentAudioSound.playAsync();
        setCommentAudioIsPlaying(true);
      }
      return;
    }
    // Stop previous
    if (commentAudioSound) {
      await commentAudioSound.unloadAsync();
      setCommentAudioSound(null);
    }
    
    // FIX: Add longer delay to ensure recording service cleanup completes
    await new Promise(resolve => setTimeout(resolve, 200)); // Increased from 50ms to 200ms

    // Set audio mode for playback (stereo speakers)
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('Error setting comment audio mode:', error);
    }
    
    // FIX: Add additional delay after setting audio mode
    await new Promise(resolve => setTimeout(resolve, 100)); // Increased from 50ms to 100ms
    
    // Play new
    const { sound } = await Audio.Sound.createAsync(
      { uri: audioUrl }, 
      { 
        shouldPlay: true,
        volume: 1.0,
        rate: 1.0,
        shouldCorrectPitch: true,
        progressUpdateIntervalMillis: 100
      }, 
      (status) => {
        if (status.isLoaded) {
          setCommentAudioIsPlaying(status.isPlaying ?? false);
          if (status.didJustFinish) {
            setPlayingCommentAudioId(null);
            setCommentAudioIsPlaying(false);
          }
        }
      }
    );
    setCommentAudioSound(sound);
    setPlayingCommentAudioId(commentId);
    await sound.playAsync();
    setCommentAudioIsPlaying(true);
  };

  // Clean up audio on unmount or when modal closes
  useEffect(() => {
    return () => {
      if (commentAudioSound) {
        commentAudioSound.unloadAsync();
      }
    };
  }, [commentAudioSound, activeCommentPostId]);

  const lastTapRef = useRef<{ [key: string]: number }>({});

  const handleDoubleTap = useCallback((postId: string) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - (lastTapRef.current[postId] || 0) < DOUBLE_TAP_DELAY) {
      openComments(postId);
    }
    lastTapRef.current[postId] = now;
  }, [openComments]);

  // Update the renderPost function
  const renderPost = ({ item: post }: { item: Post }) => (
    <PostItem
      post={post}
      onOpenComments={openComments}
      onDeletePost={handleDeletePost}
      onPlayPauseAudio={handlePlayPauseAudio}
      playingAudioId={playingAudioId}
      audioIsPlaying={audioIsPlaying}
      user={user}
      onImageLoad={onImageLoad}
      isHeaderVisible={isHeaderVisible}
      onToggleHeader={handleToggleHeader}
      headerAnimation={globalHeaderAnimation}
    />
  );

  // Add this near the top of the component
  const scrollViewRef = useRef<ScrollView>(null);
  const lastY = useRef(0);

  const handleScroll = useCallback((event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const currentX = event.nativeEvent.contentOffset.x;
    const isUp = currentY < lastY.current;
    const verticalDelta = Math.abs(currentY - lastY.current);
    lastY.current = currentY;
    
    // Only process vertical movement if we're not in the middle of a horizontal swipe
    const isHorizontalSwipe = Math.abs(currentX - Math.round(currentX / SCREEN_WIDTH) * SCREEN_WIDTH) > 10;
    
    // Increase threshold significantly to prevent interference with tap gestures
    // Only trigger on significant upward swipes, not minor movements from taps
    const VERTICAL_THRESHOLD = 50; // Increased from 10 to 50
    
    // Only trigger if it's a significant upward movement and not a tap-induced scroll
    if (isUp && !isMovingUp && !isHorizontalSwipe && verticalDelta > VERTICAL_THRESHOLD) {
      setIsMovingUp(true);
      // Get the current post index based on scroll position
      const currentIndex = Math.round(currentX / SCREEN_WIDTH);
      if (posts[currentIndex]) {
        openComments(posts[currentIndex]._id);
      }
    } else if (!isUp || verticalDelta < VERTICAL_THRESHOLD) {
      setIsMovingUp(false);
    }
  }, [posts, isMovingUp, openComments]);

  // Add this new function to handle scroll begin
  const handleScrollBegin = useCallback((event: any) => {
    const currentX = event.nativeEvent.contentOffset.x;
    const isHorizontalSwipe = Math.abs(currentX - Math.round(currentX / SCREEN_WIDTH) * SCREEN_WIDTH) > 10;
    
    if (isHorizontalSwipe) {
      // Lock vertical position when horizontal swipe begins
      lastY.current = event.nativeEvent.contentOffset.y;
      // Force the vertical position to stay the same
      scrollViewRef.current?.scrollTo({ y: lastY.current, animated: false });
    }
  }, []);

  // Add this function to handle preview audio playback
  const handlePreviewPlayPause = async () => {
    if (!commentMedia || commentMedia.type !== 'audio') return;

    if (isPreviewPlaying && previewAudioSound) {
      await previewAudioSound.pauseAsync();
      setIsPreviewPlaying(false);
    } else {
      // Stop any existing playback
      if (previewAudioSound) {
        await previewAudioSound.unloadAsync();
      }

      // FIX: Add longer delay to ensure recording service cleanup completes
      await new Promise(resolve => setTimeout(resolve, 200)); // Increased from 50ms to 200ms

      // Set audio mode for playback (stereo speakers)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // FIX: Add additional delay after setting audio mode
      await new Promise(resolve => setTimeout(resolve, 100)); // Increased from 50ms to 100ms
      
      // Play new
      const { sound } = await Audio.Sound.createAsync(
        { uri: commentMedia.url },
        { 
          shouldPlay: true,
          volume: 1.0,
          rate: 1.0,
          shouldCorrectPitch: true,
          progressUpdateIntervalMillis: 100
        },
        (status) => {
          if (status.isLoaded) {
            setIsPreviewPlaying(status.isPlaying ?? false);
            if (status.didJustFinish) {
              setIsPreviewPlaying(false);
            }
          }
        }
      );
      setPreviewAudioSound(sound);
      setIsPreviewPlaying(true);
    }
  };

  // Clean up preview audio when component unmounts or when comment media changes
  useEffect(() => {
    return () => {
      if (previewAudioSound) {
        previewAudioSound.unloadAsync();
      }
    };
  }, [previewAudioSound, commentMedia]);

  // Fullscreen media viewing functions
  const openImageFullscreen = (imageUri: string, allImages: string[] = []) => {
    //console.log('[Fullscreen] openImageFullscreen called with:', imageUri);
    
    // Prevent multiple rapid calls
    if (isImageFullscreen) {
      //console.log('[Fullscreen] Already in fullscreen mode, ignoring');
      return;
    }
    
    const images = allImages.length > 0 ? allImages : [imageUri];
    const imageIndex = images.findIndex(uri => uri === imageUri);
    //console.log('[Fullscreen] Setting images:', images, 'index:', imageIndex);
    
    // Use setTimeout to ensure state updates happen in the next tick
    setTimeout(() => {
      const imageObjects = images.map(uri => ({ uri }));
      setFullscreenImages(imageObjects);
      setFullscreenImageIndex(imageIndex >= 0 ? imageIndex : 0);
      setIsImageFullscreen(true);
    }, 50);
  };

  const openVideoFullscreen = async (videoUri: string) => {
    setFullscreenVideoUri(videoUri);
    setFullscreenVideoVisible(true);
  };

  const closeVideoFullscreen = async () => {
    if (videoRef.current) {
      await videoRef.current.pauseAsync();
    }
    setFullscreenVideoVisible(false);
    setFullscreenVideoUri('');
  };

  // Remove PanGestureHandler wrapping the main container.
  // Add overlay PanGestureHandler for left 25% of the screen only.
  const leftEdgePanRef = useRef(null);
  const handleLeftEdgeSwipe = useCallback((event: PanGestureHandlerGestureEvent) => {
    const { state, translationX } = event.nativeEvent;
    if (state === GestureState.END && translationX < -40) {
      globalNavigateToGC.value = Date.now();
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#26A7DE" />
        <Text style={styles.loadingText}>Loading posts...</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar
        translucent
        barStyle={Platform.OS === 'android' ? 'dark-content' : 'light-content'}
        backgroundColor="transparent"
      />
      {/* Fullscreen Image Viewer - Simplified */}
      {isImageFullscreen && (
        <Modal
          visible={isImageFullscreen}
          transparent={false}
          animationType="fade"
                  onRequestClose={() => {
          setIsImageFullscreen(false);
        }}
          statusBarTranslucent={true}
        >
          <View style={styles.fullscreenImageContainer}>
            {fullscreenImages.length > 0 && fullscreenImages[fullscreenImageIndex] && (
              <Image
                source={{ uri: fullscreenImages[fullscreenImageIndex].uri }}
                style={styles.fullscreenImage}
                resizeMode="contain"
                                  onLoad={() => {}}
                  onError={() => {}}
              />
            )}
            
            <TouchableOpacity
              style={styles.fullscreenImageCloseButton}
              onPress={() => {
                setIsImageFullscreen(false);
              }}
            >
              <Ionicons name="close" size={32} color="#fff" />
            </TouchableOpacity>
            

          </View>
        </Modal>
      )}

      {/* Overlay PanGestureHandler for left-edge swipe navigation (20px wide) */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: 20, height: '100%', zIndex: 100, pointerEvents: 'box-none' }} pointerEvents="box-none">
        <PanGestureHandler
          ref={leftEdgePanRef}
          onHandlerStateChange={handleLeftEdgeSwipe}
          onGestureEvent={handleLeftEdgeSwipe}
          activeOffsetX={[-10, 0]}
          enabled={true}
        >
          <View style={{ position: 'absolute', left: 0, top: 0, width: 20, height: '100%', pointerEvents: 'auto' }} />
        </PanGestureHandler>
      </View>

      <View style={styles.fullScreenContainer}>
        <ScrollView
          ref={scrollViewRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBegin}
          scrollEventThrottle={16}
          directionalLockEnabled={true}
          contentContainerStyle={styles.postsList}
          snapToInterval={SCREEN_WIDTH}
          decelerationRate={0.9}
          snapToAlignment="center"
          onMomentumScrollEnd={(event) => {
            const currentX = event.nativeEvent.contentOffset.x;
            const currentIndex = Math.round(currentX / SCREEN_WIDTH);
            if (posts[currentIndex]) {
              setIsMovingUp(false);
            }
          }}
        >
        {posts.map((post) => (
          <View key={post._id} style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}>
            <PostItem
              post={post}
              onOpenComments={openComments}
              onDeletePost={handleDeletePost}
              onPlayPauseAudio={handlePlayPauseAudio}
              playingAudioId={playingAudioId}
              audioIsPlaying={audioIsPlaying}
              user={user}
              onImageLoad={onImageLoad}
              isHeaderVisible={isHeaderVisible}
              onToggleHeader={handleToggleHeader}
              headerAnimation={globalHeaderAnimation}
            />
          </View>
        ))}
        {loadingMore && (
          <View style={styles.loadingMoreContainer}>
            <ActivityIndicator size="small" color="#26A7DE" />
            <Text style={styles.loadingMoreText}>Loading more posts...</Text>
          </View>
        )}
      </ScrollView>



      {/* Comments Modal */}
      <Modal
        visible={!!activeCommentPostId && !isImageFullscreen}
        transparent
        animationType="none"
        onRequestClose={closeComments}
      >
        <TouchableWithoutFeedback onPress={closeComments}>
          <Animated.View style={[styles.commentModalOverlay, { opacity }]}>
            <TouchableWithoutFeedback>
              <Animated.View 
                style={[
                  styles.commentModalBar, 
                  {
                    transform: [{ translateY }],
                  }
                ]}
              >
                {/* Larger drag handle area with pan gestures */}
                <View style={styles.dragHandleArea} {...dragHandlePanResponder.panHandlers}>
                  <View style={styles.dragHandleContainer}>
                    <View style={styles.dragHandle} />
                  </View>
                </View>
                
                <View style={styles.commentModalHeader}>
                  <Text style={styles.commentModalTitle}>Comments</Text>
                  <TouchableOpacity
                    style={styles.commentModalCloseBtn}
                    onPress={closeComments}
                  >
                    <Ionicons name="close" size={24} color="#fff" />
                  </TouchableOpacity>
                </View>
                
                {activeCommentPostId && (
                  <>
                    <FlatList
                      data={comments}
                      keyExtractor={comment => comment._id}
                      removeClippedSubviews={false}
                      maxToRenderPerBatch={5}
                      windowSize={5}
                      initialNumToRender={10}
                      renderItem={({ item: comment }) => (
                        <CommentItem
                          comment={comment}
                          playingCommentAudioId={playingCommentAudioId}
                          commentAudioIsPlaying={commentAudioIsPlaying}
                          onPlayPauseCommentAudio={handlePlayPauseCommentAudio}
                          onOpenImageFullscreen={openImageFullscreen}
                          onOpenVideoFullscreen={openVideoFullscreen}
                          activeCommentPostId={activeCommentPostId}
                          setShouldReopenComments={setShouldReopenComments}
                        />
                      )}
                      ListEmptyComponent={() => (
                        <Text style={styles.commentEmpty}>No comments yet</Text>
                      )}
                      onEndReached={() => {
                        if (commentHasMore && !commentsLoading) {
                          fetchComments(activeCommentPostId!, commentPage + 1);
                        }
                      }}
                      onEndReachedThreshold={0.5}
                      scrollEnabled={true}
                      bounces={true}
                      showsVerticalScrollIndicator={true}
                      contentContainerStyle={styles.commentsList}
                      scrollEventThrottle={16}
                      keyboardShouldPersistTaps="handled"
                      overScrollMode="always"
                      alwaysBounceVertical={true}
                      contentInsetAdjustmentBehavior="automatic"
                    />
                    <View style={styles.commentInputBar}>
                      {commentMedia && (
                        <View style={styles.commentMediaPreview}>
                          {commentMedia.type === 'image' && (
                            <View style={styles.commentMediaPreviewContainer}>
                              <Image
                                source={{ uri: commentMedia.url }}
                                style={styles.commentMediaPreviewImage}
                                resizeMode="cover"
                                                onLoad={() => {
                  // Image preview loaded successfully
                }}
                                onError={(error) => {
                                  console.error('[CommentImagePreview] Image preview load error:', error);
                                  console.error('[CommentImagePreview] Failed URL:', commentMedia.url);
                                }}
                              />
                              <TouchableOpacity
                                style={styles.removeCommentMediaButton}
                                                onPress={() => {
                  setCommentMedia(null);
                }}
                              >
                                <Ionicons name="close-circle" size={24} color="#fff" />
                              </TouchableOpacity>
                            </View>
                          )}
                          {commentMedia.type === 'audio' && (
                            <View style={styles.commentAudioPreviewContainer}>
                              <EnhancedVoiceComment
                                isPlaying={isPreviewPlaying}
                                duration={commentMedia.duration || 0}
                                onPlayPause={handlePreviewPlayPause}
                                showWaveform={true}
                              />
                              <TouchableOpacity
                                style={styles.removeCommentMediaButton}
                                onPress={() => {
                                  if (previewAudioSound) {
                                    previewAudioSound.unloadAsync();
                                  }
                                  setCommentMedia(null);
                                }}
                              >
                                <Ionicons name="close-circle" size={20} color="#fff" />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      )}
                      <View style={styles.inputWrapper}>
                        <TouchableOpacity
                          style={styles.inputButton}
                          onPress={() => {
                            pickCommentMedia('image');
                          }}
                        >
                          <Ionicons name="image" size={24} color="#26A7DE" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.inputButton}
                          onPress={() => {
                            if (commentRecording) {
                              stopCommentRecording();
                            } else {
                              startCommentRecording();
                            }
                          }}
                        >
                          <Ionicons
                            name={commentRecording ? "stop-circle" : "mic"}
                            size={24}
                            color="#26A7DE"
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.sendButton, !commentMedia && styles.sendBtnDisabled]}
                          onPress={() => {
                            handleSendComment();
                          }}
                          disabled={!commentMedia}
                        >
                          <Ionicons name="send" size={24} color="#26A7DE" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </>
                )}
              </Animated.View>
            </TouchableWithoutFeedback>
          </Animated.View>
        </TouchableWithoutFeedback>
      </Modal>







      {/* Fullscreen Video Modal */}
      <Modal
        visible={fullscreenVideoVisible}
        transparent
        animationType="fade"
        onRequestClose={closeVideoFullscreen}
      >
        <TouchableWithoutFeedback onPress={closeVideoFullscreen}>
          <View style={styles.fullscreenVideoContainer}>
            <TouchableWithoutFeedback>
              <View style={styles.fullscreenVideoContent}>
                {fullscreenVideoUri && (
                  <Video
                    ref={videoRef}
                    source={{ uri: fullscreenVideoUri }}
                    style={styles.fullscreenVideo}
                    resizeMode={ResizeMode.CONTAIN}
                    useNativeControls
                    shouldPlay={true}
                    isLooping={false}
                    isMuted={false}
                  />
                )}
                <TouchableOpacity
                  style={styles.fullscreenCloseButton}
                  onPress={closeVideoFullscreen}
                >
                  <Ionicons name="close" size={32} color="#fff" />
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
      </View>

      {/* TapGestureHandler overlay on the left 40px of the screen that triggers globalNavigateToGC.value = Date.now() on double tap */}
      <TapGestureHandler
        numberOfTaps={2}
        onActivated={() => {
          globalNavigateToGC.value = Date.now();
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 40,
            height: '100%',
            zIndex: 100,
            backgroundColor: 'transparent',
          }}
          pointerEvents="auto"
        />
      </TapGestureHandler>

      {/* Post Creation Composer Modal */}
      <ModernCameraModal
        visible={showComposer}
        onClose={() => {
          setShowComposer(false);
          setSelectedAV(null); // Clear any pending audio recording
        }}
        onCapture={handleModernModalPost}
        isRecording={isRecording}
        recordingDuration={recordingDuration}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        frequencyData={frequencyData}
        audioRecordingUri={selectedAV?.url}
      />

      {/* Media Options Modal - Moved outside composer modal */}
      {/* {renderMediaOptions()} */}
    </>
  );
}

const styles = StyleSheet.create({
  fullScreenContainer: {
    flex: 1,
    backgroundColor: '#000',
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  glassPost: {
    flex: 1,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: 'transparent',
    position: 'relative',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: 'rgba(38,167,222,0.18)',
  },
  avatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 22,
  },
  postHeaderRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : (StatusBar.currentHeight || 40),
    paddingBottom: 15,
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  headerBackButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    backgroundColor: 'transparent',
  },
  postContentWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  postUserName: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 18,
    marginRight: 6,
    marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  postUserHandle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    marginRight: 6,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  postDate: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  postContent: {
    display: 'none',
  },
  postMediaContainer: {
    width: '100%',
    marginVertical: 0,
    backgroundColor: 'transparent',
    marginLeft: 0,
    marginRight: 0,
    position: 'relative',
  },
  fullScreenMediaContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: 'transparent',
  },
  mediaWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  postMedia: {
    width: '100%',
    height: '100%',
    borderRadius: 0,
  },
  audioPlayerContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    flexDirection: 'column',
    alignItems: 'flex-start',
    backgroundColor: 'transparent',
    padding: 0,
  },
  audioPlayerOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    position: 'relative',
  },
  postActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 0,
    margin: 0,
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  actionText: {
    color: 'rgba(255,255,255,0.9)',
    marginLeft: 4,
    fontSize: 14,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  createPostContainer: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 16,
    margin: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  input: {
    color: '#fff',
    fontSize: 16,
    minHeight: 40,
    marginBottom: 12,
  },
  createPostActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  mediaButton: {
    padding: 8,
  },
  submitButton: {
    backgroundColor: '#6B2B8C',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  loadingText: {
    color: '#fff',
    marginTop: 12,
  },
  errorText: {
    color: '#fff',
    fontSize: 16,
  },
  postsList: {
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  audioDuration: {
    position: 'absolute',
    top: 110,
    left: 0,
    color: '#fff',
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  feedAudioDuration: {
    position: 'absolute',
    top: 25, // Move it up a bit higher
    right: -25, // Move it a little back to the left
    color: '#fff',
    fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
    fontWeight: '500',
  },
  mediaPreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 12,
  },
  mediaOptions: {
    backgroundColor: 'rgba(40,40,43,0.95)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  mediaOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
  },
  mediaOptionText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
  },
  cancelButton: {
    marginTop: 16,
    padding: 16,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  fab: {
    position: 'absolute',
    bottom: 100,
    right: 24,
    zIndex: 100,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 8,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  fabBlur: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  modalOverlayFull: {
    flex: 1,
    backgroundColor: 'rgba(40,40,43,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  composerModalCardTall: {
    width: Math.min(Dimensions.get('window').width - 32, 420),
    height: 380,
    backgroundColor: 'rgba(40,40,43,0.95)',
    borderRadius: 28,
    padding: 22,
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  composerModalCardStretched: {
    height: 418, // 380 + 10% = 418
  },
  composerModalCardFlexible: {
    width: Math.min(Dimensions.get('window').width - 32, 420),
    maxHeight: Dimensions.get('window').height * 0.8,
    backgroundColor: 'rgba(40,40,43,0.95)',
    borderRadius: 28,
    padding: 22,
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  composerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    minHeight: 200,
  },
  composerContentFixed: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: 280,
  },
  composerScrollView: {
    flex: 1,
    width: '100%',
  },
  composerScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
  micIconContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    position: 'relative',
  },
  micIconContainerBelow: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    position: 'relative',
  },
  micButton: {
    backgroundColor: 'rgba(38,167,222,0.10)',
    borderRadius: 48,
    padding: 18,
    marginBottom: 12,
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    position: 'relative',
  },
  micLabel: {
    color: '#26A7DE',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 8,
  },
  closeComposerBtn: {
    marginLeft: 12,
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignSelf: 'center',
  },
  vmAnimationBg: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
    opacity: 0.7,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none', // Prevent blocking touch events
  },
  attachPhotoBtn: {
    padding: 6,
  },
  commentInputBar: {
    padding: 14,
    backgroundColor: 'rgba(40,40,43,0.13)',
    borderTopWidth: 0,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 22,
    padding: 10,
    shadowColor: '#1a1a2e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 4,
    elevation: 2,
  },
  inputButton: {
    padding: 6,
  },
  sendButton: {
    padding: 6,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  audioPreviewContainer: {
    marginTop: 12,
    padding: 15,
    backgroundColor: 'rgba(38,167,222,0.10)',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  audioPlayBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 0,
  },
  audioVisualizationContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    width: 150,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  removeMediaButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
  },
  mediaPreviewContainer: {
    marginTop: 12,
    position: 'relative',
  },
  createPostMediaPreview: {
    width: '100%',
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  createPostMediaPreviewContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  createPostMediaPreviewImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(40,40,43,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'rgba(40,40,43,0.95)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    minHeight: '50%',
  },
  mediaContainer: {
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  actionRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(38,167,222,0.10)',
    paddingTop: 10,
    marginTop: 8,
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
    paddingBottom: 20,
    paddingHorizontal: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  loadingMoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  loadingMoreText: {
    color: '#26A7DE',
    fontSize: 16,
    marginLeft: 8,
  },
  deleteButton: {
    marginLeft: 'auto',
    padding: 4,
  },
  commentModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(40,40,43,0.7)',
  },
  commentModalBar: {
    backgroundColor: THEME.primary,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    minHeight: 200,
    maxHeight: Dimensions.get('window').height * 0.75, // Changed from 0.98 to 0.75
    flexDirection: 'column',
    flex: 1,
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
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
  },
  commentItem: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: 'transparent',
  },
  commentEmpty: {
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginVertical: 16,
  },
  commentMediaImage: {
    width: '100%',
    aspectRatio: 1.5,
    borderRadius: 8,
    marginVertical: 6,
    backgroundColor: 'rgba(38,167,222,0.08)',
  },
  commentAudioPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(38,167,222,0.18)',
    borderRadius: 8,
    padding: 8,
    marginVertical: 6,
  },
  commentModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  commentModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: THEME.white,
  },
  commentModalCloseBtn: {
    padding: 4,
  },
  swipeUpIndicator: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: 8,
    borderRadius: 20,
    marginHorizontal: 20,
  },
  swipeUpText: {
    color: 'rgba(255,255,255,0.5)',
    marginLeft: 8,
    fontSize: 14,
  },
  commentMediaPreview: {
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  commentMediaPreviewContainer: {
    position: 'relative',
    width: '100%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  commentMediaPreviewImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  commentAudioPreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    padding: 8,
    borderRadius: 12,
    gap: 8,
    position: 'relative',
  },
  commentAudioPlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeCommentMediaButton: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 15,
    zIndex: 10,
    padding: 4,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileModalContent: {
    width: '80%',
    backgroundColor: 'rgba(40,40,43,0.95)',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  profileAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(38,167,222,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    borderWidth: 2,
    borderColor: 'rgba(38,167,222,0.3)',
  },
  profileAvatarText: {
    color: '#26A7DE',
    fontSize: 24,
    fontWeight: 'bold',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  profileHandle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
    marginBottom: 4,
  },
  profileJoinDate: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  profileCloseButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 8,
  },
  commentsList: {
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  commentInput: {
    color: '#fff',
    fontSize: 16,
    minHeight: 40,
    marginBottom: 12,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(38,167,222,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  commentAvatarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  commentContent: {
    flex: 1,
  },
  commentUser: {
    fontWeight: 'bold',
    color: THEME.accentBlue,
    fontSize: 14,
  },
  commentText: {
    color: THEME.white,
    fontSize: 14,
  },
  commentTextLine: {
    flexWrap: 'wrap',
    lineHeight: 18,
  },
  commentMediaContainer: {
    marginTop: 8,
    marginBottom: 4,
  },
  videoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenVideoContainer: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenVideoContent: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenVideo: {
    width: '100%',
    height: '100%',
  },
  fullscreenCloseButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    zIndex: 1,
  },
  fullscreenImageContainer: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImageContent: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
  },
  fullscreenImageCloseButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    zIndex: 1,
  },
  fullscreenImageBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  commentMediaPressable: {
    borderRadius: 8,
  },
  commentMediaPressed: {
    opacity: 0.8,
  },
  recordingDuration: {
    color: '#26A7DE',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  recordingDurationFixed: {
    position: 'absolute',
    bottom: -8,
    right: -8,
    color: '#26A7DE',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(40,40,43,0.9)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(38,167,222,0.3)',
  },
}); 

FeedScreen.displayName = 'FeedScreen';
ProfileModal.displayName = 'ProfileModal';
CommentItem.displayName = 'CommentItem';