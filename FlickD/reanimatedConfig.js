import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from 'react-native-reanimated';

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,  // Disable strict mode
});

// Enable worklet optimization for better performance
// Production-optimized configuration 