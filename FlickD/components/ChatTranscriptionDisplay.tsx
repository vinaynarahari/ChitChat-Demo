import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TranscriptionResult } from '../utils/transcription';

interface ChatTranscriptionDisplayProps {
  transcription: TranscriptionResult;
  currentPosition: number;
  isCurrentUser: boolean;
  isEavesdropMode?: boolean;
}

export default function ChatTranscriptionDisplay({ 
  transcription, 
  currentPosition,
  isCurrentUser,
  isEavesdropMode = false
}: ChatTranscriptionDisplayProps) {
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const words = transcription.results.items.map(item => ({
    text: item.alternatives[0].content,
    startTime: item.start_time ? parseFloat(item.start_time) * 1000 : 0,
    endTime: item.end_time ? parseFloat(item.end_time) * 1000 : 0,
    type: item.type
  }));

  useEffect(() => {
    if (words.length > 0) {
      const newActiveIndex = words.findIndex(
        word => currentPosition >= word.startTime && currentPosition <= word.endTime
      );
      setActiveWordIndex(newActiveIndex);
    }
  }, [currentPosition, words]);

  const renderWords = () => {
    return words.map((word, index) => {
      const isActive = index === activeWordIndex;
      const isPast = index < activeWordIndex;
      
      const wordStyle = [
        styles.word,
        isActive && styles.activeWord,
        isPast && styles.pastWord,
        isEavesdropMode
          ? styles.eavesdropText
          : (isCurrentUser ? styles.currentUserText : styles.otherUserText)
      ];

      return (
        <Text 
          key={index} 
          style={wordStyle}
        >
          {word.type === 'pronunciation' ? ` ${word.text}` : word.text}
        </Text>
      );
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.transcriptionText}>
        {renderWords()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  transcriptionText: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    fontSize: 14,
    lineHeight: 20,
  },
  currentUserText: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  otherUserText: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  eavesdropText: {
    color: '#fff',
  },
  word: {
    fontSize: 14,
    marginRight: 1,
  },
  activeWord: {
    backgroundColor: 'rgba(38, 167, 222, 0.2)',
    borderRadius: 4,
    paddingHorizontal: 2,
    paddingVertical: 1,
    color: '#26A7DE',
  },
  pastWord: {
    opacity: 0.7,
  },
}); 