import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter, useSegments } from 'expo-router';
import { memo, useCallback, useEffect, useState } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView, PanGestureHandler } from 'react-native-gesture-handler';
import Animated, {
    Easing,
    interpolate,
    makeMutable,
    runOnJS,
    useAnimatedGestureHandler,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useAuth } from '../context/AuthContext';
import { useGestureContext } from '../context/GestureContext';
import { useGroupChatContext } from '../context/GroupChatContext';
import Communities from './communities';
import Feed from './feed';
import GcTestDatabase from './gcTestDatabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SPRING_CONFIG = {
  damping: 15,
  mass: 0.2,
  stiffness: 200,
  overshootClamping: true,
  restDisplacementThreshold: 0.001,
  restSpeedThreshold: 0.001,
};

const API_URL = Constants.expoConfig?.extra?.API_URL;

type GestureContext = {
  startX: number;
};

// Memoize the tab components to prevent unnecessary re-renders
const MemoizedGcTestDatabase = memo(GcTestDatabase);
const MemoizedFeed = memo(Feed);
const MemoizedCommunities = memo(Communities);


export const globalTabBarHidden = makeMutable(false);
export const globalNavigateToGC = makeMutable(0);
export const globalHeaderAnimation = makeMutable(0);
export const globalOpenPostModal = makeMutable(false);

export default function TabLayout() {
  const { user } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const { groupChats, fetchGroupChats, selectedChat } = useGroupChatContext();
  const { disableTabGestures } = useGestureContext();
  const translateX = useSharedValue(-SCREEN_WIDTH);
  const currentIndex = useSharedValue(1);
  const [activeIndex, setActiveIndex] = useState(1);
  const isGestureActive = useSharedValue(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check if we're in eavesdrop mode by looking at the current path
  const isEavesdropMode = segments.some(segment => segment.startsWith('eavesdrop'));

  // Optimize the updateActiveIndex callback
  const updateActiveIndex = useCallback((index: number) => {
    currentIndex.value = index;
    setActiveIndex(index);
  }, [currentIndex]);

  // Initialize group chats on mount
  useEffect(() => {
    const initialize = async () => {
      if (user?.userId) {
        await fetchGroupChats(user.userId);
        setIsLoading(false);
      }
    };
    initialize();
  }, [user?.userId, fetchGroupChats]);

  // Sync activeIndex with initial translateX position
  useEffect(() => {
    const initialIndex = Math.round(-translateX.value / SCREEN_WIDTH);
    if (initialIndex !== activeIndex) {
      setActiveIndex(initialIndex);
    }
  }, []);

  const gestureHandler = useAnimatedGestureHandler({
    onStart: (_, context: GestureContext) => {
      // Only disable tab switching gestures when popup is visible
      if (disableTabGestures) {
        // Still allow the gesture to start but we'll ignore the movement
        context.startX = translateX.value;
        return;
      }
      
      context.startX = translateX.value;
      isGestureActive.value = true;
    },
    onActive: (event, context: GestureContext) => {
      // Only disable tab switching gestures when popup is visible
      if (disableTabGestures) {
        // Don't update translateX when popup is visible
        return;
      }
      
      // Prevent tab switching when a chat is selected or in eavesdrop mode
      if (selectedChat || isEavesdropMode) return;

      const newTranslateX = context.startX + event.translationX;
      
      // NEW: Prevent swiping on edge tabs
      const currentTabIndex = Math.round(-translateX.value / SCREEN_WIDTH);
      
      // Prevent left swipe (positive translationX) on first tab (newspaper - index 0)
      if (currentTabIndex === 0 && event.translationX > 0) {
        // Apply 100% resistance to left swipe on first tab - no movement at all
        const resistance = 1.0;
        translateX.value = context.startX + event.translationX * (1 - resistance);
        return;
      }
      
      // Prevent right swipe (negative translationX) on last tab (feed - index 2)
      if (currentTabIndex === 2 && event.translationX < 0) {
        // Apply 100% resistance to right swipe on last tab - no movement at all
        const resistance = 1.0;
        translateX.value = context.startX + event.translationX * (1 - resistance);
        return;
      }
      
      // Optimize edge resistance for valid swipes
      if (newTranslateX > 0 || newTranslateX < -SCREEN_WIDTH * 2) {
        const resistance = 0.5;
        const overscroll = newTranslateX > 0 ? newTranslateX : newTranslateX + SCREEN_WIDTH * 2;
        const resistanceFactor = Math.min(1, Math.abs(overscroll) / SCREEN_WIDTH) * resistance;
        translateX.value = context.startX + event.translationX * (1 - resistanceFactor);
      } else {
        translateX.value = newTranslateX;
      }
    },
    onEnd: (event) => {
      // Only disable tab switching gestures when popup is visible
      if (disableTabGestures) {
        // Don't process the gesture end when popup is visible
        return;
      }
      
      // Prevent tab switching when a chat is selected or in eavesdrop mode
      if (selectedChat || isEavesdropMode) return;

      isGestureActive.value = false;
      
      // NEW: Check if swipe is valid for current tab
      const currentTabIndex = Math.round(-translateX.value / SCREEN_WIDTH);
      
      // Prevent left swipe (positive velocityX) on first tab (newspaper - index 0)
      if (currentTabIndex === 0 && event.velocityX > 0) {
        // Snap back to current tab
        translateX.value = withSpring(-currentTabIndex * SCREEN_WIDTH, {
          ...SPRING_CONFIG,
          velocity: 0,
        });
        return;
      }
      
      // Prevent right swipe (negative velocityX) on last tab (feed - index 2)
      if (currentTabIndex === 2 && event.velocityX < 0) {
        // Snap back to current tab
        translateX.value = withSpring(-currentTabIndex * SCREEN_WIDTH, {
          ...SPRING_CONFIG,
          velocity: 0,
        });
        return;
      }
      
      const shouldSwipe = Math.abs(event.velocityX) > 250;
      const targetIndex = shouldSwipe
        ? event.velocityX > 0
          ? Math.max(0, currentIndex.value - 1)
          : Math.min(2, currentIndex.value + 1)
        : Math.round(-translateX.value / SCREEN_WIDTH);

      const finalIndex = Math.max(0, Math.min(2, targetIndex));
      
      translateX.value = withSpring(-finalIndex * SCREEN_WIDTH, {
        ...SPRING_CONFIG,
        velocity: event.velocityX * 0.5,
      });
      
      currentIndex.value = finalIndex;
      runOnJS(updateActiveIndex)(finalIndex);
    },
  });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
    };
  });

  // Create animated style for tab bar with smooth hide/show animation
  const tabBarOpacity = useSharedValue(1);
  
  // Update tab bar visibility based on external control only
  useAnimatedReaction(
    () => globalTabBarHidden.value,
    (isHidden) => {
      // Only hide tab bar when externally controlled (user tap), not based on current tab
      tabBarOpacity.value = withTiming(isHidden ? 0 : 1, {
        duration: 300,
        easing: Easing.inOut(Easing.ease),
      });
    }
  );

  // Watch for navigation requests to GC tab
  useAnimatedReaction(
    () => globalNavigateToGC.value,
    (value) => {
      if (value > 0) {
        // Navigate to GC tab (index 1) with smooth animation
        translateX.value = withSpring(-1 * SCREEN_WIDTH, {
          ...SPRING_CONFIG,
          velocity: 0,
        });
        currentIndex.value = 1;
        runOnJS(updateActiveIndex)(1);
        // Reset the trigger
        globalNavigateToGC.value = 0;
      }
    }
  );

  // Watch for post creation modal requests
  useAnimatedReaction(
    () => globalOpenPostModal.value,
    (value) => {
      // Don't reset here - let the feed component handle it
    }
  );

  const animatedTabBarStyle = useAnimatedStyle(() => {
    return {
      opacity: tabBarOpacity.value,
      transform: [
        {
          translateY: interpolate(
            tabBarOpacity.value,
            [0, 1],
            [80, 0] // Slide down when hiding, slide up when showing
          ),
        },
      ],
    };
  });

  // Optimize tab bar rendering with memoization
  const renderTabBar = useCallback(() => {
    return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 80,
          zIndex: 1000,
        },
        animatedTabBarStyle,
      ]}
      pointerEvents={tabBarOpacity.value > 0.5 ? 'auto' : 'none'} // Disable touch when hidden
    >
      <View 
        style={{
          flex: 1,
          flexDirection: 'row',
          justifyContent: 'space-around',
          alignItems: 'center',
          paddingBottom: 8,
          paddingTop: 8,
          backgroundColor: 'transparent',
        }}
      >
        {['Communities', 'Database', 'Feed'].map((title, index) => {
          const isFeedTab = index === 2;
          const isCurrentTab = activeIndex === index;
          const shouldShowPlus = isFeedTab && isCurrentTab;
          
          return (
          <TouchableOpacity
            key={title}
            onPress={() => {
              // Prevent tab switching when in eavesdrop mode
              if (isEavesdropMode) {
                return;
              }
              
              // If it's the Feed tab (index 2), trigger post creation modal instead of switching
              if (index === 2 && currentIndex.value === 2) {
                globalOpenPostModal.value = true;
                return;
              }
              
              translateX.value = withSpring(-index * SCREEN_WIDTH, {
                ...SPRING_CONFIG,
                velocity: 0,
              });
              currentIndex.value = index;
              updateActiveIndex(index);
            }}
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 12,
              paddingHorizontal: 16,
            }}
          >
            <Ionicons
              name={
                index === 0
                  ? 'people-outline'
                  : index === 1
                  ? 'chatbubble-outline'
                  : shouldShowPlus
                  ? 'add'
                  : 'time-outline'
              }
              size={24}
              color={activeIndex === index ? '#26A7DE' : 'rgba(255, 255, 255, 0.6)'}
            />
          </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
    );
  }, [activeIndex, updateActiveIndex, isEavesdropMode, animatedTabBarStyle, tabBarOpacity]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: '#282828' }}>
        <PanGestureHandler 
          activeOffsetX={[-20, 20]}
          onGestureEvent={gestureHandler}
        >
          <Animated.View
            style={[
              {
                flex: 1,
                flexDirection: 'row',
                width: SCREEN_WIDTH * 3,
              },
              animatedStyle,
            ]}
          >
            <View style={{ width: SCREEN_WIDTH, backgroundColor: 'transparent' }}>
              <MemoizedCommunities />
            </View>
            <View style={{ width: SCREEN_WIDTH, backgroundColor: 'transparent' }}>
              <MemoizedGcTestDatabase />
            </View>
            <View style={{ width: SCREEN_WIDTH, backgroundColor: 'transparent' }}>
              <MemoizedFeed />
            </View>
          </Animated.View>
        </PanGestureHandler>
        {/* Show the tab bar if no group chat is selected and not in eavesdrop mode */}
        {!selectedChat && !isEavesdropMode && renderTabBar()}
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // Remove header styles
}); 