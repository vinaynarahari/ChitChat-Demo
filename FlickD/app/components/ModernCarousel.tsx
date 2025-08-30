import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  useAnimatedGestureHandler,
} from 'react-native-reanimated';
import { PanGestureHandler, PanGestureHandlerGestureEvent } from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.22;

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  primary: '#282828',
  secondary: '#23272A',
};

interface ModernCarouselProps<T> {
  cards: T[];
  renderCard: (item: T, index: number) => React.ReactNode;
  onSwipe: (cardIndex: number, direction: 'left' | 'right') => void;
}

type ContextType = { startX: number; startY: number };

function ModernCarouselTopCard<T>({
  item,
  index,
  onSwipe,
  renderCard,
  isActive,
}: {
  item: T;
  index: number;
  onSwipe: (direction: 'left' | 'right') => void;
  renderCard: (item: T, index: number) => React.ReactNode;
  isActive: boolean;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotateZ = useSharedValue(0);

  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent, ContextType>({
    onStart: (_, ctx) => {
      ctx.startX = translateX.value;
      ctx.startY = translateY.value;
    },
    onActive: (event, ctx) => {
      translateX.value = ctx.startX + event.translationX;
      translateY.value = ctx.startY + event.translationY;
      rotateZ.value = translateX.value / 18;
    },
    onEnd: () => {
      if (translateX.value > SWIPE_THRESHOLD) {
        translateX.value = withTiming(SCREEN_WIDTH * 1.2, { duration: 200 }, (finished) => {
          if (finished) runOnJS(onSwipe)('right');
        });
        translateY.value = withTiming(40, { duration: 200 });
        rotateZ.value = withTiming(12, { duration: 200 });
      } else if (translateX.value < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(-SCREEN_WIDTH * 1.2, { duration: 200 }, (finished) => {
          if (finished) runOnJS(onSwipe)('left');
        });
        translateY.value = withTiming(40, { duration: 200 });
        rotateZ.value = withTiming(-12, { duration: 200 });
      } else {
        translateX.value = withSpring(0, { damping: 18, stiffness: 180 });
        translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
        rotateZ.value = withSpring(0, { damping: 18, stiffness: 180 });
      }
    },
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotateZ: `${rotateZ.value}deg` },
      { scale: 1 },
    ],
    zIndex: 2,
    shadowColor: THEME.accentBlue,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 12,
  }));

  if (!isActive) return null;
  return (
    <PanGestureHandler onGestureEvent={gestureHandler} enabled={isActive}>
      <Animated.View style={[styles.card, animatedStyle]}>
        {renderCard(item, index)}
      </Animated.View>
    </PanGestureHandler>
  );
}

function ModernCarouselNextCard<T>({
  item,
  index,
  topTranslateX,
  renderCard,
}: {
  item: T;
  index: number;
  topTranslateX: Animated.SharedValue<number>;
  renderCard: (item: T, index: number) => React.ReactNode;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    // Subtle parallax and scale for next card
    const scale = 0.97 + Math.min(Math.abs(topTranslateX.value) / 400, 0.03);
    const opacity = 0.85 + Math.min(Math.abs(topTranslateX.value) / 400, 0.15);
    return {
      transform: [
        { scale },
        { translateY: 12 - Math.abs(topTranslateX.value) / 18 },
      ],
      opacity,
      zIndex: 1,
      shadowColor: THEME.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.10,
      shadowRadius: 10,
      elevation: 8,
    };
  });
  return (
    <Animated.View style={[styles.card, animatedStyle]}>
      {renderCard(item, index)}
    </Animated.View>
  );
}

export function ModernCarousel<T>({ cards, renderCard, onSwipe }: ModernCarouselProps<T>) {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const topTranslateX = useSharedValue(0);

  const handleSwipe = (direction: 'left' | 'right') => {
    setCurrentIndex((prev) => prev + 1);
    topTranslateX.value = 0;
    onSwipe(currentIndex, direction);
  };

  const topCard = cards[currentIndex];
  const nextCard = cards[currentIndex + 1];

  return (
    <View style={styles.container} pointerEvents="box-none">
      {nextCard && (
        <ModernCarouselNextCard
          item={nextCard}
          index={currentIndex + 1}
          topTranslateX={topTranslateX}
          renderCard={renderCard}
        />
      )}
      {topCard && (
        <ModernCarouselTopCard
          item={topCard}
          index={currentIndex}
          onSwipe={handleSwipe}
          renderCard={renderCard}
          isActive={true}
        />
      )}
    </View>
  );
}

const CARD_WIDTH = SCREEN_WIDTH * 0.88;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.62;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 22,
    backgroundColor: THEME.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 12,
    borderWidth: 0, // No glass, no border
    overflow: 'hidden',
  },
}); 