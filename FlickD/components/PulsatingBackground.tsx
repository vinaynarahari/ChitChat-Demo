import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import LottieView from 'lottie-react-native';
import ParticleAnimation from '../constants/Animation - 1749327384504.json';
import { useLottiePreloader } from '../utils/useLottiePreloader';

const THEME = {
  accentBlue: '#26A7DE',
  purple: '#282828',
};

// Optimize animation configuration
const BALLS = [
  { color: THEME.accentBlue, delay: 0, xRadius: 40, yRadius: 20, phase: 0 },
  { color: THEME.purple, delay: 1200, xRadius: 60, yRadius: 40, phase: Math.PI / 2 },
];

const ANIMATION_DURATION = 15000;
const LOOKUP_POINTS = 30;

// Precompute sine/cosine lookup tables with fewer points
const getLookup = (radius: number, phase: number, fn: (x: number) => number) => {
  const arr = [];
  for (let i = 0; i <= LOOKUP_POINTS; i++) {
    const theta = (i / LOOKUP_POINTS) * 2 * Math.PI + phase;
    arr.push(radius * fn(theta));
  }
  return arr;
};

const PulsatingBackground = () => {
  const progress = useRef(BALLS.map(() => new Animated.Value(0))).current;
  const scales = useRef(BALLS.map(() => new Animated.Value(0.8))).current;
  const opacities = useRef(BALLS.map(() => new Animated.Value(0))).current;

  // Precompute lookup tables
  const xLookups = BALLS.map(ball => getLookup(ball.xRadius, ball.phase, Math.cos));
  const yLookups = BALLS.map(ball => getLookup(ball.yRadius, ball.phase, Math.sin));

  const lottieSource = useLottiePreloader(require('../constants/Animation - 1749327384504.json'));

  useEffect(() => {
    BALLS.forEach((ball, i) => {
      // Optimize scale animation
      const scaleAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(scales[i], {
            toValue: 1,
            duration: 3000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scales[i], {
            toValue: 0.8,
            duration: 3000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );

      // Optimize opacity animation
      const opacityAnim = Animated.timing(opacities[i], {
        toValue: 0.1,
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      });

      // Optimize movement animation
      const moveAnim = Animated.loop(
        Animated.timing(progress[i], {
          toValue: 1,
          duration: ANIMATION_DURATION,
          delay: ball.delay,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );

      scaleAnim.start();
      opacityAnim.start();
      moveAnim.start();
      progress[i].setValue(0);
    });
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      <LottieView
        source={lottieSource}
        autoPlay
        loop
        style={[StyleSheet.absoluteFill, { opacity: 0.3 }]}
        resizeMode="cover"
        speed={0.3}
      />
      {BALLS.map((ball, i) => {
        const inputRange = Array.from({ length: LOOKUP_POINTS + 1 }, (_, idx) => idx / LOOKUP_POINTS);
        const translateX = progress[i].interpolate({
          inputRange,
          outputRange: xLookups[i],
        });
        const translateY = progress[i].interpolate({
          inputRange,
          outputRange: yLookups[i],
        });
        return (
          <Animated.View
            key={i}
            style={[
              styles.pulsatingBall,
              {
                backgroundColor: ball.color,
                transform: [
                  { scale: scales[i] },
                  { translateX },
                  { translateY },
                ],
                opacity: opacities[i],
              },
            ]}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  pulsatingBall: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    top: '50%',
    left: '50%',
    marginLeft: -100,
    marginTop: -100,
  },
});

export default PulsatingBackground; 