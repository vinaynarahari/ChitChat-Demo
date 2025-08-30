import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface VMAnimationDisplayProps {
  frequencyData: Float32Array;
  isPlaying: boolean;
  size?: 'small' | 'medium' | 'large';
}

export const VMAnimationDisplay: React.FC<VMAnimationDisplayProps> = ({ 
  frequencyData, 
  isPlaying, 
  size = 'medium' 
}) => {
  const animatedValues = useRef<Animated.Value[]>(
    Array(64).fill(0).map(() => new Animated.Value(0.1))
  ).current;

  useEffect(() => {
    if (!isPlaying) {
      // Reset bars when paused with quick animation
      animatedValues.forEach((value: Animated.Value) => {
        Animated.spring(value, {
          toValue: 0.1,
          damping: 8,
          mass: 0.3,
          stiffness: 120,
          useNativeDriver: true,
        }).start();
      });
      return;
    }

    // Animate each bar based on frequency data
    frequencyData.forEach((value: number, idx: number) => {
      if (idx < animatedValues.length) {
        // Enhanced scaling for better visual response
        const scaledValue = Math.pow(value, 1.3); // Adjusted power for better visual range
        
        // Calculate target height with enhanced range
        const targetHeight = 0.1 + scaledValue * 1.6;
        
        Animated.spring(animatedValues[idx], {
          toValue: targetHeight,
          damping: 12,     // Reduced damping for more movement
          mass: 0.6,       // Adjusted mass for better responsiveness
          stiffness: 160,  // Adjusted stiffness for smoother motion
          useNativeDriver: true,
          restDisplacementThreshold: 0.001, // More precise animation
          restSpeedThreshold: 0.001,        // More precise animation
        }).start();
      }
    });
  }, [isPlaying, frequencyData]);

  const getContainerStyle = () => {
    switch (size) {
      case 'small':
        return styles.waveformContainerSmall;
      case 'large':
        return styles.waveformContainerLarge;
      default:
        return styles.waveformContainer;
    }
  };

  const getBarStyle = () => {
    switch (size) {
      case 'small':
        return styles.barSmall;
      case 'large':
        return styles.barLarge;
      default:
        return styles.bar;
    }
  };

  return (
    <View style={getContainerStyle()}>
      {animatedValues.map((animation, index) => (
        <Animated.View
          key={index}
          style={[
            getBarStyle(),
            {
              transform: [{ scaleY: animation }],
              opacity: animation.interpolate({
                inputRange: [0.1, 1.0],
                outputRange: [0.6, 1.0],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  waveformContainer: {
    width: SCREEN_WIDTH - 30,
    height: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    marginVertical: 12,
    marginLeft: -100,
  },
  waveformContainerSmall: {
    width: 60,
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  waveformContainerLarge: {
    width: 200,
    height: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  bar: {
    width: 4,
    height: 20,
    marginHorizontal: 1.5,
    backgroundColor: '#282828',
    borderRadius: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 2.0,
    elevation: 3,
  },
  barSmall: {
    width: 2,
    height: 12,
    marginHorizontal: 0.5,
    backgroundColor: '#26A7DE',
    borderRadius: 1,
  },
  barLarge: {
    width: 6,
    height: 30,
    marginHorizontal: 2,
    backgroundColor: '#26A7DE',
    borderRadius: 3,
    shadowColor: '#26A7DE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
}); 