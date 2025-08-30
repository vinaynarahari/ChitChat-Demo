import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolate } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

const WAVE_COUNT = 4;
const COLORS: [string, string][] = [
  ['#282828', '#282828'], // replaced purple with black
  ['#282828', '#26A7DE'], // replaced purple with black
  ['#2ED8C3', '#4FC3F7'], // teal to blue
  ['#fff', '#282828'],    // replaced purple with black
];

const GradientWave = ({ index }: { index: number }) => {
  const progress = useSharedValue(0);
  React.useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: 9000 + index * 2000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false
    );
  }, []);
  const animatedStyle = useAnimatedStyle(() => {
    const x = -width + progress.value * (width * 2);
    const y = -height + progress.value * (height * 2);
    // Fade in (0-0.2), stay (0.2-0.8), fade out (0.8-1)
    const opacity = interpolate(
      progress.value,
      [0, 0.12, 0.88, 1],
      [0, 0.38 - index * 0.06, 0.38 - index * 0.06, 0]
    );
    return {
      transform: [
        { translateX: x },
        { translateY: y },
      ],
      opacity,
    };
  });
  return (
    <Animated.View style={[styles.waveGroup, animatedStyle, { height }]}> 
      {/* Two waves side by side for seamless looping */}
      <LinearGradient
        colors={COLORS[index % COLORS.length]}
        start={{ x: 0.1, y: 0.9 }}
        end={{ x: 0.9, y: 0.1 }}
        style={styles.wave}
      />
      <LinearGradient
        colors={COLORS[index % COLORS.length]}
        start={{ x: 0.1, y: 0.9 }}
        end={{ x: 0.9, y: 0.1 }}
        style={styles.wave}
      />
    </Animated.View>
  );
};

const GradientWavesBackground = () => (
  <View style={styles.container} pointerEvents="none">
    {[...Array(WAVE_COUNT)].map((_, i) => (
      <GradientWave key={i} index={i} />
    ))}
  </View>
);

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
    pointerEvents: 'none',
  },
  waveGroup: {
    position: 'absolute',
    flexDirection: 'row',
    width: width * 1.7 * 2,
    left: -width * 0.5,
  },
  wave: {
    width: width * 1.7,
    borderRadius: 130,
  },
  gradient: {
    flex: 1,
    borderRadius: 90,
    opacity: 1,
  },
});

export default GradientWavesBackground; 