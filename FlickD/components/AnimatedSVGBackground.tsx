import React from 'react';
import { StyleSheet, Dimensions } from 'react-native';
import Svg, { Ellipse, Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import Animated, { 
  useSharedValue, 
  useAnimatedProps, 
  withRepeat, 
  withTiming, 
  Easing,
  withSequence,
  withDelay
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function AnimatedSVGBackground() {
  // Optimize animations with fewer animated elements and simpler paths
  const y1 = useSharedValue(height * 0.2);
  const y2 = useSharedValue(height * 0.7);
  const xCircle = useSharedValue(width * 0.8);

  React.useEffect(() => {
    // Optimize animation timing and easing
    y1.value = withRepeat(
      withSequence(
        withTiming(height * 0.25, { 
          duration: 8000, 
          easing: Easing.inOut(Easing.ease) 
        }),
        withTiming(height * 0.2, { 
          duration: 8000, 
          easing: Easing.inOut(Easing.ease) 
        })
      ),
      -1,
      true
    );

    y2.value = withRepeat(
      withSequence(
        withTiming(height * 0.65, { 
          duration: 10000, 
          easing: Easing.inOut(Easing.ease) 
        }),
        withTiming(height * 0.7, { 
          duration: 10000, 
          easing: Easing.inOut(Easing.ease) 
        })
      ),
      -1,
      true
    );

    xCircle.value = withRepeat(
      withSequence(
        withTiming(width * 0.2, { 
          duration: 12000, 
          easing: Easing.inOut(Easing.ease) 
        }),
        withTiming(width * 0.8, { 
          duration: 12000, 
          easing: Easing.inOut(Easing.ease) 
        })
      ),
      -1,
      true
    );
  }, []);

  const animatedProps1 = useAnimatedProps(() => ({
    cy: y1.value,
  }));
  
  const animatedProps2 = useAnimatedProps(() => ({
    cy: y2.value,
  }));
  
  const animatedCircleProps = useAnimatedProps(() => ({
    cx: xCircle.value,
  }));

  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
      <Defs>
        <RadialGradient id="grad1" cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor="#26A7DE" stopOpacity="0.1" />
          <Stop offset="100%" stopColor="#23272A" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="grad2" cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor="#282828" stopOpacity="0.08" />
          <Stop offset="100%" stopColor="#23272A" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="grad3" cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor="#fff" stopOpacity="0.05" />
          <Stop offset="100%" stopColor="#26A7DE" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {/* Optimized floating elements with reduced opacity */}
      <AnimatedEllipse
        cx={width * 0.3}
        rx={80}
        ry={50}
        animatedProps={animatedProps1}
        fill="url(#grad1)"
      />
      <AnimatedEllipse
        cx={width * 0.7}
        rx={60}
        ry={40}
        animatedProps={animatedProps2}
        fill="url(#grad2)"
      />
      <AnimatedCircle
        cy={height * 0.15}
        r={30}
        animatedProps={animatedCircleProps}
        fill="url(#grad3)"
        opacity={0.1}
      />
    </Svg>
  );
} 