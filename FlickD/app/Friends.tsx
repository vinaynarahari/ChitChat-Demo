import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView as SNSafeAreaView } from 'react-native-safe-area-context';
import AnimatedSVGBackground from '../components/AnimatedSVGBackground';
import PulsatingBackground from '../components/PulsatingBackground';
import { useAuth } from './context/AuthContext';
import { getAvatarColor, getInitials } from './utils/avatarUtils';
import eventBus from './utils/eventBus';

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  primary: '#282828',
  gray: '#666666',
  lightGray: '#EEEEEE'
};

const API_URL = Constants.expoConfig?.extra?.API_URL;

// Helper to build API URLs without double /api
function buildApiUrl(path: string) {
  if (!API_URL) return path;
  return API_URL.endsWith('/api') ? `${API_URL}${path.startsWith('/') ? '' : '/'}${path}` : `${API_URL}/api${path.startsWith('/') ? '' : '/'}${path}`;
}

export default function FriendsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [friendRequests, setFriendRequests] = useState<any[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [friendDetails, setFriendDetails] = useState<any[]>([]);
  const [friendRequestDetails, setFriendRequestDetails] = useState<Record<string, string>>({});
  const [pendingRequests, setPendingRequests] = useState<string[]>([]);

  const searchDebounceRef = useRef<number | null>(null);

  // Search users
  const searchUsers = async (email: string) => {
    setIsSearching(true);
    try {
      const res = await fetch(`${API_URL}/users?email=${encodeURIComponent(email)}`);
      if (!res.ok) throw new Error('Failed to search users');
      const users = await res.json();
      // Exclude self and already friends
      setSearchResults(users.filter((u: any) => u.userId !== user?.userId && !friends.includes(u.userId)));
    } catch (err) {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Send friend request
  const sendFriendRequest = async (toUserId: string) => {
    setPendingRequests(prev => [...prev, toUserId]); // Optimistically disable button
    try {
      const res = await fetch(buildApiUrl('/friends/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: user?.userId, to: toUserId })
      });
      if (!res.ok) throw new Error('Failed to send request');
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error('Invalid JSON response from server');
      }
      if (!res.ok) throw new Error(data.error || 'Failed to send request');
      setSearch(''); // Clear search input
      setSearchResults([]); // Clear search results after sending request
      Alert.alert('Request Sent', 'Friend request sent successfully!');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send request');
      setPendingRequests(prev => prev.filter(id => id !== toUserId)); // Re-enable on error
    }
  };

  // Get incoming friend requests
  const fetchFriendRequests = async () => {
    setLoadingRequests(true);
    try {
      const res = await fetch(buildApiUrl(`/friends/requests?userId=${user?.userId}`));
      if (!res.ok) throw new Error('Failed to fetch requests');
      const requests = await res.json();
      setFriendRequests(requests);
      // Fetch sender details for each request
      if (requests.length > 0) {
        const fromIds = requests.map((r: any) => r.from).join(',');
        const detailsRes = await fetch(buildApiUrl(`/users?ids=${fromIds}`));
        if (detailsRes.ok) {
          const details = await detailsRes.json();
          // Map userId to name
          const detailsMap = {};
          details.forEach((u: any) => { detailsMap[u.userId] = u.name; });
          setFriendRequestDetails(detailsMap);
        } else {
          setFriendRequestDetails({});
        }
      } else {
        setFriendRequestDetails({});
      }
    } catch (err) {
      setFriendRequests([]);
      setFriendRequestDetails({});
    } finally {
      setLoadingRequests(false);
    }
  };

  // Accept friend request
  const acceptRequest = async (requestId: string) => {
    try {
      const res = await fetch(buildApiUrl('/friends/accept'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to accept request');
      fetchFriendRequests();
      fetchFriends();
      eventBus.emit('friendRequestsUpdated');
      Alert.alert('Friend Added', 'You are now friends!');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to accept request');
    }
  };

  // Reject friend request
  const rejectRequest = async (requestId: string) => {
    try {
      const res = await fetch(buildApiUrl('/friends/reject'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject request');
      fetchFriendRequests();
      eventBus.emit('friendRequestsUpdated');
      Alert.alert('Request Rejected', 'Friend request rejected.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to reject request');
    }
  };

  // Get friends list
  const fetchFriends = async () => {
    setLoadingFriends(true);
    try {
      const res = await fetch(buildApiUrl(`/friends/list?userId=${user?.userId}`));
      if (!res.ok) throw new Error('Failed to fetch friends');
      const friendsList = await res.json();
      setFriends(friendsList);
      // Fetch user details for each friend
      if (friendsList.length > 0) {
        const detailsRes = await fetch(`${API_URL}/users?ids=${friendsList.join(',')}`);
        if (detailsRes.ok) {
          const details = await detailsRes.json();
          setFriendDetails(details);
        } else {
          setFriendDetails([]);
        }
      } else {
        setFriendDetails([]);
      }
    } catch (err) {
      setFriends([]);
      setFriendDetails([]);
    } finally {
      setLoadingFriends(false);
    }
  };

  useEffect(() => {
    if (user?.userId) {
      fetchFriendRequests();
      fetchFriends();
    }
  }, [user?.userId]);

  const isAndroid = Platform.OS === 'android';

  return (
    <SNSafeAreaView style={styles.container} edges={isAndroid ? ['top'] : undefined}>
      <StatusBar barStyle="light-content" />
      <PulsatingBackground />
      <AnimatedSVGBackground />
      <LinearGradient
        colors={["#23272A", "#282828", "#26A7DE", "#fff0"]}
        style={styles.gradientOverlay}
        start={{ x: 0.1, y: 0.1 }}
        end={{ x: 0.9, y: 0.9 }}
      />
      <BlurView intensity={90} tint="dark" style={styles.fullGlassBlur}>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: true,
            headerStyle: {
              backgroundColor: 'transparent',
            },
            headerTintColor: '#fff',
            headerTitleStyle: {
              fontWeight: 'bold',
              color: '#fff',
              fontSize: 18,
            },
            headerBackTitle: '',
            headerBackVisible: false,
            headerLeft: () => (
              <TouchableOpacity
                onPress={() => router.back()}
                style={{ marginLeft: 16 }}
                activeOpacity={0.7}
                {...(isAndroid ? { android_ripple: { color: '#26A7DE', borderless: false } } : {})}
              >
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
            ),
            title: 'Friends',
          }}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.container}
          keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0}
        >
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.headerSection}>
              <Text style={styles.headerTitle}>Your Friends</Text>
              <Text style={styles.headerSubtitle}>
                Add friends to chat and share moments together.
              </Text>
            </View>
            {/* Search Bar */}
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color={THEME.gray} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search users..."
                placeholderTextColor={THEME.gray}
                value={search}
                onChangeText={text => {
                  setSearch(text);
                  if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                  if (text.trim().length > 0) {
                    searchDebounceRef.current = setTimeout(() => {
                      searchUsers(text);
                    }, 300);
                  } else {
                    setSearchResults([]);
                  }
                }}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
                returnKeyType="search"
              />
              {isSearching && <ActivityIndicator size="small" color={THEME.accentBlue} style={{ marginLeft: 8 }} />}
            </View>
            {/* Search Results */}
            {search.length > 0 && searchResults.length > 0 && (
              <View style={styles.sectionBox}>
                <Text style={styles.sectionTitle}>Search Results</Text>
                {searchResults.map((u) => (
                  <View key={u.userId} style={styles.userRow}>
                    <View style={[styles.avatar, { backgroundColor: getAvatarColor(u.userId) }]}>
                      <Text style={styles.avatarText}>{getInitials(u.name || '')}</Text>
                    </View>
                    <Text style={styles.userName}>{u.name}</Text>
                    <TouchableOpacity style={styles.addButton} onPress={() => sendFriendRequest(u.userId)} disabled={pendingRequests.includes(u.userId)}>
                      <Ionicons name="person-add" size={20} color="#fff" />
                      <Text style={styles.addButtonText}>Add Friend</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {/* Friend Requests */}
            <View style={styles.sectionBox}>
              <Text style={styles.sectionTitle}>Friend Requests</Text>
              {loadingRequests ? (
                <ActivityIndicator size="small" color={THEME.accentBlue} />
              ) : friendRequests.length === 0 ? (
                <Text style={styles.infoText}>No incoming friend requests.</Text>
              ) : friendRequests.map((req: any) => (
                <View key={req._id} style={styles.userRow}>
                  <Ionicons name="person" size={24} color={THEME.accentBlue} style={{ marginRight: 8 }} />
                  <Text style={styles.userName}>{friendRequestDetails[req.from] || req.from}</Text>
                  <TouchableOpacity style={styles.acceptButton} onPress={() => acceptRequest(req._id)}>
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rejectButton} onPress={() => rejectRequest(req._id)}>
                    <Ionicons name="close" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            {/* Friends List */}
            <View style={styles.sectionBox}>
              <Text style={styles.sectionTitle}>Friends List</Text>
              {loadingFriends ? (
                <ActivityIndicator size="small" color={THEME.accentBlue} />
              ) : friendDetails.length === 0 ? (
                <Text style={styles.infoText}>You have no friends yet.</Text>
              ) : friendDetails.map((friend) => (
                <View key={friend.userId} style={styles.userRow}>
                  <View style={[styles.avatar, { backgroundColor: getAvatarColor(friend.userId) }]}>
                    <Text style={styles.avatarText}>{getInitials(friend.name || '')}</Text>
                  </View>
                  <Text style={styles.userName}>{friend.name}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </BlurView>
    </SNSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.background,
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
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 24,
    paddingTop: Platform.OS === 'ios' ? 120 : 160,
  },
  headerSection: {
    marginBottom: 24,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: THEME.white,
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: THEME.gray,
    lineHeight: 22,
    textAlign: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
    width: '100%',
    maxWidth: 400,
  },
  searchInput: {
    flex: 1,
    height: 40,
    color: THEME.white,
    fontSize: 16,
    backgroundColor: 'transparent',
  },
  sectionBox: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: THEME.white,
    marginBottom: 10,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.accentBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  userName: {
    color: THEME.white,
    fontSize: 16,
    flex: 1,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.accentBlue,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 6,
  },
  acceptButton: {
    backgroundColor: '#26A7DE',
    borderRadius: 8,
    padding: 8,
    marginLeft: 8,
  },
  rejectButton: {
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    padding: 8,
    marginLeft: 8,
  },
  infoText: {
    color: THEME.gray,
    fontSize: 15,
    textAlign: 'center',
    marginVertical: 8,
  },
}); 