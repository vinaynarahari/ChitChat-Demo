import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, useAnimatedGestureHandler } from 'react-native-reanimated';
import { PanGestureHandler, PanGestureHandlerGestureEvent } from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;

interface AnimatedCardStackProps<T> {
  cards: T[];
  renderCard: (item: T, index: number) => React.ReactNode;
  onSwipe: (cardIndex: number, direction: 'left' | 'right') => void;
}

type ContextType = {
  startX: number;
  startY: number;
};

function CardStackTopCard<T>({
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
      rotateZ.value = translateX.value / 20;
    },
    onEnd: (event) => {
      if (translateX.value > SWIPE_THRESHOLD) {
        // Swipe right
        translateX.value = withTiming(SCREEN_WIDTH * 1.2, { duration: 250 }, (finished) => {
          if (finished) runOnJS(onSwipe)('right');
        });
        translateY.value = withTiming(40, { duration: 250 });
        rotateZ.value = withTiming(15, { duration: 250 });
      } else if (translateX.value < -SWIPE_THRESHOLD) {
        // Swipe left
        translateX.value = withTiming(-SCREEN_WIDTH * 1.2, { duration: 250 }, (finished) => {
          if (finished) runOnJS(onSwipe)('left');
        });
        translateY.value = withTiming(40, { duration: 250 });
        rotateZ.value = withTiming(-15, { duration: 250 });
      } else {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        rotateZ.value = withSpring(0);
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

function CardStackNextCard<T>({
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
    const scale = 0.96 + Math.min(Math.abs(topTranslateX.value) / 400, 0.04);
    const opacity = 0.8 + Math.min(Math.abs(topTranslateX.value) / 400, 0.2);
    return {
      transform: [
        { scale },
        { translateY: 10 - Math.abs(topTranslateX.value) / 20 },
      ],
      opacity,
      zIndex: 1,
    };
  });
  return (
    <Animated.View style={[styles.card, animatedStyle]}>
      {renderCard(item, index)}
    </Animated.View>
  );
}

export function AnimatedCardStack<T>({ cards, renderCard, onSwipe }: AnimatedCardStackProps<T>) {
  // Only two cards are rendered at a time: top and next
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const topTranslateX = useSharedValue(0); // For next card animation

  const handleSwipe = (direction: 'left' | 'right') => {
    setCurrentIndex((prev) => prev + 1);
    topTranslateX.value = 0;
    // Call parent handler
    onSwipe(currentIndex, direction);
  };

  // Render top card with gesture
  const topCard = cards[currentIndex];
  const nextCard = cards[currentIndex + 1];

  return (
    <View style={styles.container} pointerEvents="box-none">
      {nextCard && (
        <CardStackNextCard
          item={nextCard}
          index={currentIndex + 1}
          topTranslateX={topTranslateX}
          renderCard={renderCard}
        />
      )}
      {topCard && (
        <CardStackTopCard
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
    width: SCREEN_WIDTH * 0.85,
    height: SCREEN_HEIGHT * 0.6,
    borderRadius: 24,
    backgroundColor: '#23272A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },
}); 