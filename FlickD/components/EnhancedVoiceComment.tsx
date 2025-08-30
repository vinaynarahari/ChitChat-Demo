import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface EnhancedVoiceCommentProps {
  isPlaying: boolean;
  duration: number;
  onPlayPause: () => void;
  showWaveform?: boolean;
}

const NUM_BARS = 20;
const BAR_WIDTH = 2;
const BAR_SPACING = 2;
const MIN_HEIGHT = 3;
const MAX_HEIGHT = 24;

const EnhancedVoiceComment: React.FC<EnhancedVoiceCommentProps> = ({ 
  isPlaying, 
  duration, 
  onPlayPause,
  showWaveform = true 
}) => {
  const animatedValues = useRef(
    Array(NUM_BARS).fill(0).map(() => new Animated.Value(MIN_HEIGHT))
  ).current;
  
  const pulseAnimation = useRef(new Animated.Value(1)).current;
  const glowAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isPlaying) {
      // Start waveform animation
      animatedValues.forEach((value, index) => {
        const delay = index * 50;
        Animated.loop(
          Animated.sequence([
            Animated.timing(value, {
              toValue: MIN_HEIGHT + Math.random() * (MAX_HEIGHT - MIN_HEIGHT),
              duration: 300 + Math.random() * 200,
              useNativeDriver: false,
            }),
            Animated.timing(value, {
              toValue: MIN_HEIGHT + Math.random() * (MAX_HEIGHT - MIN_HEIGHT) * 0.7,
              duration: 200 + Math.random() * 150,
              useNativeDriver: false,
            }),
          ])
        ).start();
      });

      // Start pulse animation for play button
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnimation, {
            toValue: 1.1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnimation, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Start glow animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnimation, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: false,
          }),
          Animated.timing(glowAnimation, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: false,
          }),
        ])
      ).start();
    } else {
      // Stop animations and reset to idle state
      animatedValues.forEach((value) => {
        value.stopAnimation();
        Animated.timing(value, {
          toValue: MIN_HEIGHT + Math.random() * 4,
          duration: 300,
          useNativeDriver: false,
        }).start();
      });

      pulseAnimation.stopAnimation();
      Animated.timing(pulseAnimation, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      glowAnimation.stopAnimation();
      Animated.timing(glowAnimation, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  }, [isPlaying]);

  const glowStyle = {
    shadowColor: '#26A7DE',
    shadowOpacity: glowAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0.2, 0.6],
    }),
    shadowRadius: glowAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [4, 12],
    }),
    elevation: glowAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [2, 8],
    }),
  };

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.playButtonContainer, glowStyle]}>
        <TouchableOpacity
          style={styles.playButton}
          onPress={onPlayPause}
          activeOpacity={0.8}
        >
          <Animated.View style={{ transform: [{ scale: pulseAnimation }] }}>
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={20}
              color="#fff"
            />
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>

      {showWaveform && (
        <View style={styles.waveformContainer}>
          {animatedValues.map((value, index) => (
            <Animated.View
              key={index}
              style={[
                styles.bar,
                {
                  height: value,
                  backgroundColor: isPlaying 
                    ? `rgba(38, 167, 222, ${0.8 - (index % 3) * 0.1})` 
                    : 'rgba(38, 167, 222, 0.3)',
                },
              ]}
            />
          ))}
        </View>
      )}

      <View style={styles.durationContainer}>
        <Text style={styles.durationText}>
          {Math.round(duration)}s
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(38, 167, 222, 0.12)',
    borderRadius: 20,
    padding: 12,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(38, 167, 222, 0.2)',
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  playButtonContainer: {
    marginRight: 12,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#26A7DE',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  waveformContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: MAX_HEIGHT + 4,
    marginHorizontal: 8,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
    marginHorizontal: BAR_SPACING / 2,
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 1,
  },
  durationContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  durationText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

export default EnhancedVoiceComment; 