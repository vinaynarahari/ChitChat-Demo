import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';

interface VoiceMessageWaveformProps {
  isPlaying: boolean;
  audioData?: Float32Array;
}

const NUM_BARS = 30;
const BAR_WIDTH = 3;
const BAR_SPACING = 4;
const MIN_HEIGHT = 2;
const MAX_HEIGHT = 40;

const VoiceMessageWaveform: React.FC<VoiceMessageWaveformProps> = ({ isPlaying, audioData }) => {
  const animatedValues = useRef(
    Array(NUM_BARS).fill(0).map(() => new Animated.Value(MIN_HEIGHT))
  ).current;

  useEffect(() => {
    if (!isPlaying) {
      // When not playing, animate to a subtle idle state
      animatedValues.forEach((value, index) => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(value, {
              toValue: MIN_HEIGHT + Math.random() * 10,
              duration: 1000 + Math.random() * 1000,
              useNativeDriver: false,
            }),
            Animated.timing(value, {
              toValue: MIN_HEIGHT,
              duration: 1000 + Math.random() * 1000,
              useNativeDriver: false,
            }),
          ])
        ).start();
      });
    } else if (audioData) {
      // When playing, animate based on audio data
      const updateBars = () => {
        animatedValues.forEach((value, index) => {
          const dataIndex = Math.floor((index / NUM_BARS) * audioData.length);
          const amplitude = audioData[dataIndex] || 0;
          const targetHeight = MIN_HEIGHT + (amplitude * (MAX_HEIGHT - MIN_HEIGHT));
          
          Animated.spring(value, {
            toValue: targetHeight,
            damping: 8,
            mass: 0.5,
            stiffness: 100,
            useNativeDriver: false,
          }).start();
        });
      };

      const interval = setInterval(updateBars, 50);
      return () => clearInterval(interval);
    }
  }, [isPlaying, audioData]);

  return (
    <View style={styles.container}>
      {animatedValues.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              height: value,
              backgroundColor: isPlaying ? '#26A7DE' : 'rgba(38, 167, 222, 0.3)',
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: MAX_HEIGHT,
    paddingHorizontal: 20,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
    marginHorizontal: BAR_SPACING / 2,
  },
});

export default VoiceMessageWaveform; 