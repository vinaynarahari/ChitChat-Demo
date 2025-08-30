import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SettingsContextType {
  autoRecordingEnabled: boolean;
  toggleAutoRecording: () => void;
  setAutoRecordingEnabled: (enabled: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

interface SettingsProviderProps {
  children: React.ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  const [autoRecordingEnabled, setAutoRecordingEnabled] = useState(true); // Default to enabled

  // Load settings from AsyncStorage on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await AsyncStorage.getItem('userSettings');
        if (settings) {
          const parsedSettings = JSON.parse(settings);
          const newValue = parsedSettings.autoRecordingEnabled ?? true;
          setAutoRecordingEnabled(newValue);
        }
      } catch (error) {
        console.error('Error loading settings:', error);
        // Keep default value if loading fails
      }
    };

    loadSettings();
  }, []);

  // Save settings to AsyncStorage whenever they change
  const saveSettings = async (newAutoRecordingEnabled: boolean) => {
    try {
      const settings = {
        autoRecordingEnabled: newAutoRecordingEnabled,
      };
      await AsyncStorage.setItem('userSettings', JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  const toggleAutoRecording = () => {
    const newValue = !autoRecordingEnabled;
    setAutoRecordingEnabled(newValue);
    saveSettings(newValue);
  };

  const setAutoRecordingEnabledValue = (enabled: boolean) => {
    setAutoRecordingEnabled(enabled);
    saveSettings(enabled);
  };

  const value: SettingsContextType = {
    autoRecordingEnabled,
    toggleAutoRecording,
    setAutoRecordingEnabled: setAutoRecordingEnabledValue,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}; 