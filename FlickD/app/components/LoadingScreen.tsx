import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import LottieView from 'lottie-react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
  withSequence,
  useSharedValue,
  Easing,
  runOnJS,
  withDelay,
} from 'react-native-reanimated';
import { useLottiePreloader } from '../../utils/useLottiePreloader';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  secondary: '#23272A',
  primary: '#282828',
} as const;

interface LoadingScreenProps {
  message?: string;
  onAnimationComplete?: () => void;
}

export default function LoadingScreen({ 
  message = 'Loading...',
  onAnimationComplete
}: LoadingScreenProps) {
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  const textOpacity = useSharedValue(0);
  const gradientOpacity = useSharedValue(0.55);
  const blurOpacity = useSharedValue(1);

  const handleAnimationComplete = useCallback(() => {
    if (onAnimationComplete) {
      onAnimationComplete();
    }
  }, [onAnimationComplete]);

  const lottieSource = useLottiePreloader(require('../../assets/animations/loading.json'));

  useEffect(() => {
    let isMounted = true;

    const startAnimations = async () => {
      try {
        // Fade in text
        if (isMounted) {
          textOpacity.value = withTiming(1, {
            duration: 800,
            easing: Easing.out(Easing.ease),
          });
        }

        // Start exit animation after 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (!isMounted) return;

        // Fade out blur first
        blurOpacity.value = withTiming(0, {
          duration: 300,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
        });

        // Then fade out gradient
        gradientOpacity.value = withDelay(
          100,
          withTiming(0, {
            duration: 400,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
          })
        );

        // Finally fade out content
        opacity.value = withDelay(
          200,
          withTiming(0, {
            duration: 600,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
          }, (finished) => {
            if (finished && isMounted) {
              runOnJS(handleAnimationComplete)();
            }
          })
        );

        // Subtle scale animation
        scale.value = withSequence(
          withTiming(1.02, {
            duration: 300,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
          }),
          withTiming(1, {
            duration: 300,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
          })
        );
      } catch (error) {
        console.warn('Animation error:', error);
        if (isMounted) {
          runOnJS(handleAnimationComplete)();
        }
      }
    };

    startAnimations();

    return () => {
      isMounted = false;
    };
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
  }));

  const gradientStyle = useAnimatedStyle(() => ({
    opacity: gradientOpacity.value,
  }));

  const blurStyle = useAnimatedStyle(() => ({
    opacity: blurOpacity.value,
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <Animated.View style={[styles.gradientOverlay, gradientStyle]}>
        <LinearGradient
          colors={[THEME.secondary, THEME.primary, THEME.accentBlue, 'rgba(38, 167, 222, 0.1)']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.1, y: 0.1 }}
          end={{ x: 0.9, y: 0.9 }}
        />
      </Animated.View>
      
      <Animated.View style={[styles.blurOverlay, blurStyle]}>
        <BlurView intensity={20} style={StyleSheet.absoluteFill} />
      </Animated.View>
      
      <View style={styles.content}>
        <View style={styles.animationContainer}>
          <LottieView
            source={lottieSource}
            autoPlay
            loop
            style={[styles.animation, { opacity: 0.7 }]}
            resizeMode="contain"
          />
        </View>
        
        <Animated.Text style={[styles.loadingText, textStyle]}>
          {message}
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    alignItems: 'center',
    width: '80%',
  },
  animationContainer: {
    width: 200,
    height: 200,
    marginBottom: 20,
  },
  animation: {
    width: '100%',
    height: '100%',
  },
  loadingText: {
    color: THEME.white,
    fontSize: 18,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
}); 