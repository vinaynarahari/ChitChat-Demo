import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface AnimatedWaveformProps {
  size?: number;
  color?: string;
}

export default function AnimatedWaveform({ size = 24, color = '#fff' }: AnimatedWaveformProps) {
  const animationProgress = useSharedValue(0);
  
  // Base heights matching the exact reference image pattern
  const baseHeights = [0.4, 0.7, 1.0, 0.8, 0.5];

  useEffect(() => {
    // Medium tempo animation - 2 second cycles
    animationProgress.value = withRepeat(
      withTiming(1, {
        duration: 2000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );
  }, []);

  const createBarStyle = (index: number) =>
    useAnimatedStyle(() => {
      'worklet';
      
      // Create wave effect with different phase for each bar
      const phase = (index * Math.PI) / 4; // 45-degree phase shift between bars
      const waveValue = Math.sin((animationProgress.value * Math.PI * 2) + phase);
      
      // Subtle height variation around base height (±15%)
      const baseHeight = baseHeights[index];
      const variation = waveValue * 0.15;
      const finalHeight = Math.max(0.2, Math.min(1.0, baseHeight + variation));
      
      return {
        height: size * finalHeight,
        backgroundColor: color,
      };
    });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {baseHeights.map((_, index) => (
        <Animated.View
          key={index}
          style={[styles.bar, createBarStyle(index)]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 1,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
    minHeight: 6,
  },
}); 