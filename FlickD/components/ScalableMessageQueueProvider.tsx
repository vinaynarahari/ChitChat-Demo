import React, { createContext, useContext, useEffect, useRef, ReactNode } from 'react';
import { useAuth } from '../app/context/AuthContext';
import { useGroupChatContext, Message } from '../app/context/GroupChatContext';
import useScalableMessageQueue from '../hooks/useScalableMessageQueue';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Context interface
interface ScalableQueueContextType {
  // Queue management
  addMessageToQueue: (message: Message, groupId: string) => boolean;
  clearQueueForGroup: (groupId: string) => void;
  getQueueStatus: (groupId: string) => any;
  
  // Processing control
  pauseQueueProcessing: (groupId: string) => void;
  resumeQueueProcessing: (groupId: string) => void;
  
  // Status
  isQueueProcessing: boolean;
  currentQueueStatus: any;
  queueMetrics: any;
  
  // Integration helpers
  processNewMessage: (message: Message) => void;
  handleRealTimeMessage: (message: Message) => void;
  isMessageInQueue: (messageId: string, groupId: string) => boolean;
}

// Create context
const ScalableQueueContext = createContext<ScalableQueueContextType | null>(null);

// Provider props
interface ScalableQueueProviderProps {
  children: ReactNode;
  config?: {
    enableBackToBackDetection?: boolean;
    enableInterruption?: boolean;
    enableMetrics?: boolean;
    maxConcurrentPerGroup?: number;
    backToBackThreshold?: number;
    burstThreshold?: number;
  };
  canAutoRecord?: (reason?: 'chat_entry' | 'playback_ended' | 'queue_granted' | 'queue_completed') => boolean;
  triggerAutoRecording?: (reason: 'chat_entry' | 'playback_ended' | 'queue_granted' | 'queue_completed') => Promise<void>;
}

// Provider component
export const ScalableQueueProvider: React.FC<ScalableQueueProviderProps> = ({ 
  children, 
  config = {},
  canAutoRecord,
  triggerAutoRecording
}) => {
  const { user, refreshAccessToken } = useAuth();
  const { 
    selectedChat, 
    messages, 
    socket, 
    markMessageAsViewed
  } = useGroupChatContext();

  // Use the scalable message queue hook
  const {
    addMessage,
    clearQueue,
    getQueueStatus,
    pauseProcessing,
    resumeProcessing,
    isProcessing,
    queueStatus,
    metrics,
    setAudioCallbacks,
    setEventCallbacks,
    onMessageProcessingStarted,
    onMessageProcessingCompleted,
    onMessageProcessingFailed,
    onMessageProcessingInterrupted,
    onBackToBackGroupCompleted,
    onQueueCompleted
  } = useScalableMessageQueue({
    enableBackToBackDetection: config.enableBackToBackDetection ?? true,
    enableInterruption: config.enableInterruption ?? true,
    enableMetrics: config.enableMetrics ?? true,
    maxConcurrentPerGroup: config.maxConcurrentPerGroup ?? 2,
    backToBackThreshold: config.backToBackThreshold ?? 5000,
    burstThreshold: config.burstThreshold ?? 10000
  });

  // Track messages in queue
  const messagesInQueueRef = useRef<Set<string>>(new Set());
  const currentGroupIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);

  // Update messages ref when messages change
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Update current group ID when selected chat changes
  useEffect(() => {
    if (selectedChat) {
      currentGroupIdRef.current = selectedChat._id;
    }
  }, [selectedChat?._id]);

  // Process new messages from the existing system
  const processNewMessage = (message: Message) => {
    if (!currentGroupIdRef.current || !user?.userId) {
      return;
    }

    // Don't process own messages
    if (message.senderId === user.userId) {
      return;
    }

    // Don't process already read messages
    if (message.isRead) {
      return;
    }

    // Don't process if already in queue
    if (messagesInQueueRef.current.has(message._id)) {
      return;
    }

    // Add to scalable queue
    const success = addMessage(message, currentGroupIdRef.current);
    
    if (success) {
      messagesInQueueRef.current.add(message._id);
    }
  };

  // Handle real-time messages from socket
  const handleRealTimeMessage = (message: Message) => {
    if (!currentGroupIdRef.current || !user?.userId) {
      return;
    }

    // Don't process own messages
    if (message.senderId === user.userId) {
      return;
    }

    // Don't process already read messages
    if (message.isRead) {
      return;
    }

    // Don't process if already in queue
    if (messagesInQueueRef.current.has(message._id)) {
      return;
    }

    // Add to scalable queue with higher priority for real-time messages
    const success = addMessage(message, currentGroupIdRef.current);
    
    if (success) {
      messagesInQueueRef.current.add(message._id);
    }
  };

  // Check if message is in queue
  const isMessageInQueue = (messageId: string, groupId: string): boolean => {
    return messagesInQueueRef.current.has(messageId);
  };

  // Add message to queue (public interface)
  const addMessageToQueue = (message: Message, groupId: string): boolean => {
    const success = addMessage(message, groupId);
    
    if (success) {
      messagesInQueueRef.current.add(message._id);
    }
    
    return success;
  };

  // Clear queue for group (public interface)
  const clearQueueForGroup = (groupId: string) => {
    clearQueue(groupId);
    messagesInQueueRef.current.clear();
  };

  // Pause queue processing (public interface)
  const pauseQueueProcessing = (groupId: string) => {
    pauseProcessing(groupId);
  };

  // Resume queue processing (public interface)
  const resumeQueueProcessing = (groupId: string) => {
    resumeProcessing(groupId);
  };

  // Listen for new messages from socket
  useEffect(() => {
    if (!socket || !user?.userId || !selectedChat) return;

    const handleSocketMessage = (message: Message) => {
      // Only process messages for the current chat
      if (message.groupChatId === selectedChat._id) {
        handleRealTimeMessage(message);
      }
    };

    // Listen for new messages
    socket.on('new_message', handleSocketMessage);

    return () => {
      socket.off('new_message', handleSocketMessage);
    };
  }, [socket, user?.userId, selectedChat?._id]);

  // Process existing unread messages when chat is selected
  useEffect(() => {
    if (!selectedChat || !messages.length || !user?.userId) {
      return;
    }

    // Get unread messages from other users
    const unreadMessages = messages.filter(msg => {
      return (
        msg.senderId !== user.userId && // Not own message
        msg.groupChatId === selectedChat._id && // Current chat
        msg.type === 'voice' && // Voice message
        !msg.isRead && // Unread
        !messagesInQueueRef.current.has(msg._id) // Not already in queue
      );
    });

    // Add unread messages to queue
    unreadMessages.forEach(message => {
      processNewMessage(message);
    });

    // CRITICAL FIX: If no unread messages, trigger auto-recording immediately
    if (unreadMessages.length === 0) {
      // Clear global processing state since there's nothing to process
      (window as any).scalableQueueProcessing = false;
      
      // Emit messages_processed event to backend
      if (socket) {
        socket.emit('messages_processed', { groupId: selectedChat._id });
      }
      
      // Trigger auto-recording after a short delay to ensure backend state is updated
      setTimeout(() => {
        // Get functions from global window object if not provided as props
        const globalCanAutoRecord = (window as any).canAutoRecord;
        const globalTriggerAutoRecording = (window as any).triggerAutoRecording;
        
        const finalCanAutoRecord = canAutoRecord || globalCanAutoRecord;
        const finalTriggerAutoRecording = triggerAutoRecording || globalTriggerAutoRecording;
        
        if (finalTriggerAutoRecording) {
          const result = finalCanAutoRecord ? finalCanAutoRecord('queue_completed') : false;
          
          if (result) {
            finalTriggerAutoRecording('queue_completed');
          }
        }
      }, 500); // 500ms delay to ensure backend state is updated
    }
  }, [selectedChat?._id, messages, user?.userId]);

  // Clean up when chat changes
  useEffect(() => {
    if (selectedChat) {
      // Clear queue for previous chat if different
      if (currentGroupIdRef.current && currentGroupIdRef.current !== selectedChat._id) {
        clearQueueForGroup(currentGroupIdRef.current);
      }
      
      // Clear tracked messages
      messagesInQueueRef.current.clear();
    }
  }, [selectedChat?._id]);

  // Enhanced event handlers that integrate with existing system
  useEffect(() => {
    // Override the default event handlers to integrate with existing system
    const enhancedOnMessageProcessingStarted = (messageId: string, groupId: string) => {
      // Set global processing state
      (window as any).scalableQueueProcessing = true;
      
      // Update UI state if needed
      // This could trigger loading states, progress indicators, etc.
    };

    const enhancedOnMessageProcessingCompleted = (messageId: string, groupId: string, duration: number) => {
      // Remove from tracked messages
      messagesInQueueRef.current.delete(messageId);
      
      // Mark message as viewed in existing system
      const currentMessages = messagesRef.current;
      const message = currentMessages.find(m => m._id === messageId);
      if (message && markMessageAsViewed) {
        markMessageAsViewed(message).catch(console.error);
      }
    };

    const enhancedOnMessageProcessingFailed = (messageId: string, error: string) => {
      // Remove from tracked messages
      messagesInQueueRef.current.delete(messageId);
      
      // Could show error notification to user
    };

    const enhancedOnMessageProcessingInterrupted = (messageId: string, reason: string) => {
      // Could show interruption notification to user
    };

    const enhancedOnBackToBackGroupCompleted = (groupId: string, senderId: string, messageCount: number) => {
      // Could show completion notification to user
    };

    const enhancedOnQueueCompleted = (groupId: string) => {
      // Clear global processing state
      (window as any).scalableQueueProcessing = false;
      
      // CRITICAL FIX: Emit messages_processed event to backend to trigger pending recording grants
      if (socket) {
        socket.emit('messages_processed', { groupId });
      }
      
      // Check if auto-recording should be triggered
      // CRITICAL FIX: Get functions from global window object if not provided as props
      const globalCanAutoRecord = (window as any).canAutoRecord;
      const globalTriggerAutoRecording = (window as any).triggerAutoRecording;
      
      const finalCanAutoRecord = canAutoRecord || globalCanAutoRecord;
      const finalTriggerAutoRecording = triggerAutoRecording || globalTriggerAutoRecording;
      
      if (finalTriggerAutoRecording) {
        const result = finalCanAutoRecord ? finalCanAutoRecord('queue_completed') : false;
        
        if (result) {
          finalTriggerAutoRecording('queue_completed');
        }
      }
      
      // Could show completion notification to user
    };

    // CRITICAL FIX: Set up the event callbacks in the ScalableQueue
    if (setEventCallbacks) {
      setEventCallbacks({
        onMessageProcessingStarted: enhancedOnMessageProcessingStarted,
        onMessageProcessingCompleted: enhancedOnMessageProcessingCompleted,
        onMessageProcessingFailed: enhancedOnMessageProcessingFailed,
        onMessageProcessingInterrupted: enhancedOnMessageProcessingInterrupted,
        onBackToBackGroupCompleted: enhancedOnBackToBackGroupCompleted,
        onQueueCompleted: enhancedOnQueueCompleted
      });
    }

    // Store enhanced handlers for use
    const enhancedHandlers = {
      onMessageProcessingStarted: enhancedOnMessageProcessingStarted,
      onMessageProcessingCompleted: enhancedOnMessageProcessingCompleted,
      onMessageProcessingFailed: enhancedOnMessageProcessingFailed,
      onMessageProcessingInterrupted: enhancedOnMessageProcessingInterrupted,
      onBackToBackGroupCompleted: enhancedOnBackToBackGroupCompleted,
      onQueueCompleted: enhancedOnQueueCompleted
    };

    // Make handlers available to the hook
    Object.assign(window, { enhancedHandlers });
  }, [markMessageAsViewed, canAutoRecord, triggerAutoRecording]); // Removed 'messages' dependency to prevent excessive re-runs

  // Set up audio callbacks for the queue
  useEffect(() => {
    if (!user?.userId) return;

    // Implement proper getAudioUrl function
    const getAudioUrl = async (messageId: string): Promise<string | null> => {
      try {
        // Get the current messages from the ref
        const currentMessages = messagesRef.current;
        const message = currentMessages.find(m => m._id === messageId);
        if (!message) {
          console.warn('[ScalableQueue] Message not found for audio URL:', messageId);
          return null;
        }

        // Check if message is an image or video - these don't have audio URLs
        if (message.type === 'image' || message.type === 'video') {
          console.warn('[ScalableQueue] Image/Video message detected, no audio URL available:', messageId);
          return null;
        }

        if (!message.audioUrl) {
          console.warn('[ScalableQueue] Message does not have an audioUrl yet:', messageId);
          return null;
        }

        const token = await AsyncStorage.getItem('accessToken');
        const API_URL = Constants.expoConfig?.extra?.API_URL;
        
        let response = await fetch(`${API_URL}/messages/${messageId}/audio-url`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        // Handle 401 error with token refresh
        if (response.status === 401) {
          console.log('[ScalableQueue] 401 received, attempting token refresh...');
          try {
            await refreshAccessToken();
            const newToken = await AsyncStorage.getItem('accessToken');
            response = await fetch(`${API_URL}/messages/${messageId}/audio-url`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${newToken}`,
                'Content-Type': 'application/json',
              },
            });
          } catch (refreshError) {
            console.error('[ScalableQueue] Token refresh failed:', refreshError);
            return null;
          }
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[ScalableQueue] Server error getting audio URL:', {
            status: response.status,
            statusText: response.statusText,
            errorText,
            messageId
          });
          
          if (response.status === 404) {
            console.warn('[ScalableQueue] Audio file not found for message, may still be processing:', messageId);
            return null;
          }
          
          throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const signedUrl = data.url;
        
        if (!signedUrl) {
          throw new Error('No signed URL received from server');
        }

        return signedUrl;
      } catch (error) {
        console.error('[ScalableQueue] Error getting audio URL:', {
          messageId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return null;
      }
    };

    setAudioCallbacks({
      getAudioUrl,
      onAudioPlaybackStart: (messageId: string) => {
      },
      onAudioPlaybackComplete: async (messageId: string) => {
        // Mark as read after playback
        const currentMessages = messagesRef.current;
        const message = currentMessages.find(m => m._id === messageId);
        if (message && markMessageAsViewed) {
          await markMessageAsViewed(message);
        }
      },
      onAudioPlaybackError: (messageId: string, error: string) => {
        console.error('[ScalableQueue] Audio playback error:', { messageId, error });
      },
      onMarkMessageAsRead: async (messageId: string) => {
        const currentMessages = messagesRef.current;
        const message = currentMessages.find(m => m._id === messageId);
        if (message && markMessageAsViewed) {
          await markMessageAsViewed(message);
        }
      }
    });
  }, [user?.userId, markMessageAsViewed, setAudioCallbacks]); // Removed 'messages' from dependencies to prevent excessive re-runs

  // Context value
  const contextValue: ScalableQueueContextType = {
    // Queue management
    addMessageToQueue,
    clearQueueForGroup,
    getQueueStatus,
    
    // Processing control
    pauseQueueProcessing,
    resumeQueueProcessing,
    
    // Status
    isQueueProcessing: isProcessing,
    currentQueueStatus: queueStatus,
    queueMetrics: metrics,
    
    // Integration helpers
    processNewMessage,
    handleRealTimeMessage,
    isMessageInQueue
  };

  return (
    <ScalableQueueContext.Provider value={contextValue}>
      {children}
    </ScalableQueueContext.Provider>
  );
};

// Hook to use the scalable queue context
export const useScalableQueue = (): ScalableQueueContextType => {
  const context = useContext(ScalableQueueContext);
  
  if (!context) {
    throw new Error('useScalableQueue must be used within a ScalableQueueProvider');
  }
  
  return context;
};

export default ScalableQueueProvider; 