const { getCollection } = require('../database/collections');
const { ObjectId } = require('mongodb');

/**
 * Background Message Queue for handling heavy operations
 * without blocking the main response
 */
class MessageQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
    this.maxConcurrent = 5;
    this.activeJobs = 0;
    this.stats = {
      processed: 0,
      failed: 0,
      retried: 0,
      avgProcessingTime: 0
    };
  }

  /**
   * Add a job to the queue
   */
  addJob(job) {
    const jobWithId = {
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...job,
      createdAt: new Date(),
      retries: 0,
      status: 'pending'
    };

    this.queue.push(jobWithId);
    console.log('[MessageQueue] Job added to queue:', {
      jobId: jobWithId.id,
      type: job.type,
      queueLength: this.queue.length
    });

    // Start processing if not already running
    this.processQueue();
    return jobWithId.id;
  }

  /**
   * Process the queue
   */
  async processQueue() {
    if (this.isProcessing || this.activeJobs >= this.maxConcurrent) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && this.activeJobs < this.maxConcurrent) {
      const job = this.queue.shift();
      if (!job) continue;

      this.activeJobs++;
      job.status = 'processing';
      job.startedAt = new Date();

      console.log('[MessageQueue] Processing job:', {
        jobId: job.id,
        type: job.type,
        activeJobs: this.activeJobs,
        queueLength: this.queue.length
      });

      // Process job in background
      this.processJob(job).catch(error => {
        console.error('[MessageQueue] Job processing error:', {
          jobId: job.id,
          type: job.type,
          error: error.message
        });
      });
    }

    this.isProcessing = false;
  }

  /**
   * Process a single job
   */
  async processJob(job) {
    const startTime = Date.now();

    try {
      switch (job.type) {
        case 'cache_invalidation':
          await this.handleCacheInvalidation(job);
          break;
        case 'unread_count_update':
          await this.handleUnreadCountUpdate(job);
          break;
        case 'transcription_processing':
          await this.handleTranscriptionProcessing(job);
          break;
        case 'message_delivery_tracking':
          await this.handleMessageDeliveryTracking(job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      // Job completed successfully
      job.status = 'completed';
      job.completedAt = new Date();
      job.processingTime = Date.now() - startTime;

      this.stats.processed++;
      this.updateAverageProcessingTime(job.processingTime);

      console.log('[MessageQueue] Job completed successfully:', {
        jobId: job.id,
        type: job.type,
        processingTime: job.processingTime
      });

    } catch (error) {
      // Handle job failure
      job.status = 'failed';
      job.error = error.message;
      job.failedAt = new Date();

      this.stats.failed++;

      console.error('[MessageQueue] Job failed:', {
        jobId: job.id,
        type: job.type,
        error: error.message,
        retries: job.retries
      });

      // Retry logic
      if (job.retries < this.maxRetries) {
        job.retries++;
        job.status = 'pending';
        job.error = null;
        job.failedAt = null;

        this.stats.retried++;

        // Add back to queue with delay
        setTimeout(() => {
          this.queue.unshift(job);
          this.processQueue();
        }, this.retryDelay * job.retries);

        console.log('[MessageQueue] Job queued for retry:', {
          jobId: job.id,
          type: job.type,
          retry: job.retries,
          delay: this.retryDelay * job.retries
        });
      } else {
        console.error('[MessageQueue] Job failed permanently after max retries:', {
          jobId: job.id,
          type: job.type,
          maxRetries: this.maxRetries
        });
      }
    } finally {
      this.activeJobs--;
      
      // Continue processing if there are more jobs
      if (this.queue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  /**
   * Handle cache invalidation job
   */
  async handleCacheInvalidation(job) {
    const { cacheKeys, groupChatId } = job.data;
    
    const { invalidateCache, voiceMessageCache } = require('../utils/redisClient');
    
    await Promise.all([
      ...cacheKeys.map(key => invalidateCache(key)),
      voiceMessageCache.invalidateMessageCache(groupChatId)
    ]);

    console.log('[MessageQueue] Cache invalidation completed:', {
      jobId: job.id,
      cacheKeys,
      groupChatId
    });
  }

  /**
   * Handle unread count update job
   */
  async handleUnreadCountUpdate(job) {
    const { groupChatId, userId, increment } = job.data;
    
    const { incrementUserUnreadCount } = require('../index');
    
    const newCount = await incrementUserUnreadCount(groupChatId, userId);
    
    // Emit unread count update via socket
    const io = require('../socket').getIO();
    if (io) {
      io.to(userId).emit('unread_count_update', {
        chatId: groupChatId,
        userId,
        unreadCount: newCount
      });
    }

    console.log('[MessageQueue] Unread count update completed:', {
      jobId: job.id,
      groupChatId,
      userId,
      newCount
    });
  }

  /**
   * Handle transcription processing job
   */
  async handleTranscriptionProcessing(job) {
    const { messageId, audioUrl, groupChatId } = job.data;
    
    const { startTranscription } = require('../index');
    
    const jobName = await startTranscription(messageId, audioUrl, groupChatId);
    
    // Update message with job name
    const recordedMessagesCollection = getCollection('recordedMessages');
    await recordedMessagesCollection.updateOne(
      { _id: new ObjectId(messageId) },
      { $set: { jobName } }
    );

    console.log('[MessageQueue] Transcription processing started:', {
      jobId: job.id,
      messageId,
      jobName
    });
  }

  /**
   * Handle message delivery tracking job
   */
  async handleMessageDeliveryTracking(job) {
    const { messageId, deliveryTracking } = job.data;
    
    const recordedMessagesCollection = getCollection('recordedMessages');
    
    await recordedMessagesCollection.updateOne(
      { _id: new ObjectId(messageId) },
      { 
        $set: { 
          deliveryTracking,
          requiresAcknowledgment: true
        }
      }
    );

    console.log('[MessageQueue] Message delivery tracking completed:', {
      jobId: job.id,
      messageId,
      recipientCount: deliveryTracking.recipients.length
    });
  }

  /**
   * Update average processing time
   */
  updateAverageProcessingTime(processingTime) {
    this.stats.avgProcessingTime = 
      (this.stats.avgProcessingTime * (this.stats.processed - 1) + processingTime) / this.stats.processed;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      activeJobs: this.activeJobs,
      isProcessing: this.isProcessing
    };
  }

  /**
   * Clear the queue (for testing/debugging)
   */
  clear() {
    this.queue = [];
    this.isProcessing = false;
    this.activeJobs = 0;
    console.log('[MessageQueue] Queue cleared');
  }
}

// Create singleton instance
const messageQueue = new MessageQueue();

module.exports = {
  MessageQueue,
  messageQueue
}; 