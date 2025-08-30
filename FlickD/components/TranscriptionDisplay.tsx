import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { TranscriptionResult } from '../utils/transcription';

interface TranscriptionDisplayProps {
  transcription: TranscriptionResult | null;
  currentPosition: number;
  isPlaying: boolean;
}

export default function TranscriptionDisplay({ 
  transcription, 
  currentPosition,
  isPlaying 
}: TranscriptionDisplayProps) {
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const scrollViewRef = useRef<ScrollView>(null);
  const lastScrollTime = useRef(Date.now());

  // Update active word based on current position using actual word timings
  useEffect(() => {
    if (transcription?.results.items && transcription.results.items.length > 0) {
      const newActiveIndex = transcription.results.items.findIndex(
        item => {
          if (item.type === 'pronunciation' && item.start_time && item.end_time) {
            const startTime = parseFloat(item.start_time) * 1000;
            const endTime = parseFloat(item.end_time) * 1000;
            return currentPosition >= startTime && currentPosition <= endTime;
          }
          return false;
        }
      );
      
      if (newActiveIndex !== activeWordIndex) {
        setActiveWordIndex(newActiveIndex);
        
        // Only scroll if we haven't scrolled in the last 100ms to prevent jumpy behavior
        const now = Date.now();
        if (now - lastScrollTime.current > 100 && scrollViewRef.current && newActiveIndex >= 0) {
          lastScrollTime.current = now;
          scrollViewRef.current.scrollTo({
            y: Math.max(0, (newActiveIndex - 2) * 45), // Show 2 words above the current word
            animated: true
          });
        }
      }
    }
  }, [currentPosition, transcription, activeWordIndex]);

  if (!transcription?.results.items) return null;

  return (
    <BlurView intensity={20} style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        {transcription.results.items.map((item, index) => (
          item.type === 'pronunciation' && (
            <View key={index} style={styles.wordContainer}>
              <Text
                style={[
                  styles.word,
                  index === activeWordIndex && styles.activeWord,
                  index < activeWordIndex && styles.pastWord
                ]}
              >
                {item.alternatives[0].content}
              </Text>
            </View>
          )
        ))}
      </ScrollView>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 16,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  wordContainer: {
    marginVertical: 4,
  },
  word: {
    fontSize: 16,
    color: '#333',
  },
  activeWord: {
    fontWeight: '600',
    backgroundColor: 'rgba(107, 43, 140, 0.1)',
  },
  pastWord: {
    opacity: 0.7,
  },
}); 