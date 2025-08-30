import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, SafeAreaView, ScrollView } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from './context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import UnreadMessagesPopup from './components/UnreadMessagesPopup';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';

const API_URL = Constants.expoConfig?.extra?.API_URL;
const HAS_SHOWN_UNREAD_POPUP_THIS_SESSION_KEY = 'hasShownUnreadPopupThisSession';

export default function HomePage() {
  const router = useRouter();
  const { logout, refreshAccessToken, user, accessToken } = useAuth();
  const [showUnreadPopup, setShowUnreadPopup] = useState(false);
  const [hasCheckedUnread, setHasCheckedUnread] = useState(false);
  const lastUnreadCount = useRef(0);
  const [hasShownUnreadPopupThisSession, setHasShownUnreadPopupThisSession] = useState(false);

  // Debug log on every render
  console.log('[Homepage] Component rendered:', {
    hasUser: !!user?.userId,
    hasAccessToken: !!accessToken,
    userEmail: user?.email,
    showUnreadPopup,
    hasCheckedUnread
  });

  // On mount, load the session flag from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem(HAS_SHOWN_UNREAD_POPUP_THIS_SESSION_KEY).then(val => {
      setHasShownUnreadPopupThisSession(val === 'true');
    });
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/login');
    } catch (error) {
      Alert.alert('Logout Error', 'Failed to logout');
    }
  };

  const checkAuthState = async () => {
    try {
      const [accessToken, refreshToken, userData] = await Promise.all([
        AsyncStorage.getItem('accessToken'),
        AsyncStorage.getItem('refreshToken'),
        AsyncStorage.getItem('user'),
      ]);
      
      Alert.alert(
        'Auth State',
        `Logged in as: ${user?.email}\nAccess Token: ${accessToken ? 'Valid' : 'Missing'}\nRefresh Token: ${refreshToken ? 'Valid' : 'Missing'}`
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to check auth state');
    }
  };

  const testTokenRefresh = async () => {
    try {
      await refreshAccessToken();
      Alert.alert('Success', 'Token refreshed successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to refresh token');
    }
  };

  // Manual trigger for unread check
  const manualCheckUnread = async () => {
    console.log('[Homepage] Manual unread check triggered');
    setHasCheckedUnread(false); // Reset the flag
    // Force a re-check
    const checkUnreadMessages = async () => {
      console.log('[Homepage] Manual check - Starting unread message check:', {
        hasUser: !!user?.userId,
        hasAccessToken: !!accessToken,
        userEmail: user?.email
      });
      
      if (!user?.userId || !accessToken) {
        console.log('[Homepage] Manual check - Early return:', {
          noUser: !user?.userId,
          noToken: !accessToken
        });
        return;
      }
      
      try {
        console.log('[Homepage] Manual check - Making API call...');
        const response = await fetch(`${API_URL}/group-chats/unread-count`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        console.log('[Homepage] Manual check - API response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('[Homepage] Manual check - API response data:', data);
          
          const unreadCount = data.totalUnread || 0;
          console.log('[Homepage] Manual check - Unread count:', unreadCount);
          
          if (unreadCount > 0) {
            console.log('[Homepage] Manual check - Setting popup to visible!');
            setShowUnreadPopup(true);
          } else {
            console.log('[Homepage] Manual check - No unread messages found');
          }
        } else {
          console.error('[Homepage] Manual check - API call failed:', response.status);
        }
      } catch (error) {
        console.error('[Homepage] Manual check - Error:', error);
      }
    };

    checkUnreadMessages();
  };

  // Check for unread messages when component mounts
  useEffect(() => {
    console.log('[Homepage] useEffect triggered:', {
      hasUser: !!user?.userId,
      hasAccessToken: !!accessToken,
      hasCheckedUnread,
      userEmail: user?.email
    });

    const checkUnreadMessages = async () => {
      console.log('[Homepage] Starting unread message check:', {
        hasUser: !!user?.userId,
        hasAccessToken: !!accessToken,
        hasCheckedUnread,
        userEmail: user?.email
      });
      
      if (!user?.userId || !accessToken || hasCheckedUnread) {
        console.log('[Homepage] Early return from unread check:', {
          noUser: !user?.userId,
          noToken: !accessToken,
          alreadyChecked: hasCheckedUnread
        });
        return;
      }
      
      try {
        console.log('[Homepage] Checking network connectivity...');
        const netInfo = await NetInfo.fetch();
        console.log('[Homepage] Network info:', {
          isConnected: netInfo.isConnected,
          type: netInfo.type
        });
        
        if (!netInfo.isConnected) {
          console.log('[Homepage] No internet connection, skipping unread check');
          return;
        }

        console.log('[Homepage] Making API call to check unread messages...');
        const response = await fetch(`${API_URL}/group-chats/unread-count`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        console.log('[Homepage] API response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('[Homepage] API response data:', data);
          
          const unreadCount = data.totalUnread || 0;
          console.log('[Homepage] Unread count:', unreadCount);
          
          if (unreadCount > 0 && !hasShownUnreadPopupThisSession) {
            console.log('[Homepage] Setting popup to visible - unread messages found!');
            setShowUnreadPopup(true);
            setHasShownUnreadPopupThisSession(true);
            AsyncStorage.setItem(HAS_SHOWN_UNREAD_POPUP_THIS_SESSION_KEY, 'true');
            lastUnreadCount.current = unreadCount;
          } else if (unreadCount === 0) {
            console.log('[Homepage] No unread messages found, resetting flag');
            setHasShownUnreadPopupThisSession(false);
            AsyncStorage.setItem(HAS_SHOWN_UNREAD_POPUP_THIS_SESSION_KEY, 'false');
            lastUnreadCount.current = 0;
          }
        } else {
          console.error('[Homepage] API call failed:', response.status, response.statusText);
          const errorText = await response.text();
          console.error('[Homepage] Error response body:', errorText);
        }
      } catch (error) {
        console.error('[Homepage] Error checking unread messages:', error);
      } finally {
        console.log('[Homepage] Marking unread check as complete');
        setHasCheckedUnread(true);
      }
    };

    checkUnreadMessages();
  }, [user, accessToken, hasCheckedUnread, hasShownUnreadPopupThisSession]);

  const handleCloseUnreadPopup = () => {
    setShowUnreadPopup(false);
    setHasShownUnreadPopupThisSession(true);
    AsyncStorage.setItem(HAS_SHOWN_UNREAD_POPUP_THIS_SESSION_KEY, 'true');
  };

  const handleViewSummaries = () => {
    setShowUnreadPopup(false);
    setHasShownUnreadPopupThisSession(true);
    AsyncStorage.setItem(HAS_SHOWN_UNREAD_POPUP_THIS_SESSION_KEY, 'true');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false} scrollEventThrottle={16}>
        <Stack.Screen 
          options={{ 
            headerShown: false,
            headerTransparent: true,
            headerStyle: {
              backgroundColor: 'transparent',
            },
            headerTintColor: 'transparent',
            headerTitleStyle: {
              fontWeight: 'bold',
              color: '#fff',
              fontSize: 18,
            },
            headerBackVisible: false,
            title: 'Home',
            animation: 'fade',
            animationDuration: 200,
            headerRight: () => (
              <TouchableOpacity onPress={() => router.push('./settings')} style={{ marginRight: 16 }}>
                <Ionicons name="settings-sharp" size={28} color="#fff" />
              </TouchableOpacity>
            ),
          }}
        />
        <View style={styles.mainContent}>
          <Text style={styles.title}>Welcome to ChitChat</Text>
          <Text style={styles.subtitle}>Logged in as: {user?.email}</Text>
          
          <TouchableOpacity 
            style={styles.button}
            onPress={() => router.push('/gcTestDatabase')}
          >
            <Ionicons name="chatbubbles" size={24} color="#282828" />
            <Text style={styles.buttonText}>GC Test Database</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.button}
            onPress={() => router.push('/post')}
          >
            <Ionicons name="create" size={24} color="#282828" />
            <Text style={styles.buttonText}>Create Post</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.button}
            onPress={() => router.push('/feed')}
          >
            <Ionicons name="newspaper" size={24} color="#282828" />
            <Text style={styles.buttonText}>View Feed</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.button}
            onPress={() => {
              console.log('[Homepage] Test button pressed, setting popup to visible');
              setShowUnreadPopup(true);
            }}
          >
            <Ionicons name="notifications" size={24} color="#282828" />
            <Text style={styles.buttonText}>Test Unread Popup</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Unread Messages Popup */}
      <UnreadMessagesPopup
        visible={showUnreadPopup}
        onClose={handleCloseUnreadPopup}
        onViewSummaries={handleViewSummaries}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#282828',
  },
  contentContainer: {
    flexGrow: 1,
  },
  mainContent: {
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 30,
  },
  button: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 10,
    width: '80%',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    color: '#282828',
    fontSize: 16,
    fontWeight: '600',
  },
}); 