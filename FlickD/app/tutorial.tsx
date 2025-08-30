import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, SafeAreaView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import AnimatedSVGBackground from '../components/AnimatedSVGBackground';
import PulsatingBackground from '../components/PulsatingBackground';
import { Stack } from 'expo-router';
import { PanGestureHandler, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolate,
  useAnimatedGestureHandler,
  runOnJS,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Image } from 'expo-image';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  primary: '#282828',
  gray: '#666666',
  lightGray: '#EEEEEE'
};

// Tutorial images from the tut folder
const TUTORIAL_IMAGES = [
  require('../assets/tut/0.png'),
  require('../assets/tut/s1.png'),
  require('../assets/tut/s3.png'),
  require('../assets/tut/s4.png'),
  require('../assets/tut/s5.png'),
  require('../assets/tut/s6.png'),
  require('../assets/tut/s8.png'),
  require('../assets/tut/s9.png'),
  require('../assets/tut/s10.png'),
  require('../assets/tut/s11.png'),
  require('../assets/tut/s12.png'),
];

const TUTORIAL_TITLES = [
  'Welcome to ChitChat',
  'Getting Started',
  'Voice Messages',
  'Recording Tips',
  'Group Chats',
  'Eavesdrop Mode',
  'Transcriptions',
  'Privacy Features',
  'Advanced Features',
  'Troubleshooting',
  'You\'re All Set!'
];

const TUTORIAL_DESCRIPTIONS = [
  'Your voice-first social platform',
  'Learn the basics of using ChitChat',
  'Record and send voice messages easily',
  'Get the best audio quality',
  'Create and manage group conversations',
  'Listen without joining conversations',
  'Read your voice messages',
  'Your data is secure with us',
  'Discover powerful features',
  'Common solutions to issues',
  'Ready to start your journey!'
];

export default function TutorialPage() {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const translateX = useSharedValue(0);
  const isGestureActive = useSharedValue(false);

  const updateCurrentIndex = (index: number) => {
    setCurrentIndex(index);
  };

  const gestureHandler = useAnimatedGestureHandler({
    onStart: () => {
      isGestureActive.value = true;
    },
    onActive: (event) => {
      translateX.value = event.translationX;
    },
    onEnd: (event) => {
      isGestureActive.value = false;
      const shouldSwipe = Math.abs(event.velocityX) > 250;
      const targetIndex = shouldSwipe
        ? event.velocityX > 0
          ? Math.max(0, currentIndex - 1)
          : Math.min(TUTORIAL_IMAGES.length - 1, currentIndex + 1)
        : Math.round(-translateX.value / SCREEN_WIDTH);

      const finalIndex = Math.max(0, Math.min(TUTORIAL_IMAGES.length - 1, targetIndex));
      
      translateX.value = withSpring(0, {
        damping: 15,
        mass: 0.2,
        stiffness: 200,
        overshootClamping: true,
        restDisplacementThreshold: 0.001,
        restSpeedThreshold: 0.001,
      });
      
      runOnJS(updateCurrentIndex)(finalIndex);
    },
  });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
    };
  });

  const handleNext = () => {
    if (currentIndex < TUTORIAL_IMAGES.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      router.back();
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else {
      router.back();
    }
  };

  const handleSkip = () => {
    router.back();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
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
              >
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
            ),
            headerRight: () => (
              <TouchableOpacity 
                onPress={handleSkip}
                style={{ marginRight: 16 }}
              >
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            ),
            title: 'Tutorial',
          }}
        />
        
        <GestureHandlerRootView style={styles.gestureContainer}>
          <PanGestureHandler onGestureEvent={gestureHandler}>
            <Animated.View style={[styles.slideContainer, animatedStyle]}>
              <View style={styles.imageContainer}>
                <Image
                  source={TUTORIAL_IMAGES[currentIndex]}
                  style={styles.tutorialImage}
                  contentFit="contain"
                  transition={200}
                />
              </View>
              
              <View style={styles.contentContainer}>
                <BlurView intensity={40} tint="dark" style={styles.contentBlur}>
                  <LinearGradient
                    colors={['rgba(255, 255, 255, 0.1)', 'rgba(255, 255, 255, 0.05)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.contentGradient}
                  >
                    <Text style={styles.title}>{TUTORIAL_TITLES[currentIndex]}</Text>
                    <Text style={styles.description}>{TUTORIAL_DESCRIPTIONS[currentIndex]}</Text>
                  </LinearGradient>
                </BlurView>
              </View>
            </Animated.View>
          </PanGestureHandler>
        </GestureHandlerRootView>

        {/* Progress Indicators */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            {TUTORIAL_IMAGES.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.progressDot,
                  index === currentIndex && styles.progressDotActive
                ]}
              />
            ))}
          </View>
        </View>

        {/* Navigation Buttons */}
        <View style={styles.navigationContainer}>
          <TouchableOpacity
            style={[styles.navButton, styles.prevButton]}
            onPress={handlePrevious}
          >
            <BlurView intensity={40} tint="dark" style={styles.navButtonBlur}>
              <LinearGradient
                colors={['rgba(255, 255, 255, 0.1)', 'rgba(255, 255, 255, 0.05)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.navButtonGradient}
              >
                <Ionicons name="chevron-back" size={24} color={THEME.white} />
              </LinearGradient>
            </BlurView>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navButton, styles.nextButton]}
            onPress={handleNext}
          >
            <BlurView intensity={40} tint="dark" style={styles.navButtonBlur}>
              <LinearGradient
                colors={['rgba(38, 167, 222, 0.3)', 'rgba(38, 167, 222, 0.1)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.navButtonGradient}
              >
                <Ionicons 
                  name={currentIndex === TUTORIAL_IMAGES.length - 1 ? "checkmark" : "chevron-forward"} 
                  size={24} 
                  color={THEME.white} 
                />
              </LinearGradient>
            </BlurView>
          </TouchableOpacity>
        </View>
      </BlurView>
    </SafeAreaView>
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
  skipText: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: '500',
  },
  gestureContainer: {
    flex: 1,
  },
  slideContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    maxHeight: SCREEN_HEIGHT * 0.6,
  },
  tutorialImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  contentContainer: {
    width: '100%',
    marginTop: 20,
    marginBottom: 20,
  },
  contentBlur: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  contentGradient: {
    padding: 20,
    borderRadius: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: THEME.white,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 16,
    color: THEME.gray,
    textAlign: 'center',
    lineHeight: 22,
  },
  progressContainer: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  progressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  progressDotActive: {
    backgroundColor: THEME.accentBlue,
    width: 24,
  },
  navigationContainer: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
  },
  prevButton: {
    opacity: 0.7,
  },
  nextButton: {
    opacity: 1,
  },
  navButtonBlur: {
    borderRadius: 30,
    overflow: 'hidden',
  },
  navButtonGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 30,
  },
}); 