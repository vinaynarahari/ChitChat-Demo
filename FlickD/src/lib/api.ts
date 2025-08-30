import 'react-native-get-random-values';
import Constants from 'expo-constants';

const API_URL = Constants.expoConfig?.extra?.API_URL;

// Example API functions
export const createUser = async (userData: { email: string; name: string }) => {
  try {
    const response = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(userData),
    });
    
    if (!response.ok) {
      throw new Error('Failed to create user');
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('Error creating user:', error);
    throw error;
  }
};

export const getUserByEmail = async (email: string) => {
  try {
    const response = await fetch(`${API_URL}/users?email=${email}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch user');
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('Error finding user:', error);
    throw error;
  }
};

export const getAllUsers = async () => {
  try {
    const response = await fetch(`${API_URL}/users`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch users');
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('Error getting users:', error);
    throw error;
  }
}; 