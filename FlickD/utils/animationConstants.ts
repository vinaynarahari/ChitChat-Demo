import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Animation timing constants - optimized for smooth performance
export const ANIMATION_DURATION = {
  FAST: 150,      // Reduced for snappier feel
  NORMAL: 250,    // Reduced for better responsiveness
  SLOW: 400,      // Reduced for modern feel
  VERY_FAST: 100, // For micro-interactions
};

// Spring animation configurations - optimized for 60fps performance
export const SPRING_CONFIG = {
  LIGHT: {
    damping: 12,     // Reduced for more lively animations
    stiffness: 200,  // Increased for snappier response
    mass: 0.6,       // Reduced for faster animations
  },
  MEDIUM: {
    damping: 15,     // Balanced for smooth feel
    stiffness: 250,  // Increased for better response
    mass: 0.7,       // Optimized for medium interactions
  },
  HEAVY: {
    damping: 18,     // Slightly reduced for less damping
    stiffness: 300,  // High stiffness for immediate response
    mass: 0.8,       // Balanced mass
  },
  BOUNCE: {
    damping: 8,      // Low damping for bouncy feel
    stiffness: 150,  // Moderate stiffness
    mass: 1.0,       // Higher mass for bounce effect
  },
  // New configurations for specific use cases
  TYPEWRITER: {
    damping: 20,
    stiffness: 400,
    mass: 0.5,
  },
  READ_RECEIPTS: {
    damping: 14,
    stiffness: 300,
    mass: 0.6,
  },
  TRANSCRIPTION: {
    damping: 16,
    stiffness: 280,
    mass: 0.7,
  },
};

// Gesture thresholds
export const GESTURE_THRESHOLDS = {
  DISMISS_DISTANCE: SCREEN_HEIGHT * 0.25,
  DISMISS_VELOCITY: 800,
  SCALE_THRESHOLD: SCREEN_HEIGHT * 0.3,
  OPACITY_THRESHOLD: SCREEN_HEIGHT * 0.5,
};

// Screen dimensions
export const SCREEN = {
  WIDTH: SCREEN_WIDTH,
  HEIGHT: SCREEN_HEIGHT,
};

// Animation easing functions - optimized curves
export const EASING = {
  EASE_IN_OUT: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  EASE_OUT: (t: number) => 1 - Math.pow(1 - t, 3),
  EASE_IN: (t: number) => t * t * t,
  SMOOTH: (t: number) => t * t * (3 - 2 * t), // Smoother cubic bezier-like curve
  BOUNCE: (t: number) => {
    if (t < 1 / 2.75) {
      return 7.5625 * t * t;
    } else if (t < 2 / 2.75) {
      return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    } else if (t < 2.5 / 2.75) {
      return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    } else {
      return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    }
  },
};

// Common animation values
export const ANIMATION_VALUES = {
  SCALE: {
    NORMAL: 1,
    PRESSED: 0.95,
    HOVER: 1.05,
    MINI: 0.9,        // For subtle scale downs
    MICRO: 0.98,      // For micro-interactions
  },
  OPACITY: {
    VISIBLE: 1,
    HIDDEN: 0,
    DISABLED: 0.5,
    FADED: 0.7,       // For secondary elements
    SUBTLE: 0.85,     // For subtle transparency
  },
  TRANSLATE: {
    HIDDEN: SCREEN_HEIGHT,
    VISIBLE: 0,
    OFFSET_SMALL: 20,  // For small slide animations
    OFFSET_MEDIUM: 50, // For medium slide animations
  },
  ROTATE: {
    NONE: '0deg',
    QUARTER: '90deg',
    HALF: '180deg',
    FULL: '360deg',
  },
};

// Performance optimization constants
export const PERFORMANCE = {
  // Reduce animation frequency on lower-end devices
  REDUCED_MOTION_FACTOR: 0.7,
  // Frame rate targets
  TARGET_FPS: 60,
  // Animation batch sizes for staggered animations
  STAGGER_BATCH_SIZE: 5,
  // Delays for staggered animations (in ms)
  STAGGER_DELAY: 50,
}; 