import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useScalableQueue } from './ScalableMessageQueueProvider';
import { useGroupChatContext } from '../app/context/GroupChatContext';

// Simple integration component to demonstrate the scalable queue
export const ScalableQueueIntegration: React.FC = () => {
  const { selectedChat } = useGroupChatContext();
  const {
    isQueueProcessing,
    currentQueueStatus,
    queueMetrics,
    pauseQueueProcessing,
    resumeQueueProcessing,
    clearQueueForGroup
  } = useScalableQueue();

  const [showMetrics, setShowMetrics] = useState(false);

  if (!selectedChat) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Queue Status */}
      <View style={styles.statusContainer}>
        <Text style={styles.title}>Scalable Queue Status</Text>
        
        <View style={styles.statusRow}>
          <Text style={styles.label}>Processing:</Text>
          <Text style={[styles.value, { color: isQueueProcessing ? '#4CAF50' : '#FF9800' }]}>
            {isQueueProcessing ? 'Active' : 'Idle'}
          </Text>
        </View>

        {currentQueueStatus && (
          <>
            <View style={styles.statusRow}>
              <Text style={styles.label}>Messages in Queue:</Text>
              <Text style={styles.value}>{currentQueueStatus.messageCount}</Text>
            </View>

            <View style={styles.statusRow}>
              <Text style={styles.label}>Back-to-Back Groups:</Text>
              <Text style={styles.value}>{currentQueueStatus.backToBackGroups}</Text>
            </View>

            {currentQueueStatus.currentMessageId && (
              <View style={styles.statusRow}>
                <Text style={styles.label}>Current Message:</Text>
                <Text style={styles.value} numberOfLines={1}>
                  {currentQueueStatus.currentMessageId.substring(0, 8)}...
                </Text>
              </View>
            )}
          </>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={() => {
            if (isQueueProcessing) {
              pauseQueueProcessing(selectedChat._id);
            } else {
              resumeQueueProcessing(selectedChat._id);
            }
          }}
        >
          <Text style={styles.buttonText}>
            {isQueueProcessing ? 'Pause Queue' : 'Resume Queue'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => clearQueueForGroup(selectedChat._id)}
        >
          <Text style={styles.buttonText}>Clear Queue</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.infoButton]}
          onPress={() => setShowMetrics(!showMetrics)}
        >
          <Text style={styles.buttonText}>
            {showMetrics ? 'Hide Metrics' : 'Show Metrics'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Metrics */}
      {showMetrics && (
        <View style={styles.metricsContainer}>
          <Text style={styles.metricsTitle}>Queue Metrics</Text>
          
          <View style={styles.metricsGrid}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Total Messages</Text>
              <Text style={styles.metricValue}>{queueMetrics.totalMessages}</Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Processed</Text>
              <Text style={styles.metricValue}>{queueMetrics.processedMessages}</Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Failed</Text>
              <Text style={styles.metricValue}>{queueMetrics.failedMessages}</Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Back-to-Back Groups</Text>
              <Text style={styles.metricValue}>{queueMetrics.backToBackGroups}</Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Interruptions</Text>
              <Text style={styles.metricValue}>{queueMetrics.interruptions}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.infoText}>
          This scalable queue system handles back-to-back messages and provides 
          intelligent message processing for group chats with any number of members.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    margin: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  statusContainer: {
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  label: {
    fontSize: 14,
    color: '#ccc',
  },
  value: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
  },
  secondaryButton: {
    backgroundColor: '#FF5722',
  },
  infoButton: {
    backgroundColor: '#2196F3',
  },
  buttonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  metricsContainer: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  metricsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  metricItem: {
    width: '48%',
    backgroundColor: '#333',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 12,
    color: '#ccc',
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 16,
    color: '#fff',
    fontWeight: 'bold',
  },
  infoContainer: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
  },
  infoText: {
    fontSize: 12,
    color: '#ccc',
    lineHeight: 18,
  },
});

export default ScalableQueueIntegration; 