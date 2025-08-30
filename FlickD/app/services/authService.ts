import AsyncStorage from '@react-native-async-storage/async-storage';

export const getAuthToken = async (): Promise<string> => {
  const token = await AsyncStorage.getItem('accessToken');
  if (!token) {
    throw new Error('No authentication token found');
  }
  return token;
}; 