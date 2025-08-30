import { Audio } from 'expo-av';
import { Message } from '../app/context/GroupChatContext';

// Production-grade configuration
interface ProductionConfig {
  maxConcurrentPerGroup: number;
  maxConcurrentPerUser: number;
  maxRetries: number;
  retryDelayMs: number;
  interruptionThreshold: number;
  backToBackThreshold: number;
  burstThreshold: number;
  priorityWeights: {
    realTime: number;
    backToBack: number;
    burst: number;
    sender: number;
  };
}

// Message state management
interface MessageState {
  status: 'pending' | 'processing' | 'interrupted' | 'completed' | 'failed' | 'retrying' | 'back_to_back_processing';
  currentProcessor: string | null;
  startTime: number | null;
  endTime: number | null;
  errorCount: number;
  lastError: Error | null;
  retryDelay: number;
  interruptionCount: number;
  playbackPosition: number;
  audioStatus: 'loading' | 'ready' | 'playing' | 'paused' | 'completed' | 'error';
}

// Priority message with enhanced metadata
interface PriorityMessage {
  message: Message;
  priority: number;
  timestamp: number;
  senderId: string;
  recipients: string[];
  processingAttempts: number;
  maxRetries: number;
  interruptionLevel: 'none' | 'low' | 'high' | 'critical';
  dependencies: string[];
  state: MessageState;
  metadata: MessageMetadata;
}

// Message metadata for back-to-back detection
interface MessageMetadata {
  isBackToBack: boolean;
  backToBackGroup: string | null;
  senderMessageCount: number;
  timeSinceLastMessage: number;
  groupActivityLevel: 'low' | 'medium' | 'high' | 'burst';
  networkConditions: 'good' | 'fair' | 'poor';
  deviceCapability: 'high' | 'medium' | 'low';
}

// Back-to-back group management
interface BackToBackGroup {
  groupId: string;
  senderId: string;
  messages: PriorityMessage[];
  priority: number;
  created: number;
  lastUpdated: number;
  status: 'active' | 'completed' | 'cancelled';
}

// Group queue state
interface GroupQueue {
  groupId: string;
  messages: PriorityMessage[];
  backToBackGroups: Map<string, BackToBackGroup>;
  processingState: ProcessingState;
  interruptionHandlers: InterruptionHandler[];
  maxConcurrent: number;
  currentProcessors: Set<string>;
  lastProcessedTime: number;
}

// Processing state
interface ProcessingState {
  isProcessing: boolean;
  currentMessageId: string | null;
  lastProcessedTime: number;
  totalProcessed: number;
  totalErrors: number;
}

// Interruption handler
interface InterruptionHandler {
  type: string;
  interruptedMessageId: string;
  interruptingMessageId: string;
  timestamp: number;
  handler: () => void;
}

// Error recovery result
interface ErrorRecoveryResult {
  success: boolean;
  error?: string;
  result?: any;
  skipped?: boolean;
}

// Error context
interface ErrorContext {
  operation: string;
  retryCount?: number;
  usedFallback?: boolean;
  metadata?: any;
}

// Recovery strategy
interface RecoveryStrategy {
  type: 'retry_with_backoff' | 'retry_with_fallback' | 'skip_and_continue' | 'retry_with_exponential_backoff';
  maxRetries: number;
  backoffMultiplier?: number;
  baseDelay: number;
  fallbackUrls?: boolean;
}

// Queue metrics
interface QueueMetrics {
  totalMessages: number;
  processedMessages: number;
  failedMessages: number;
  averageProcessingTime: number;
  backToBackGroups: number;
  interruptions: number;
}

// Event callbacks
interface QueueEventCallbacks {
  onMessageProcessingStarted?: (messageId: string, groupId: string) => void;
  onMessageProcessingCompleted?: (messageId: string, groupId: string, duration: number) => void;
  onMessageProcessingFailed?: (messageId: string, error: string) => void;
  onMessageProcessingInterrupted?: (messageId: string, reason: string) => void;
  onBackToBackGroupCompleted?: (groupId: string, senderId: string, messageCount: number) => void;
  onQueueCompleted?: (groupId: string) => void;
  onError?: (error: Error, context: ErrorContext) => void;
  // Audio playback callbacks
  getAudioUrl?: (messageId: string) => Promise<string | null>;
  onAudioPlaybackStart?: (messageId: string) => void;
  onAudioPlaybackComplete?: (messageId: string) => void;
  onAudioPlaybackError?: (messageId: string, error: string) => void;
  onMarkMessageAsRead?: (messageId: string) => void;
}

// Production-grade scalable message queue system
export class ScalableMessageQueue {
  private groupQueues: Map<string, GroupQueue> = new Map();
  private config: ProductionConfig;
  private eventCallbacks: QueueEventCallbacks;
  private metrics: QueueMetrics;
  private currentUserId: string | null = null;
  private audioCache: Map<string, Audio.Sound> = new Map();
  private currentSound: Audio.Sound | null = null;

  constructor(config: Partial<ProductionConfig> = {}, callbacks: QueueEventCallbacks = {}) {
    this.config = {
      maxConcurrentPerGroup: 2,
      maxConcurrentPerUser: 1,
      maxRetries: 3,
      retryDelayMs: 1000,
      interruptionThreshold: 2000,
      backToBackThreshold: 5000,
      burstThreshold: 10000,
      priorityWeights: {
        realTime: 10,
        backToBack: 8,
        burst: 6,
        sender: 3
      },
      ...config
    };
    
    this.eventCallbacks = callbacks;
    this.metrics = {
      totalMessages: 0,
      processedMessages: 0,
      failedMessages: 0,
      averageProcessingTime: 0,
      backToBackGroups: 0,
      interruptions: 0
    };
  }

  // Set current user ID
  setCurrentUserId(userId: string): void {
    this.currentUserId = userId;
  }

  // Update audio callbacks
  setAudioCallbacks(callbacks: {
    getAudioUrl?: (messageId: string) => Promise<string | null>;
    onAudioPlaybackStart?: (messageId: string) => void;
    onAudioPlaybackComplete?: (messageId: string) => void;
    onAudioPlaybackError?: (messageId: string, error: string) => void;
    onMarkMessageAsRead?: (messageId: string) => void;
  }): void {
    // Update audio callbacks
    if (callbacks.getAudioUrl) this.eventCallbacks.getAudioUrl = callbacks.getAudioUrl;
    if (callbacks.onAudioPlaybackStart) this.eventCallbacks.onAudioPlaybackStart = callbacks.onAudioPlaybackStart;
    if (callbacks.onAudioPlaybackComplete) this.eventCallbacks.onAudioPlaybackComplete = callbacks.onAudioPlaybackComplete;
    if (callbacks.onAudioPlaybackError) this.eventCallbacks.onAudioPlaybackError = callbacks.onAudioPlaybackError;
    if (callbacks.onMarkMessageAsRead) this.eventCallbacks.onMarkMessageAsRead = callbacks.onMarkMessageAsRead;
  }

  setEventCallbacks(callbacks: {
    onMessageProcessingStarted?: (messageId: string, groupId: string) => void;
    onMessageProcessingCompleted?: (messageId: string, groupId: string, duration: number) => void;
    onMessageProcessingFailed?: (messageId: string, error: string) => void;
    onMessageProcessingInterrupted?: (messageId: string, reason: string) => void;
    onBackToBackGroupCompleted?: (groupId: string, senderId: string, messageCount: number) => void;
    onQueueCompleted?: (groupId: string) => void;
  }): void {
    // Update event callbacks
    if (callbacks.onMessageProcessingStarted) this.eventCallbacks.onMessageProcessingStarted = callbacks.onMessageProcessingStarted;
    if (callbacks.onMessageProcessingCompleted) this.eventCallbacks.onMessageProcessingCompleted = callbacks.onMessageProcessingCompleted;
    if (callbacks.onMessageProcessingFailed) this.eventCallbacks.onMessageProcessingFailed = callbacks.onMessageProcessingFailed;
    if (callbacks.onMessageProcessingInterrupted) this.eventCallbacks.onMessageProcessingInterrupted = callbacks.onMessageProcessingInterrupted;
    if (callbacks.onBackToBackGroupCompleted) this.eventCallbacks.onBackToBackGroupCompleted = callbacks.onBackToBackGroupCompleted;
    if (callbacks.onQueueCompleted) this.eventCallbacks.onQueueCompleted = callbacks.onQueueCompleted;
  }

  // Add message to queue with back-to-back detection
  addMessage(message: Message, groupId: string): boolean {
    if (!this.currentUserId) {
      console.warn('[ScalableQueue] No current user ID set');
      return false;
    }

    // Don't add own messages
    if (message.senderId === this.currentUserId) {
      return false;
    }

    const metadata = this.analyzeMessageMetadata(message, groupId);
    const priority = this.calculatePriority(message, metadata);
    const interruptionLevel = this.determineInterruptionLevel(message, metadata);
    
    const priorityMessage: PriorityMessage = {
      message,
      priority,
      timestamp: Date.now(),
      senderId: message.senderId,
      recipients: [this.currentUserId], // Simplified for now
      processingAttempts: 0,
      maxRetries: this.config.maxRetries,
      interruptionLevel,
      dependencies: [],
      state: {
        status: 'pending',
        currentProcessor: null,
        startTime: null,
        endTime: null,
        errorCount: 0,
        lastError: null,
        retryDelay: this.config.retryDelayMs,
        interruptionCount: 0,
        playbackPosition: 0,
        audioStatus: 'loading'
      },
      metadata
    };

    // Handle back-to-back messages
    if (metadata.isBackToBack) {
      this.handleBackToBackMessage(priorityMessage, groupId);
    } else {
      this.addToPriorityQueue(priorityMessage, groupId);
    }

    // Update metrics
    this.metrics.totalMessages++;
    
    // Trigger processing
    this.triggerProcessing(groupId);
    
    return true;
  }

  // Analyze message metadata for back-to-back detection
  private analyzeMessageMetadata(message: Message, groupId: string): MessageMetadata {
    const groupQueue = this.getOrCreateGroupQueue(groupId);
    const senderMessages = groupQueue.messages.filter(m => m.senderId === message.senderId);
    const lastSenderMessage = senderMessages[senderMessages.length - 1];
    
    const timeSinceLastMessage = lastSenderMessage 
      ? Date.now() - lastSenderMessage.timestamp 
      : Infinity;
    
    const isBackToBack = timeSinceLastMessage <= this.config.backToBackThreshold;
    const backToBackGroup = isBackToBack ? this.findBackToBackGroup(message.senderId, groupId) : null;
    
    // Calculate group activity level
    const recentMessages = groupQueue.messages.filter(m => 
      Date.now() - m.timestamp <= this.config.burstThreshold
    );
    
    let groupActivityLevel: 'low' | 'medium' | 'high' | 'burst';
    if (recentMessages.length <= 2) groupActivityLevel = 'low';
    else if (recentMessages.length <= 5) groupActivityLevel = 'medium';
    else if (recentMessages.length <= 10) groupActivityLevel = 'high';
    else groupActivityLevel = 'burst';

    return {
      isBackToBack,
      backToBackGroup,
      senderMessageCount: senderMessages.length + 1,
      timeSinceLastMessage,
      groupActivityLevel,
      networkConditions: 'good', // Simplified for now
      deviceCapability: 'medium' // Simplified for now
    };
  }

  // Calculate message priority
  private calculatePriority(message: Message, metadata: MessageMetadata): number {
    let priority = 0;
    const now = Date.now();

    // Base priority for real-time messages
    const messageAge = now - new Date(message.timestamp).getTime();
    if (messageAge < 1000) priority += 100; // Very recent
    else if (messageAge < 5000) priority += 80; // Recent
    else if (messageAge < 30000) priority += 50; // Within 30 seconds
    else priority += 20; // Older

    // Back-to-back message priority boost
    if (metadata.isBackToBack) {
      priority += 30; // Higher priority for back-to-back messages
      
      // Additional boost for rapid back-to-back
      if (metadata.timeSinceLastMessage < 1000) {
        priority += 20; // Very rapid back-to-back
      }
    }

    // Group activity level priority
    switch (metadata.groupActivityLevel) {
      case 'burst':
        priority += 40; // High priority during burst activity
        break;
      case 'high':
        priority += 25;
        break;
      case 'medium':
        priority += 15;
        break;
      case 'low':
        priority += 5;
        break;
    }

    // Sender priority (could be based on user importance, etc.)
    const senderPriority = this.getSenderPriority(message.senderId);
    priority += senderPriority;

    return priority;
  }

  // Determine interruption level
  private determineInterruptionLevel(message: Message, metadata: MessageMetadata): 'none' | 'low' | 'high' | 'critical' {
    if (metadata.isBackToBack && metadata.timeSinceLastMessage < 1000) {
      return 'critical'; // Very rapid back-to-back
    }
    
    if (metadata.isBackToBack) {
      return 'high'; // Regular back-to-back
    }
    
    if (metadata.groupActivityLevel === 'burst') {
      return 'high'; // Burst activity
    }
    
    if (this.isHighPrioritySender(message.senderId)) {
      return 'low'; // High priority sender
    }
    
    return 'none';
  }

  // Handle back-to-back messages
  private handleBackToBackMessage(message: PriorityMessage, groupId: string): void {
    const groupQueue = this.getOrCreateGroupQueue(groupId);
    const backToBackGroup = message.metadata.backToBackGroup;
    
    if (backToBackGroup) {
      // Add to existing back-to-back group
      const existingGroup = groupQueue.backToBackGroups.get(backToBackGroup);
      if (existingGroup) {
        existingGroup.messages.push(message);
        existingGroup.lastUpdated = Date.now();
        
        // Recalculate priority for the entire group
        this.recalculateBackToBackGroupPriority(backToBackGroup, groupId);
      }
    } else {
      // Create new back-to-back group
      const newGroupId = this.generateBackToBackGroupId(message.senderId);
      const backToBackGroup: BackToBackGroup = {
        groupId: newGroupId,
        senderId: message.senderId,
        messages: [message],
        priority: message.priority,
        created: Date.now(),
        lastUpdated: Date.now(),
        status: 'active'
      };
      
      groupQueue.backToBackGroups.set(newGroupId, backToBackGroup);
      message.metadata.backToBackGroup = newGroupId;
      this.metrics.backToBackGroups++;
    }

    // Handle interruption if necessary
    this.handleBackToBackInterruption(message, groupId);
  }

  // Handle interruption for back-to-back messages
  private handleBackToBackInterruption(message: PriorityMessage, groupId: string): void {
    const groupQueue = this.getOrCreateGroupQueue(groupId);
    const currentlyProcessing = groupQueue.messages.find(m => 
      m.state.status === 'processing' && m.senderId === message.senderId
    );

    if (currentlyProcessing) {
      // Interrupt current message if new message has higher priority
      if (message.priority > currentlyProcessing.priority) {
        this.interruptMessage(currentlyProcessing, 'higher_priority_back_to_back');
        
        // Add interruption handler
        const interruptionHandler: InterruptionHandler = {
          type: 'back_to_back_interruption',
          interruptedMessageId: currentlyProcessing.message._id,
          interruptingMessageId: message.message._id,
          timestamp: Date.now(),
          handler: () => this.resumeInterruptedMessage(currentlyProcessing)
        };
        
        groupQueue.interruptionHandlers.push(interruptionHandler);
        this.metrics.interruptions++;
      }
    }
  }

  // Add message to priority queue
  private addToPriorityQueue(message: PriorityMessage, groupId: string): void {
    const groupQueue = this.getOrCreateGroupQueue(groupId);
    groupQueue.messages.push(message);
    
    // Sort by priority (highest first)
    groupQueue.messages.sort((a, b) => b.priority - a.priority);
  }

  // Trigger processing for a group
  private triggerProcessing(groupId: string): void {
    const groupQueue = this.groupQueues.get(groupId);
    if (!groupQueue || groupQueue.processingState.isProcessing) {
      return;
    }

    // Start processing asynchronously
    setTimeout(() => this.processMessages(groupId), 0);
  }

  // Process messages for a group
  private async processMessages(groupId: string): Promise<void> {
    const groupQueue = this.getOrCreateGroupQueue(groupId);
    
    if (groupQueue.processingState.isProcessing) {
      return;
    }

    // Get next message to process
    const nextMessage = this.getNextMessageToProcess(groupQueue);
    if (!nextMessage) {
      // Queue is empty
      this.eventCallbacks.onQueueCompleted?.(groupId);
      return;
    }

    // Check for interruptions
    if (this.shouldInterruptProcessing(nextMessage, groupQueue)) {
      this.handleProcessingInterruption(nextMessage, groupQueue);
      return;
    }

    // Start processing
    await this.startMessageProcessing(nextMessage, groupQueue);
  }

  // Get next message considering back-to-back groups
  private getNextMessageToProcess(groupQueue: GroupQueue): PriorityMessage | null {
    // First, check for back-to-back groups that should be processed together
    const backToBackGroup = this.getNextBackToBackGroup(groupQueue);
    if (backToBackGroup) {
      return backToBackGroup.messages[0]; // Return first message of the group
    }

    // Otherwise, get highest priority individual message
    return groupQueue.messages
      .filter(m => m.state.status === 'pending')
      .sort((a, b) => b.priority - a.priority)[0] || null;
  }

  // Get next back-to-back group to process
  private getNextBackToBackGroup(groupQueue: GroupQueue): BackToBackGroup | null {
    const activeGroups = Array.from(groupQueue.backToBackGroups.values())
      .filter(g => g.status === 'active' && g.messages.some(m => m.state.status === 'pending'))
      .sort((a, b) => b.priority - a.priority);

    return activeGroups[0] || null;
  }

  // Check if processing should be interrupted
  private shouldInterruptProcessing(message: PriorityMessage, groupQueue: GroupQueue): boolean {
    const currentlyProcessing = groupQueue.messages.find(m => m.state.status === 'processing');
    
    if (!currentlyProcessing) return false;

    // Check if new message has higher interruption level
    if (message.interruptionLevel === 'critical' && currentlyProcessing.interruptionLevel !== 'critical') {
      return true;
    }

    // Check if new message is from same sender and is back-to-back
    if (message.senderId === currentlyProcessing.senderId && message.metadata.isBackToBack) {
      return true;
    }

    // Check if new message has significantly higher priority
    if (message.priority > currentlyProcessing.priority + 50) {
      return true;
    }

    return false;
  }

  // Handle processing interruption
  private handleProcessingInterruption(message: PriorityMessage, groupQueue: GroupQueue): void {
    const currentlyProcessing = groupQueue.messages.find(m => m.state.status === 'processing');
    if (!currentlyProcessing) return;

    // Interrupt current message
    this.interruptMessage(currentlyProcessing, 'higher_priority_message');

    // Add interruption handler for resumption
    const interruptionHandler: InterruptionHandler = {
      type: 'priority_interruption',
      interruptedMessageId: currentlyProcessing.message._id,
      interruptingMessageId: message.message._id,
      timestamp: Date.now(),
      handler: () => this.resumeInterruptedMessage(currentlyProcessing)
    };

    groupQueue.interruptionHandlers.push(interruptionHandler);
    this.metrics.interruptions++;

    // Start processing the interrupting message
    this.startMessageProcessing(message, groupQueue);
  }

  // Start processing a message
  private async startMessageProcessing(message: PriorityMessage, groupQueue: GroupQueue): Promise<void> {
    // Update message state
    message.state.status = 'processing';
    message.state.currentProcessor = this.currentUserId;
    message.state.startTime = Date.now();

    // Update queue state
    groupQueue.processingState.isProcessing = true;
    groupQueue.processingState.currentMessageId = message.message._id;
    groupQueue.currentProcessors.add(this.currentUserId!);

    // Emit processing started event
    this.eventCallbacks.onMessageProcessingStarted?.(message.message._id, groupQueue.groupId);

    try {
      // Process the message
      await this.processMessage(message);

      // Mark as completed
      message.state.status = 'completed';
      message.state.endTime = Date.now();
      this.metrics.processedMessages++;

      // Handle back-to-back group completion
      if (message.metadata.backToBackGroup) {
        this.handleBackToBackGroupCompletion(message, groupQueue);
      }

      // Emit completion event
      const duration = Date.now() - (message.state.startTime || 0);
      this.eventCallbacks.onMessageProcessingCompleted?.(message.message._id, groupQueue.groupId, duration);

      // Continue processing
      this.continueProcessing(groupQueue);

    } catch (error) {
      // Handle processing error
      await this.handleProcessingError(message, error as Error, groupQueue);
    }
  }

  // Process individual message
  private async processMessage(message: PriorityMessage): Promise<void> {
    try {
      // Get audio URL using the provided callback
      const audioUrl = await this.getAudioUrl(message.message._id);
      if (!audioUrl) {
        throw new Error('Failed to get audio URL for message');
      }

      // Play the message using the existing audio system
      await this.playMessage(message.message, audioUrl);

      // Mark message as read if callback provided
      if (this.eventCallbacks.onMarkMessageAsRead) {
        this.eventCallbacks.onMarkMessageAsRead(message.message._id);
      }

    } catch (error) {
      console.error('[ScalableQueue] ❌ Error processing individual message:', {
        messageId: message.message._id,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  // Get audio URL using the provided callback
  private async getAudioUrl(messageId: string): Promise<string | null> {
    if (!this.eventCallbacks.getAudioUrl) {
      console.warn('[ScalableQueue] No getAudioUrl callback provided');
      return null;
    }

    try {
      return await this.eventCallbacks.getAudioUrl(messageId);
    } catch (error) {
      console.error('[ScalableQueue] Error getting audio URL:', {
        messageId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  // Play message using the existing audio system
  private async playMessage(message: Message, audioUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let playbackCompleted = false;
      let playbackError = false;

      try {
        // Emit audio playback start event
        this.eventCallbacks.onAudioPlaybackStart?.(message._id);

        // Stop any current playback first
        if (this.currentSound) {
          this.currentSound.unloadAsync().catch(console.warn);
          this.currentSound = null;
        }

        // Create new sound object
        const sound = new Audio.Sound();
        
        // Set up status update callback
        sound.setOnPlaybackStatusUpdate((status: any) => {
          if (status.isLoaded) {
            // Update message state
            const messageState = this.findMessageState(message._id);
            if (messageState) {
              messageState.playbackPosition = status.positionMillis || 0;
              messageState.audioStatus = status.isPlaying ? 'playing' : 'paused';
            }

            // Check if playback finished
            if (status.didJustFinish && !playbackCompleted) {
              playbackCompleted = true;
              this.eventCallbacks.onAudioPlaybackComplete?.(message._id);
              resolve();
            }
          }
        });

        // Load and play the audio
        sound.loadAsync({ uri: audioUrl })
          .then(() => sound.playAsync())
          .then(() => {
            // Store reference to current sound
            this.currentSound = sound;
          })
          .catch((error) => {
            if (!playbackCompleted && !playbackError) {
              playbackError = true;
              console.error('[ScalableQueue] Error playing message:', {
                messageId: message._id,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
              
              // Emit audio playback error event
              this.eventCallbacks.onAudioPlaybackError?.(message._id, error instanceof Error ? error.message : 'Unknown error');
              
              reject(error);
            }
          });

        // Set a timeout to prevent hanging
        setTimeout(() => {
          if (!playbackCompleted && !playbackError) {
            console.warn('[ScalableQueue] Playback timeout, resolving anyway:', message._id);
            playbackCompleted = true;
            resolve();
          }
        }, 30000); // 30 second timeout

      } catch (error) {
        if (!playbackCompleted && !playbackError) {
          playbackError = true;
          console.error('[ScalableQueue] Error setting up message playback:', {
            messageId: message._id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          
          // Emit audio playback error event
          this.eventCallbacks.onAudioPlaybackError?.(message._id, error instanceof Error ? error.message : 'Unknown error');
          
          reject(error);
        }
      }
    });
  }

  // Helper method to find message state
  private findMessageState(messageId: string): MessageState | null {
    for (const groupQueue of this.groupQueues.values()) {
      const message = groupQueue.messages.find(m => m.message._id === messageId);
      if (message) {
        return message.state;
      }
    }
    return null;
  }

  // Handle back-to-back group completion
  private handleBackToBackGroupCompletion(message: PriorityMessage, groupQueue: GroupQueue): void {
    const backToBackGroup = groupQueue.backToBackGroups.get(message.metadata.backToBackGroup!);
    if (!backToBackGroup) return;

    // Check if all messages in the group are completed
    const allCompleted = backToBackGroup.messages.every(m => m.state.status === 'completed');
    
    if (allCompleted) {
      // Mark group as completed
      backToBackGroup.status = 'completed';
      
      // Emit group completion event
      this.eventCallbacks.onBackToBackGroupCompleted?.(
        backToBackGroup.groupId,
        backToBackGroup.senderId,
        backToBackGroup.messages.length
      );

      // Clean up completed group
      groupQueue.backToBackGroups.delete(backToBackGroup.groupId);
    }
  }

  // Handle processing error with retry logic
  private async handleProcessingError(message: PriorityMessage, error: Error, groupQueue: GroupQueue): Promise<void> {
    message.state.errorCount++;
    message.state.lastError = error;
    this.metrics.failedMessages++;

    if (message.state.errorCount < message.maxRetries) {
      // Retry with exponential backoff
      message.state.status = 'retrying';
      message.state.retryDelay *= 2;
      
      setTimeout(() => {
        message.state.status = 'pending';
        this.triggerProcessing(message.message.groupChatId);
      }, message.state.retryDelay);
    } else {
      // Max retries exceeded
      message.state.status = 'failed';
      message.state.endTime = Date.now();
      
      // Emit failure event
      this.eventCallbacks.onMessageProcessingFailed?.(message.message._id, error.message);
    }

    // Clean up processing state
    this.cleanupProcessingState(message, groupQueue);
  }

  // Resume interrupted message
  private resumeInterruptedMessage(message: PriorityMessage): void {
    if (message.state.status === 'interrupted') {
      message.state.status = 'pending';
      message.state.interruptionCount++;
      
      // Re-add to queue with adjusted priority
      message.priority += 10; // Boost priority for interrupted messages
      
      this.triggerProcessing(message.message.groupChatId);
    }
  }

  // Interrupt a currently processing message
  private interruptMessage(message: PriorityMessage, reason: string): void {
    if (message.state.status === 'processing') {
      message.state.status = 'interrupted';
      
      // Stop audio playback (would integrate with existing pauseMessage)
      // this.stopAudioPlayback(message.message._id);
      
      // Emit interruption event
      this.eventCallbacks.onMessageProcessingInterrupted?.(message.message._id, reason);
    }
  }

  // Continue processing after message completion
  private continueProcessing(groupQueue: GroupQueue): void {
    // Clean up current processing state
    groupQueue.processingState.isProcessing = false;
    groupQueue.processingState.currentMessageId = null;
    
    // Check for more messages to process
    const hasMoreMessages = groupQueue.messages.some(m => m.state.status === 'pending');
    
    if (hasMoreMessages) {
      // Continue with next message
      setTimeout(() => this.processMessages(groupQueue.groupId), 10);
    } else {
      // Queue is empty, emit completion event
      this.eventCallbacks.onQueueCompleted?.(groupQueue.groupId);
    }
  }

  // Clean up processing state
  private cleanupProcessingState(message: PriorityMessage, groupQueue: GroupQueue): void {
    groupQueue.currentProcessors.delete(message.state.currentProcessor!);
    message.state.currentProcessor = null;
  }

  // Get or create group queue
  private getOrCreateGroupQueue(groupId: string): GroupQueue {
    if (!this.groupQueues.has(groupId)) {
      const groupQueue: GroupQueue = {
        groupId,
        messages: [],
        backToBackGroups: new Map(),
        processingState: {
          isProcessing: false,
          currentMessageId: null,
          lastProcessedTime: 0,
          totalProcessed: 0,
          totalErrors: 0
        },
        interruptionHandlers: [],
        maxConcurrent: this.config.maxConcurrentPerGroup,
        currentProcessors: new Set(),
        lastProcessedTime: 0
      };
      this.groupQueues.set(groupId, groupQueue);
    }
    return this.groupQueues.get(groupId)!;
  }

  // Generate back-to-back group ID
  private generateBackToBackGroupId(senderId: string): string {
    return `back_to_back_${senderId}_${Date.now()}`;
  }

  // Find existing back-to-back group
  private findBackToBackGroup(senderId: string, groupId: string): string | null {
    const groupQueue = this.groupQueues.get(groupId);
    if (!groupQueue) return null;

    for (const [groupId, backToBackGroup] of groupQueue.backToBackGroups) {
      if (backToBackGroup.senderId === senderId && backToBackGroup.status === 'active') {
        return groupId;
      }
    }
    return null;
  }

  // Recalculate back-to-back group priority
  private recalculateBackToBackGroupPriority(groupId: string, chatGroupId: string): void {
    const groupQueue = this.groupQueues.get(chatGroupId);
    if (!groupQueue) return;

    const backToBackGroup = groupQueue.backToBackGroups.get(groupId);
    if (!backToBackGroup) return;

    // Calculate new priority based on all messages in the group
    const totalPriority = backToBackGroup.messages.reduce((sum, msg) => sum + msg.priority, 0);
    backToBackGroup.priority = totalPriority / backToBackGroup.messages.length;
  }

  // Get sender priority (placeholder)
  private getSenderPriority(senderId: string): number {
    // This could be based on user importance, relationship, etc.
    return 5; // Default priority
  }

  // Check if sender is high priority
  private isHighPrioritySender(senderId: string): boolean {
    // This could be based on user importance, relationship, etc.
    return false; // Default to false
  }

  // Clear queue for a group
  clearQueue(groupId: string): void {
    const groupQueue = this.groupQueues.get(groupId);
    if (groupQueue) {
      groupQueue.messages = [];
      groupQueue.backToBackGroups.clear();
      groupQueue.processingState.isProcessing = false;
      groupQueue.processingState.currentMessageId = null;
      groupQueue.currentProcessors.clear();
      groupQueue.interruptionHandlers = [];
    }
  }

  // Get queue status for a group
  getQueueStatus(groupId: string): {
    messageCount: number;
    backToBackGroups: number;
    isProcessing: boolean;
    currentMessageId: string | null;
  } {
    const groupQueue = this.groupQueues.get(groupId);
    if (!groupQueue) {
      return {
        messageCount: 0,
        backToBackGroups: 0,
        isProcessing: false,
        currentMessageId: null
      };
    }

    return {
      messageCount: groupQueue.messages.length,
      backToBackGroups: groupQueue.backToBackGroups.size,
      isProcessing: groupQueue.processingState.isProcessing,
      currentMessageId: groupQueue.processingState.currentMessageId
    };
  }

  // Get metrics
  getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }

  // Reset metrics
  resetMetrics(): void {
    this.metrics = {
      totalMessages: 0,
      processedMessages: 0,
      failedMessages: 0,
      averageProcessingTime: 0,
      backToBackGroups: 0,
      interruptions: 0
    };
  }

  // Cleanup resources
  cleanup(): void {
    // Clear all queues
    this.groupQueues.clear();
    
    // Unload cached audio
    this.audioCache.forEach(sound => {
      sound.unloadAsync().catch(console.warn);
    });
    this.audioCache.clear();
    
    // Reset metrics
    this.resetMetrics();
  }
}

// Export the class
export default ScalableMessageQueue; 