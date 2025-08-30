import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withTiming,
  useSharedValue,
  withDelay,
  Easing,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PARTICLE_COUNT = 80;

interface ParticleProps {
  initialX: number;
  initialY: number;
  size: number;
  duration: number;
  delay: number;
}

const Particle = ({ initialX, initialY, size, duration, delay }: ParticleProps) => {
  const translateX = useSharedValue(initialX);
  const translateY = useSharedValue(initialY);
  const opacity = useSharedValue(0.95);

  useEffect(() => {
    translateX.value = withRepeat(
      withDelay(
        delay,
        withTiming(
          Math.random() * SCREEN_WIDTH,
          { duration: duration, easing: Easing.linear }
        )
      ),
      -1,
      true
    );

    translateY.value = withRepeat(
      withDelay(
        delay,
        withTiming(
          Math.random() * SCREEN_HEIGHT,
          { duration: duration, easing: Easing.linear }
        )
      ),
      -1,
      true
    );

    opacity.value = withRepeat(
      withDelay(
        delay,
        withTiming(0.8, { duration: duration / 2 })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        animatedStyle,
      ]}
    />
  );
};

const ParticleBackground = () => {
  const particles = useRef<ParticleProps[]>([]).current;

  // Initialize particles
  useEffect(() => {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        initialX: Math.random() * SCREEN_WIDTH,
        initialY: Math.random() * SCREEN_HEIGHT,
        size: Math.random() * 14 + 8,
        duration: Math.random() * 15000 + 8000,
        delay: Math.random() * 1000,
      });
    }
  }, []);

  return (
    <View style={styles.container}>
      {particles.map((particle, index) => (
        <Particle key={index} {...particle} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    zIndex: 1,
    pointerEvents: 'none',
  },
  particle: {
    position: 'absolute',
    backgroundColor: 'rgba(125,219,255,0.25)',
    borderColor: 'rgba(120,120,120,0.45)',
    borderWidth: 1.5,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ParticleBackground; 