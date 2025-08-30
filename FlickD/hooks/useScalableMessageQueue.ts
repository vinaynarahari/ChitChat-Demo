import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../app/context/AuthContext';
import { useGroupChatContext, Message } from '../app/context/GroupChatContext';
import ScalableMessageQueue from '../services/ScalableMessageQueue';

// Hook configuration
interface UseScalableQueueConfig {
  enableBackToBackDetection?: boolean;
  enableInterruption?: boolean;
  enableMetrics?: boolean;
  maxConcurrentPerGroup?: number;
  backToBackThreshold?: number;
  burstThreshold?: number;
}

// Queue status
interface QueueStatus {
  isProcessing: boolean;
  messageCount: number;
  backToBackGroups: number;
  currentMessageId: string | null;
  metrics: {
    totalMessages: number;
    processedMessages: number;
    failedMessages: number;
    backToBackGroups: number;
    interruptions: number;
  };
}

// Hook return type
interface UseScalableQueueReturn {
  // Queue management
  addMessage: (message: Message, groupId: string) => boolean;
  clearQueue: (groupId: string) => void;
  getQueueStatus: (groupId: string) => QueueStatus;
  
  // Processing control
  pauseProcessing: (groupId: string) => void;
  resumeProcessing: (groupId: string) => void;
  
  // Status and metrics
  isProcessing: boolean;
  queueStatus: QueueStatus | null;
  metrics: QueueStatus['metrics'];
  
  // Audio callbacks setup
  setAudioCallbacks: (callbacks: {
    getAudioUrl?: (messageId: string) => Promise<string | null>;
    onAudioPlaybackStart?: (messageId: string) => void;
    onAudioPlaybackComplete?: (messageId: string) => void;
    onAudioPlaybackError?: (messageId: string, error: string) => void;
    onMarkMessageAsRead?: (messageId: string) => void;
  }) => void;
  
  // Event callbacks setup
  setEventCallbacks: (callbacks: {
    onMessageProcessingStarted?: (messageId: string, groupId: string) => void;
    onMessageProcessingCompleted?: (messageId: string, groupId: string, duration: number) => void;
    onMessageProcessingFailed?: (messageId: string, error: string) => void;
    onMessageProcessingInterrupted?: (messageId: string, reason: string) => void;
    onBackToBackGroupCompleted?: (groupId: string, senderId: string, messageCount: number) => void;
    onQueueCompleted?: (groupId: string) => void;
  }) => void;
  
  // Event handlers
  onMessageProcessingStarted: (messageId: string, groupId: string) => void;
  onMessageProcessingCompleted: (messageId: string, groupId: string, duration: number) => void;
  onMessageProcessingFailed: (messageId: string, error: string) => void;
  onMessageProcessingInterrupted: (messageId: string, reason: string) => void;
  onBackToBackGroupCompleted: (groupId: string, senderId: string, messageCount: number) => void;
  onQueueCompleted: (groupId: string) => void;
}

// Custom hook for scalable message queue
export const useScalableMessageQueue = (
  config: UseScalableQueueConfig = {}
): UseScalableQueueReturn => {
  const { user } = useAuth();
  const { selectedChat, markMessageAsViewed } = useGroupChatContext();
  
  // Queue instance
  const queueRef = useRef<ScalableMessageQueue | null>(null);
  
  // State
  const isProcessingRef = useRef(false);
  const queueStatusRef = useRef<QueueStatus | null>(null);
  const metricsRef = useRef<QueueStatus['metrics']>({
    totalMessages: 0,
    processedMessages: 0,
    failedMessages: 0,
    backToBackGroups: 0,
    interruptions: 0
  });

  // Initialize queue
  useEffect(() => {
    if (!user?.userId) return;

    // Create queue instance with configuration
    const queue = new ScalableMessageQueue({
      maxConcurrentPerGroup: config.maxConcurrentPerGroup || 2,
      backToBackThreshold: config.backToBackThreshold || 5000,
      burstThreshold: config.burstThreshold || 10000,
      priorityWeights: {
        realTime: 10,
        backToBack: 8,
        burst: 6,
        sender: 3
      }
    }, {
      onMessageProcessingStarted: (messageId: string, groupId: string) => {
        isProcessingRef.current = true;
        updateQueueStatus(groupId);
      },
      
      onMessageProcessingCompleted: (messageId: string, groupId: string, duration: number) => {
        isProcessingRef.current = false;
        updateQueueStatus(groupId);
        updateMetrics();
      },
      
      onMessageProcessingFailed: (messageId: string, error: string) => {
        isProcessingRef.current = false;
        updateMetrics();
      },
      
      onMessageProcessingInterrupted: (messageId: string, reason: string) => {
        updateMetrics();
      },
      
      onBackToBackGroupCompleted: (groupId: string, senderId: string, messageCount: number) => {
        updateQueueStatus(groupId);
        updateMetrics();
      },
      
      onQueueCompleted: (groupId: string) => {
        isProcessingRef.current = false;
        updateQueueStatus(groupId);
      },

      // Audio playback callbacks - these will be set by the parent component
      getAudioUrl: async (messageId: string) => {
        console.warn('[ScalableQueue] getAudioUrl callback not provided by parent component');
        return null;
      },

      onAudioPlaybackStart: (messageId: string) => {
        // You can add UI state updates here if needed
      },

      onAudioPlaybackComplete: (messageId: string) => {
        // You can add UI state updates here if needed
      },

      onAudioPlaybackError: (messageId: string, error: string) => {
        console.error('[ScalableQueue] Audio playback error:', { messageId, error });
        // You can add error handling here if needed
      },

      onMarkMessageAsRead: async (messageId: string) => {
        try {
          if (typeof markMessageAsViewed === 'function') {
            // Find the message and mark it as viewed
            // Note: We'll need to get messages from the parent component
          }
        } catch (error) {
          console.error('[ScalableQueue] Error marking message as read:', error);
        }
      }
    });

    // Set current user ID
    queue.setCurrentUserId(user.userId);
    
    // Store queue instance
    queueRef.current = queue;

    // Cleanup on unmount
    return () => {
      queue.cleanup();
      queueRef.current = null;
    };
  }, [user?.userId, config, markMessageAsViewed]);

  // Update queue status
  const updateQueueStatus = useCallback((groupId: string) => {
    if (!queueRef.current) return;

    const status = queueRef.current.getQueueStatus(groupId);
    queueStatusRef.current = {
      isProcessing: status.isProcessing,
      messageCount: status.messageCount,
      backToBackGroups: status.backToBackGroups,
      currentMessageId: status.currentMessageId,
      metrics: queueRef.current.getMetrics()
    };
    
    // Update global processing state
    (window as any).scalableQueueProcessing = status.isProcessing;
  }, []);

  // Update metrics
  const updateMetrics = useCallback(() => {
    if (!queueRef.current) return;
    
    const metrics = queueRef.current.getMetrics();
    metricsRef.current = metrics;
  }, []);

  // Add message to queue
  const addMessage = useCallback((message: Message, groupId: string): boolean => {
    if (!queueRef.current || !user?.userId) {
      return false;
    }

    // Don't add own messages
    if (message.senderId === user.userId) {
      return false;
    }

    // Don't add already read messages
    if (message.isRead) {
      return false;
    }

    const success = queueRef.current.addMessage(message, groupId);
    
    if (success) {
      updateQueueStatus(groupId);
      updateMetrics();
    }

    return success;
  }, [user?.userId, updateQueueStatus, updateMetrics]);

  // Clear queue for a group
  const clearQueue = useCallback((groupId: string) => {
    if (!queueRef.current) return;

    queueRef.current.clearQueue(groupId);
    updateQueueStatus(groupId);
    updateMetrics();
  }, [updateQueueStatus, updateMetrics]);

  // Get queue status
  const getQueueStatus = useCallback((groupId: string): QueueStatus => {
    if (!queueRef.current) {
      return {
        isProcessing: false,
        messageCount: 0,
        backToBackGroups: 0,
        currentMessageId: null,
        metrics: metricsRef.current
      };
    }

    const status = queueRef.current.getQueueStatus(groupId);
    return {
      isProcessing: status.isProcessing,
      messageCount: status.messageCount,
      backToBackGroups: status.backToBackGroups,
      currentMessageId: status.currentMessageId,
      metrics: queueRef.current.getMetrics()
    };
  }, []);

  // Pause processing for a group
  const pauseProcessing = useCallback((groupId: string) => {
    if (!queueRef.current) return;

    // This would need to be implemented in the queue service
    // For now, we'll clear the queue as a simple pause mechanism
    queueRef.current.clearQueue(groupId);
    updateQueueStatus(groupId);
  }, [updateQueueStatus]);

  // Resume processing for a group
  const resumeProcessing = useCallback((groupId: string) => {
    if (!queueRef.current) return;

    // This would trigger processing of any pending messages
    updateQueueStatus(groupId);
  }, [updateQueueStatus]);

  // Event handlers for external use
  const onMessageProcessingStarted = useCallback((messageId: string, groupId: string) => {
  }, []);

  const onMessageProcessingCompleted = useCallback((messageId: string, groupId: string, duration: number) => {
  }, []);

  const onMessageProcessingFailed = useCallback((messageId: string, error: string) => {
  }, []);

  const onMessageProcessingInterrupted = useCallback((messageId: string, reason: string) => {
  }, []);

  const onBackToBackGroupCompleted = useCallback((groupId: string, senderId: string, messageCount: number) => {
  }, []);

  const onQueueCompleted = useCallback((groupId: string) => {
  }, []);

  // Audio callbacks setup
  const setAudioCallbacks = useCallback((callbacks: {
    getAudioUrl?: (messageId: string) => Promise<string | null>;
    onAudioPlaybackStart?: (messageId: string) => void;
    onAudioPlaybackComplete?: (messageId: string) => void;
    onAudioPlaybackError?: (messageId: string, error: string) => void;
    onMarkMessageAsRead?: (messageId: string) => void;
  }) => {
    if (!queueRef.current) return;

    // Set the audio callbacks in the queue
    queueRef.current.setAudioCallbacks(callbacks);
  }, []);

  // Event callbacks setup
  const setEventCallbacks = useCallback((callbacks: {
    onMessageProcessingStarted?: (messageId: string, groupId: string) => void;
    onMessageProcessingCompleted?: (messageId: string, groupId: string, duration: number) => void;
    onMessageProcessingFailed?: (messageId: string, error: string) => void;
    onMessageProcessingInterrupted?: (messageId: string, reason: string) => void;
    onBackToBackGroupCompleted?: (groupId: string, senderId: string, messageCount: number) => void;
    onQueueCompleted?: (groupId: string) => void;
  }) => {
    if (!queueRef.current) return;

    // Set the event callbacks in the queue
    queueRef.current.setEventCallbacks(callbacks);
  }, []);

  return {
    // Queue management
    addMessage,
    clearQueue,
    getQueueStatus,
    
    // Processing control
    pauseProcessing,
    resumeProcessing,
    
    // Status and metrics
    isProcessing: isProcessingRef.current,
    queueStatus: queueStatusRef.current,
    metrics: metricsRef.current,
    
    // Audio callbacks setup
    setAudioCallbacks,
    
    // Event callbacks setup
    setEventCallbacks,
    
    // Event handlers
    onMessageProcessingStarted,
    onMessageProcessingCompleted,
    onMessageProcessingFailed,
    onMessageProcessingInterrupted,
    onBackToBackGroupCompleted,
    onQueueCompleted
  };
};

export default useScalableMessageQueue; 