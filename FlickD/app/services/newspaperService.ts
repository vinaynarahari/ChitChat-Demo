import { API_URL } from '../config';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface NewspaperSummary {
  id: string;
  headline: string;
  summary: string;
  media: { type: string; uri: string; senderName?: string }[];
  timestamp: string;
  group: string;
  groupName: string;
  groupIcon?: string;
  messageCount: number;
}

const getAuthToken = async (): Promise<string> => {
  const token = await AsyncStorage.getItem('accessToken');
  if (!token) {
    throw new Error('No authentication token found');
  }
  return token;
};

export const getGroupNewspaper = async (groupId: string): Promise<NewspaperSummary> => {
  try {
    const token = await getAuthToken();
    const response = await fetch(`${API_URL}/newspaper/${groupId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to fetch newspaper summary');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching newspaper summary:', error);
    throw error;
  }
};

export const getUserNewspapers = async (userId: string): Promise<NewspaperSummary[]> => {
  try {
    const token = await getAuthToken();
    
    const response = await fetch(`${API_URL}/newspaper/user/${userId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Error response:', errorData);
      throw new Error(errorData.message || 'Failed to fetch user newspapers');
    }

    const data = await response.json();
    
    // Ensure we return an array
    if (!Array.isArray(data)) {
      console.warn('Received non-array data:', data);
      return [];
    }
    
    return data;
  } catch (error) {
    
    throw error;
  }
};

export const uploadGroupMedia = async (groupId: string, url: string, type: 'image' | 'video') => {
  const token = await getAuthToken();
  const response = await fetch(`${API_URL}/group-chat/${groupId}/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, type }),
  });
  if (!response.ok) {
    throw new Error('Failed to upload media');
  }
  return await response.json();
}; 