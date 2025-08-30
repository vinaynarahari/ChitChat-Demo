import '../reanimatedConfig.js';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, View } from 'react-native';
import { AuthProvider } from './context/AuthContext';
import { GroupChatProvider } from './context/GroupChatContext';
import { GestureProvider } from './context/GestureContext';
import { SettingsProvider } from './context/SettingsContext';
import { CaughtUpProvider } from './context/CaughtUpContext';
import { ScalableQueueProvider } from '../components/ScalableMessageQueueProvider';
import { UnreadCheck } from './components/UnreadCheck';
import LoadingScreen from './components/LoadingScreen';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useCallback } from 'react';
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
  Easing,
  runOnJS,
  withDelay,
} from 'react-native-reanimated';
import { useFonts } from 'expo-font';
import { useColorScheme } from 'react-native';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  primary: '#1E3A8A',
  transparent: 'transparent',
};

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [isLoadingComplete, setIsLoadingComplete] = useState(false);
  const colorScheme = useColorScheme();
  const contentOpacity = useSharedValue(0);
  const contentScale = useSharedValue(0.98);
  const backgroundOpacity = useSharedValue(0);

  const [fontsLoaded, fontError] = useFonts({
    'Inter-Bold': require('../assets/fonts/Inter-Bold.ttf'),
    'Inter-SemiBold': require('../assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Medium': require('../assets/fonts/Inter-Medium.ttf'),
    'Inter-Regular': require('../assets/fonts/Inter-Regular.ttf'),
  });

  const handleReady = useCallback(async () => {
    try {
      await SplashScreen.hideAsync();
      setIsReady(true);
    } catch (e) {
      console.warn('Error hiding splash screen:', e);
    }
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      handleReady();
    }
  }, [fontsLoaded, fontError, handleReady]);

  useEffect(() => {
    if (isReady) {
      // Start background fade in
      backgroundOpacity.value = withTiming(1, {
        duration: 800,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
      });

      // Start content animations with a delay
      contentOpacity.value = withDelay(
        300,
        withTiming(1, {
          duration: 800,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
        })
      );

      contentScale.value = withDelay(
        300,
        withTiming(1, {
          duration: 800,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
        })
      );
    }
  }, [isReady]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ scale: contentScale.value }],
  }));

  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: backgroundOpacity.value,
  }));

  if (!isReady) {
    return (
      <LoadingScreen
        message="Loading..."
        onAnimationComplete={() => setIsLoadingComplete(true)}
      />
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <Animated.View style={[styles.background, backgroundStyle]} />
      <Animated.View style={[styles.content, contentStyle]}>
        <AuthProvider>
          <GestureProvider>
            <GroupChatProvider>
              <CaughtUpProvider>
                <SettingsProvider>
                  <ScalableQueueProvider
                    config={{
                      enableBackToBackDetection: true,
                      enableInterruption: true,
                      enableMetrics: true,
                      maxConcurrentPerGroup: 2,
                      backToBackThreshold: 5000,
                      burstThreshold: 10000
                    }}
                  >
                    <Stack
                      screenOptions={{
                        headerShown: false,
                        contentStyle: {
                          backgroundColor: 'transparent',
                        },
                      }}
                    />
                    <UnreadCheck />
                  </ScalableQueueProvider>
                </SettingsProvider>
              </CaughtUpProvider>
            </GroupChatProvider>
          </GestureProvider>
        </AuthProvider>
      </Animated.View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: THEME.background,
  },
  content: {
    flex: 1,
  },
});
