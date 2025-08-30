import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Ionicons } from '@expo/vector-icons';
import { decode as base64Decode } from 'base-64';
import { Audio, ResizeMode, Video } from 'expo-av';
import { Camera } from 'expo-camera';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView as SNSafeAreaView } from 'react-native-safe-area-context';
import { BUCKET_NAME, s3Client } from '../config/aws-config';
import { useRecording } from '../hooks/useRecording';
import { useAuth } from './context/AuthContext';

// Update API URL to use your actual server IP address
const API_URL = Constants.expoConfig?.extra?.API_URL;

interface User {
  userId: string;
  email: string;
  name: string;
  _id: string;
  accessToken?: string;
}

interface MediaItem {
  id: string;
  url: string;
  type: 'image' | 'video' | 'audio';
  mimeType: string;
}

interface Post {
  _id: string;
  userId: string;
  content: string;
  media: MediaItem[];
  createdAt: string;
  likes: number;
  comments: Comment[];
}

interface Comment {
  _id: string;
  userId: string;
  content: string;
  createdAt: string;
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

const uploadPostImage = async (uri: string, key: string): Promise<string> => {
  try {
    console.log('Starting image upload for post:', uri);
    
    // Read the file content
    const fileContent = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Convert base64 to Uint8Array using our helper function
    const imageData = base64ToUint8Array(fileContent);

    // Upload to S3
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: imageData,
      ContentType: 'image/jpeg'
    };

    console.log('Uploading image to S3 with params:', { bucket: BUCKET_NAME, key });
    await s3Client.send(new PutObjectCommand(uploadParams));
    console.log('Image upload successful');

    // Return the S3 URL
    return `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;
  } catch (error) {
    console.error('Error uploading image to S3:', error);
    throw error;
  }
};

export default function PostScreen() {
  const { user, accessToken, refreshAccessToken } = useAuth() as { 
    user: User | null, 
    accessToken: string | null,
    refreshAccessToken: () => Promise<void> 
  };
  const { isRecording, duration: recordingDuration, startRecording: startCentralizedRecording, stopRecording: stopCentralizedRecording } = useRecording();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newPost, setNewPost] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showMediaOptions, setShowMediaOptions] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<boolean | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [audioPermission, setAudioPermission] = useState<boolean | null>(null);
  const [mediaPermission, setMediaPermission] = useState<boolean | null>(null);

  const isAndroid = Platform.OS === 'android';

  // Check and request permissions on component mount
  useEffect(() => {
    const initialize = async () => {
      try {
        await checkAndRequestPermissions();
        await fetchPosts();
      } catch (error) {
        console.error('Error during initialization:', error);
        setLoading(false);
        Alert.alert('Error', 'Failed to load posts. Please try again.');
      }
    };
    
    initialize();
  }, []);

  const checkAndRequestPermissions = async () => {
    try {
      // Check media library permissions
      const { status: mediaStatus } = await ImagePicker.getMediaLibraryPermissionsAsync();
      console.log('Initial media library permission status:', mediaStatus);
      
      if (mediaStatus === 'granted') {
        setMediaPermission(true);
      } else if (mediaStatus === 'undetermined') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        setMediaPermission(status === 'granted');
        console.log('Media library permission request result:', status);
      } else {
        setMediaPermission(false);
      }

      // Check camera permissions
      const { status: cameraStatus } = await Camera.getCameraPermissionsAsync();
      if (cameraStatus === 'granted') {
        setCameraPermission(true);
      } else if (cameraStatus === 'undetermined') {
        const { status } = await Camera.requestCameraPermissionsAsync();
        setCameraPermission(status === 'granted');
      } else {
        setCameraPermission(false);
      }

      // Check audio permissions
      const { status: audioStatus } = await Audio.getPermissionsAsync();
      if (audioStatus === 'granted') {
        setAudioPermission(true);
      } else if (audioStatus === 'undetermined') {
        const { status } = await Audio.requestPermissionsAsync();
        setAudioPermission(status === 'granted');
      } else {
        setAudioPermission(false);
      }

      // Configure audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  };

  const startRecording = async () => {
    const success = await startCentralizedRecording();
    if (!success) {
      Alert.alert('Recording Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    const uri = await stopCentralizedRecording();
    if (uri) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (!fileInfo.exists) {
          throw new Error('Recording file not found');
        }

        // Get audio duration
        const sound = new Audio.Sound();
        await sound.loadAsync({ uri });
        const status = await sound.getStatusAsync();
        await sound.unloadAsync();

        const duration = status.isLoaded && status.durationMillis ? status.durationMillis / 1000 : 0;

        setSelectedMedia({
          id: '',
          url: uri,
          type: 'audio',
          mimeType: 'audio/m4a'
        });

        console.log('Audio recording processed successfully');
      } catch (err) {
        console.error('Failed to process recording:', err);
        Alert.alert('Recording Error', 'Failed to process recording. Please try again.');
      }
    }
  };

  const pickMedia = async (type: 'image' | 'video') => {
    try {
      console.log('Starting media picker for type:', type);
      
      // Always check permissions first
      const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
      console.log('Current media library permission status:', status);
      
      if (status !== 'granted') {
        console.log('Requesting media library permissions...');
        const { status: newStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        console.log('Media library permission request result:', newStatus);
        
        if (newStatus !== 'granted') {
          console.log('Permission denied, showing settings alert');
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

      // If we have permission, launch the picker
      console.log('Media permission granted, launching picker');
      await launchMediaPicker(type);
    } catch (error) {
      Alert.alert('Error', `Failed to pick ${type}. Please try again.`);
    }
  };

  const launchMediaPicker = async (type: 'image' | 'video') => {
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: type === 'image' ? 
          ImagePicker.MediaTypeOptions.Images : 
          ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: type === 'image' ? 0.8 : 0.7,
        videoMaxDuration: 60,
        videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
        allowsMultipleSelection: false,
        exif: true,
        presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
      };

      console.log('Launching media picker with options:', options);
      
      // Add a small delay to ensure the UI is ready
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const result = await ImagePicker.launchImageLibraryAsync(options);
      console.log('Media picker result:', result);

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        console.log('Selected asset:', asset);

        if (type === 'video') {
          await handleVideoSelection(asset);
        } else {
          await handleImageSelection(asset);
        }
      } else {
        console.log('Media selection was canceled or no assets were selected');
      }
    } catch (error) {
      console.error('Error launching media picker:', error);
      Alert.alert(
        'Error',
        'Failed to open media picker. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleVideoSelection = async (asset: ImagePicker.ImagePickerAsset) => {
    try {
      console.log('Processing video selection:', asset);
      const fileInfo = await FileSystem.getInfoAsync(asset.uri);
      console.log('Video file info:', fileInfo);

      if (!fileInfo.exists) {
        throw new Error('Video file not found');
      }

      const duration = asset.duration || 0;
      console.log('Video duration:', duration);

      const maxSize = 100 * 1024 * 1024; // 100MB
      const fileSize = fileInfo.exists ? (fileInfo as any).size || 0 : 0;
      if (fileSize > maxSize) {
        Alert.alert('Error', 'Video file is too large. Please select a video under 100MB.');
        return;
      }

      setSelectedMedia({
        id: '',
        url: asset.uri,
        type: 'video',
        mimeType: 'video/mp4'
      });
    } catch (error) {
      console.error('Error handling video selection:', error);
      Alert.alert(
        'Error',
        'Failed to process video. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleImageSelection = async (asset: ImagePicker.ImagePickerAsset) => {
    try {
      console.log('Processing image selection:', asset);
      const fileInfo = await FileSystem.getInfoAsync(asset.uri);
      console.log('Image file info:', fileInfo);

      if (!fileInfo.exists) {
        throw new Error('Image file not found');
      }

      const maxSize = 10 * 1024 * 1024; // 10MB
      const fileSize = fileInfo.exists ? (fileInfo as any).size || 0 : 0;
      if (fileSize > maxSize) {
        Alert.alert('Error', 'Image file is too large. Please select an image under 10MB.');
        return;
      }

      setSelectedMedia({
        id: '',
        url: asset.uri,
        type: 'image',
        mimeType: asset.mimeType || 'image/jpeg'
      });
    } catch (error) {
      console.error('Error handling image selection:', error);
      Alert.alert(
        'Error',
        'Failed to process image. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const uploadMedia = async (media: MediaItem): Promise<string> => {
    try {
      const timestamp = Date.now();
      const fileExtension = media.type === 'image' ? 'jpg' : 
                           media.type === 'video' ? 'mp4' : 'm4a';
      const key = `posts/${media.type}/${timestamp}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
      
      console.log('Starting media upload:', { type: media.type, key });

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

        console.log('Uploading video to S3...');
        await s3Client.send(new PutObjectCommand(uploadParams));
        console.log('Video upload successful');

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

      return `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;
    } catch (error) {
      console.error('Error uploading media:', error);
      throw error;
    }
  };

  const fetchPosts = async (pageNum = 1) => {
    try {
      if (!accessToken) {
        console.log('No access token available');
        setLoading(false);
        return;
      }

      console.log('Fetching posts for page:', pageNum);
      const response = await fetch(`${API_URL}/posts?page=${pageNum}&limit=10`, {
        headers: {
          'Authorization': `Bearer ${accessToken.trim()}`,
        },
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          console.log('Token expired, attempting to refresh');
          // Token might be expired, try to refresh
          await refreshAccessToken();
          // Retry the request with new token
          return fetchPosts(pageNum);
        }
        throw new Error(`Failed to fetch posts: ${response.status}`);
      }

      const data = await response.json();
      console.log('Posts fetched successfully:', data);
      
      if (pageNum === 1) {
        setPosts(data.posts);
      } else {
        setPosts(prev => [...prev, ...data.posts]);
      }
      
      setHasMore(data.currentPage < data.totalPages);
      setPage(data.currentPage);
    } catch (error) {
      console.error('Error fetching posts:', error);
      Alert.alert('Error', 'Failed to fetch posts. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    setPage(1);
    fetchPosts(1);
  };

  const handleSubmit = async () => {
    if (!newPost.trim() && !selectedMedia) {
      Alert.alert('Error', 'Please enter some content or select media');
      return;
    }

    if (!accessToken) {
      Alert.alert('Error', 'You must be logged in to create a post');
      return;
    }

    setIsSubmitting(true);
    try {
      let media = [];
      if (selectedMedia) {
        const uploadedUrl = await uploadMedia(selectedMedia);
        media.push({
          id: '',
          url: uploadedUrl,
          type: selectedMedia.type,
          mimeType: selectedMedia.mimeType
        });
      }

      const response = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.trim()}`,
        },
        body: JSON.stringify({
          userId: user?.userId,
          content: newPost.trim(),
          media,
          isPublic: true
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token might be expired, try to refresh
          await refreshAccessToken();
          // Retry the request with new token
          return handleSubmit();
        }
        const errorData = await response.json();
        throw new Error(`Failed to create post: ${errorData.error || 'Unknown error'}`);
      }

      setNewPost('');
      setSelectedMedia(null);
      onRefresh();
    } catch (error) {
      console.error('Error creating post:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create post');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLike = async (postId: string) => {
    try {
      if (!accessToken) {
        Alert.alert('Error', 'You must be logged in to like posts');
        return;
      }

      const response = await fetch(`${API_URL}/posts/${postId}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.trim()}`,
        },
        body: JSON.stringify({
          userId: user?.userId,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token might be expired, try to refresh
          await refreshAccessToken();
          // Retry the request with new token
          return handleLike(postId);
        }
        throw new Error('Failed to like post');
      }

      // Update local state
      setPosts(prev =>
        prev.map(post =>
          post._id === postId
            ? { ...post, likes: post.likes + 1 }
            : post
        )
      );
    } catch (error) {
      console.error('Error liking post:', error);
      Alert.alert('Error', 'Failed to like post');
    }
  };

  const renderMediaPreview = () => {
    if (!selectedMedia && !isRecording) return null;

    if (isRecording) {
      return (
        <View style={styles.recordingContainer}>
          <View style={styles.recordingIndicator}>
            <Ionicons name="mic" size={24} color="#fff" />
            <Text style={styles.recordingText}>
              Recording... {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.stopRecordingButton}
            onPress={stopRecording}
          >
            <Ionicons name="stop-circle" size={32} color="#ff4444" />
          </TouchableOpacity>
        </View>
      );
    }

    if (!selectedMedia) return null;

    switch (selectedMedia.type) {
      case 'image':
        return (
          <View style={styles.mediaPreviewContainer}>
            <Image
              source={{ uri: selectedMedia.url }}
              style={styles.mediaPreview}
              resizeMode="cover"
            />
            <TouchableOpacity
              style={styles.removeMediaButton}
              onPress={() => setSelectedMedia(null)}
            >
              <Ionicons name="close-circle" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        );
      case 'video':
        return (
          <View style={styles.mediaPreviewContainer}>
            <Video
              source={{ uri: selectedMedia.url }}
              style={styles.mediaPreview}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
            />
            <TouchableOpacity
              style={styles.removeMediaButton}
              onPress={() => setSelectedMedia(null)}
            >
              <Ionicons name="close-circle" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        );
      case 'audio':
        return (
          <View style={styles.audioPreviewContainer}>
            <Ionicons name="musical-notes" size={32} color="#6B2B8C" />
            <Text style={styles.audioDuration}>
              {Math.round(recordingDuration || 0)}s
            </Text>
            <TouchableOpacity
              style={styles.removeMediaButton}
              onPress={() => setSelectedMedia(null)}
            >
              <Ionicons name="close-circle" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        );
      default:
        return null;
    }
  };

  const renderMediaOptions = () => (
    <Modal
      visible={showMediaOptions}
      transparent
      animationType="slide"
      onRequestClose={() => setShowMediaOptions(false)}
    >
      <TouchableOpacity 
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => setShowMediaOptions(false)}
      >
        <View style={styles.modalContent}>
          <TouchableOpacity
            style={styles.mediaOption}
            onPress={async () => {
              setShowMediaOptions(false);
              // Add a small delay to ensure modal is closed before opening picker
              setTimeout(() => {
                pickMedia('image');
              }, 300);
            }}
          >
            <Ionicons name="image" size={24} color="#6B2B8C" />
            <Text style={styles.mediaOptionText}>Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.mediaOption}
            onPress={async () => {
              setShowMediaOptions(false);
              // Add a small delay to ensure modal is closed before opening picker
              setTimeout(() => {
                pickMedia('video');
              }, 300);
            }}
          >
            <Ionicons name="videocam" size={24} color="#6B2B8C" />
            <Text style={styles.mediaOptionText}>Video</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.mediaOption}
            onPress={async () => {
              setShowMediaOptions(false);
              // Add a small delay to ensure modal is closed before opening picker
              setTimeout(() => {
                if (isRecording) {
                  stopRecording();
                } else {
                  startRecording();
                }
              }, 300);
            }}
          >
            <Ionicons name={isRecording ? "stop-circle" : "mic"} size={24} color="#6B2B8C" />
            <Text style={styles.mediaOptionText}>
              {isRecording ? "Stop Recording" : "Voice Message"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => setShowMediaOptions(false)}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  const renderPost = ({ item: post }: { item: Post }) => (
    <View style={styles.postContainer}>
      <View style={styles.postHeader}>
        <Text style={styles.postUser}>User {post.userId}</Text>
        <Text style={styles.postDate}>
          {new Date(post.createdAt).toLocaleDateString()}
        </Text>
      </View>
      
      <Text style={styles.postContent}>{post.content}</Text>
      
      {post.media?.length > 0 && (
        <View style={styles.postMediaContainer}>
          {post.media.map((media, index) => (
            <View key={index} style={styles.mediaContainer}>
              {media.type === 'image' && (
                <Image
                  source={{ uri: media.url }}
                  style={styles.postMedia}
                  resizeMode="cover"
                  onError={(error) => {
                    console.error('Error loading image:', error.nativeEvent.error);
                    Alert.alert('Error', 'Failed to load image');
                  }}
                />
              )}
              {media.type === 'video' && (
                <Video
                  source={{ uri: media.url }}
                  style={styles.postMedia}
                  resizeMode={ResizeMode.CONTAIN}
                  useNativeControls
                  onError={(error) => {
                    console.error('Error loading video:', error);
                    Alert.alert('Error', 'Failed to load video');
                  }}
                  shouldPlay={false}
                  isLooping={false}
                  isMuted={true}
                />
              )}
              {media.type === 'audio' && (
                <View style={styles.audioPlayerContainer}>
                  <Ionicons name="musical-notes" size={24} color="#6B2B8C" />
                  <Text style={styles.audioDuration}>
                    {Math.round(recordingDuration || 0)}s
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
      
      <View style={styles.postActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleLike(post._id)}
        >
          <Ionicons name="heart-outline" size={24} color="#6B2B8C" />
          <Text style={styles.actionText}>{post.likes}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.actionButton}>
          <Ionicons name="chatbubble-outline" size={24} color="#6B2B8C" />
          <Text style={styles.actionText}>{post.comments.length}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6B2B8C" />
        <Text style={styles.loadingText}>Loading posts...</Text>
      </View>
    );
  }

  if (!accessToken) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Please log in to view posts</Text>
      </View>
    );
  }

  return (
    <SNSafeAreaView style={styles.safeArea} edges={isAndroid ? ['top'] : undefined}>
      <Stack.Screen
        options={{
          title: 'Posts',
          headerStyle: {
            backgroundColor: '#6B2B8C',
          },
          headerTintColor: '#fff',
        }}
      />
      
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
        keyboardVerticalOffset={isAndroid ? (StatusBar.currentHeight || 0) : 0}
      >
        <View style={styles.createPostContainer}>
          <TextInput
            style={styles.input}
            placeholder="What's on your mind?"
            value={newPost}
            onChangeText={setNewPost}
            multiline
          />
          
          {renderMediaPreview()}
          
          <View style={styles.createPostActions}>
            <TouchableOpacity
              style={styles.mediaButton}
              onPress={() => setShowMediaOptions(true)}
              {...(isAndroid ? { android_ripple: { color: '#26A7DE', borderless: false } } : {})}
            >
              <Ionicons name="add-circle" size={24} color="#6B2B8C" />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              {...(isAndroid ? { android_ripple: { color: '#26A7DE', borderless: false } } : {})}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <FlatList
          data={posts}
          renderItem={renderPost}
          keyExtractor={post => post._id}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onEndReached={() => {
            if (hasMore) {
              fetchPosts(page + 1);
            }
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={styles.postsList}
          removeClippedSubviews={true}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={11}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        />
      </KeyboardAvoidingView>

      {renderMediaOptions()}
    </SNSafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 10,
    color: '#6B2B8C',
    fontSize: 16,
  },
  errorText: {
    color: '#ff4444',
    fontSize: 16,
    textAlign: 'center',
    padding: 20,
  },
  createPostContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  imagePreviewContainer: {
    marginTop: 12,
    position: 'relative',
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
  },
  createPostActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  mediaButton: {
    padding: 8,
  },
  submitButton: {
    backgroundColor: '#6B2B8C',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  postsList: {
    padding: 16,
  },
  postContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  postUser: {
    fontWeight: 'bold',
    color: '#6B2B8C',
  },
  postDate: {
    color: '#666',
    fontSize: 12,
  },
  postContent: {
    fontSize: 16,
    marginBottom: 12,
  },
  postImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 12,
  },
  postActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 24,
  },
  actionText: {
    marginLeft: 4,
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  mediaOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  mediaOptionText: {
    marginLeft: 15,
    fontSize: 16,
    color: '#333',
  },
  cancelButton: {
    padding: 15,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#6B2B8C',
    fontSize: 16,
    fontWeight: 'bold',
  },
  mediaPreviewContainer: {
    marginTop: 12,
    position: 'relative',
  },
  mediaPreview: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  audioPreviewContainer: {
    marginTop: 12,
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  audioDuration: {
    marginLeft: 10,
    color: '#666',
  },
  removeMediaButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
  },
  postMediaContainer: {
    marginTop: 12,
    borderRadius: 8,
    overflow: 'hidden',
  },
  mediaContainer: {
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  postMedia: {
    width: '100%',
    height: 300,
    borderRadius: 8,
  },
  audioPlayerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  recordingContainer: {
    marginTop: 12,
    padding: 15,
    backgroundColor: '#6B2B8C',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingText: {
    color: '#fff',
    marginLeft: 10,
    fontSize: 16,
  },
  stopRecordingButton: {
    padding: 5,
  },
});
