import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';

const API_URL = Constants.expoConfig?.extra?.API_URL;

export function UnreadCheck() {
  const router = useRouter();
  const { user, accessToken, isLoading, isAuthenticated, refreshAccessToken } = useAuth();

  useEffect(() => {
    let didRetry = false;

    const checkInitialUnread = async () => {
      if (!user?.userId || !accessToken) return;

      try {
        const netInfo = await NetInfo.fetch();
        if (!netInfo.isConnected) {
          console.log('No internet connection, skipping unread check');
          return;
        }

        const fetchUnreadCount = async (token: string | null | undefined) => {
          if (!token) throw new Error('No access token available');
          const response = await fetch(`${API_URL}/group-chats/unread-count`, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (response.status === 401 && !didRetry) {
            didRetry = true;
            if (refreshAccessToken) {
              const refreshed = await refreshAccessToken();
              const newToken = typeof refreshed === 'string' && refreshed ? refreshed : accessToken;
              return fetchUnreadCount(newToken);
            } else {
              throw new Error('Invalid refresh token');
            }
          }

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          return response.json();
        };

        const data = await fetchUnreadCount(accessToken);
        if (data.totalUnread > 0) {
          // If unread messages are found, do nothing or just log for now
        }
      } catch (error) {
        console.error('Error checking initial unread messages:', error);
      }
    };

    checkInitialUnread();
    // Only depend on user and accessToken, not refreshAccessToken itself
  }, [user, accessToken]);

  return null; // This component doesn't render anything
} 