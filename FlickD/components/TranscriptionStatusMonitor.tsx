import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FastTranscriptionOptimizer } from '../utils/fastTranscriptionOptimizer';

interface TranscriptionStatusMonitorProps {
  messageId: string;
  audioHash: string;
  onTranscriptionComplete?: (transcription: any) => void;
  onError?: (error: string) => void;
}

export default function TranscriptionStatusMonitor({
  messageId,
  audioHash,
  onTranscriptionComplete,
  onError
}: TranscriptionStatusMonitorProps) {
  const [status, setStatus] = useState<'processing' | 'uploading' | 'transcribing' | 'ready' | 'error'>('processing');
  const [progress, setProgress] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [transcription, setTranscription] = useState<any>(null);
  
  const spinValue = new Animated.Value(0);
  const progressValue = new Animated.Value(0);

  useEffect(() => {
    // Start spinning animation
    const spinAnimation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spinAnimation.start();

    // Start progress animation
    const progressAnimation = Animated.timing(progressValue, {
      toValue: 1,
      duration: 3000,
      easing: Easing.ease,
      useNativeDriver: false,
    });
    progressAnimation.start();

    // Start monitoring
    const interval = setInterval(() => {
      monitorTranscriptionStatus();
    }, 1000);

    return () => {
      spinAnimation.stop();
      progressAnimation.stop();
      clearInterval(interval);
    };
  }, []);

  const monitorTranscriptionStatus = async () => {
    try {
      const fastOptimizer = FastTranscriptionOptimizer.getInstance();
      const cacheStats = fastOptimizer.getCacheStats();
      
      // Check if transcription is cached
      const cached = await checkCacheStatus();
      if (cached) {
        setStatus('ready');
        setTranscription(cached);
        setProgress(100);
        onTranscriptionComplete?.(cached);
        return;
      }

      // Update elapsed time
      setElapsedTime(prev => prev + 1);

      // Estimate progress based on elapsed time
      const estimatedTotalTime = estimatedTime || 15; // Default 15 seconds
      const calculatedProgress = Math.min((elapsedTime / estimatedTotalTime) * 100, 95);
      setProgress(calculatedProgress);

      // Update status based on elapsed time
      if (elapsedTime < 3) {
        setStatus('uploading');
      } else if (elapsedTime < estimatedTotalTime) {
        setStatus('transcribing');
      } else {
        setStatus('error');
        onError?.('Transcription taking longer than expected');
      }

    } catch (error) {
      console.error('Error monitoring transcription status:', error);
      setStatus('error');
      onError?.('Failed to monitor transcription status');
    }
  };

  const checkCacheStatus = async (): Promise<any | null> => {
    try {
      // This would check the actual cache in the optimizer
      // For now, we'll simulate cache checking
      return null;
    } catch (error) {
      console.error('Error checking cache status:', error);
      return null;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'uploading':
        return 'Uploading audio...';
      case 'transcribing':
        return 'Transcribing audio...';
      case 'ready':
        return 'Transcription ready!';
      case 'error':
        return 'Transcription failed';
      default:
        return 'Processing...';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'uploading':
        return 'cloud-upload-outline';
      case 'transcribing':
        return 'mic-outline';
      case 'ready':
        return 'checkmark-circle';
      case 'error':
        return 'close-circle';
      default:
        return 'sync';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'ready':
        return '#4CAF50';
      case 'error':
        return '#F44336';
      default:
        return '#2196F3';
    }
  };

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const animatedProgress = progressValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, progress],
  });

  return (
    <View style={styles.container}>
      <View style={styles.statusContainer}>
        <Animated.View style={[styles.iconContainer, { transform: [{ rotate: spin }] }]}>
          <Ionicons 
            name={getStatusIcon() as any} 
            size={24} 
            color={getStatusColor()} 
          />
        </Animated.View>
        
        <View style={styles.textContainer}>
          <Text style={styles.statusText}>{getStatusText()}</Text>
          {estimatedTime && (
            <Text style={styles.timeText}>
              Estimated time: {Math.max(0, estimatedTime - elapsedTime)}s remaining
            </Text>
          )}
        </View>
      </View>

      {status !== 'ready' && status !== 'error' && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <Animated.View 
              style={[
                styles.progressFill, 
                { 
                  width: `${progress}%`,
                  backgroundColor: getStatusColor()
                }
              ]} 
            />
          </View>
          <Text style={styles.progressText}>{Math.round(progress)}%</Text>
        </View>
      )}

      {transcription && (
        <View style={styles.transcriptionPreview}>
          <Text style={styles.previewLabel}>Preview:</Text>
          <Text style={styles.previewText} numberOfLines={2}>
            {transcription.transcript || transcription.text || 'Transcription available'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    marginVertical: 8,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainer: {
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  timeText: {
    fontSize: 14,
    color: '#666',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    marginRight: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    minWidth: 40,
    textAlign: 'right',
  },
  transcriptionPreview: {
    marginTop: 8,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  previewText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
}); 