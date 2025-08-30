import Redis from 'ioredis';
import Constants from 'expo-constants';

interface VoiceMessageData {
  audioUrl: string;
  duration: number;
  senderId: string;
  timestamp: number;
  isDelivered?: boolean;
  isRead?: boolean;
  readBy?: string[];
  deliveredTo?: string[];
}

interface MessageStatus {
  isDelivered: boolean;
  isRead: boolean;
  readBy: string[];
  deliveredTo: string[];
}

interface PlaybackState {
  isPlaying: boolean;
  position: number;
  lastUpdated: number;
}

interface GroupChatInfo {
  lastMessageId: string | null;
  lastMessageAt: number;
  activeUsers: string[];
  unreadCount: Record<string, number>;
}

export class RedisService {
  private static instance: RedisService;
  private redis: Redis;

  private constructor() {
    const redisConfig = Constants.expoConfig?.extra;
    this.redis = new Redis({
      host: redisConfig?.redisHost,
      port: redisConfig?.redisPort,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      // Valkey-specific optimizations for client-side
      enableReadyCheck: true,
      connectTimeout: 10000,
      commandTimeout: 5000,
      keepAlive: 10000,
      // Enable auto-pipelining for better performance with Valkey
      enableAutoPipelining: true,
      // Optimize for Valkey's enhanced memory management
      maxRetriesPerRequest: 3,
      // Enable connection pooling
      family: 4,
      // Enable TLS if needed for Valkey
      tls: redisConfig?.redisTLS === 'true' ? {} : undefined
    });

    this.redis.on('error', (error) => {
      console.error('Redis connection error:', error);
    });
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  public async cacheVoiceMessage(messageId: string, data: VoiceMessageData, ttl: number): Promise<void> {
    await this.redis.setex(`voice:${messageId}`, ttl, JSON.stringify(data));
  }

  public async getVoiceMessage(messageId: string): Promise<VoiceMessageData | null> {
    const data = await this.redis.get(`voice:${messageId}`);
    return data ? JSON.parse(data) : null;
  }

  public async cacheMessageStatus(messageId: string, status: MessageStatus, ttl: number): Promise<void> {
    await this.redis.setex(`status:${messageId}`, ttl, JSON.stringify(status));
  }

  public async getMessageStatus(messageId: string): Promise<MessageStatus | null> {
    const data = await this.redis.get(`status:${messageId}`);
    return data ? JSON.parse(data) : null;
  }

  public async cachePlaybackState(messageId: string, state: PlaybackState, ttl: number): Promise<void> {
    await this.redis.setex(`playback:${messageId}`, ttl, JSON.stringify(state));
  }

  public async getPlaybackState(messageId: string): Promise<PlaybackState | null> {
    const data = await this.redis.get(`playback:${messageId}`);
    return data ? JSON.parse(data) : null;
  }

  public async cacheGroupChatInfo(groupId: string, info: GroupChatInfo, ttl: number): Promise<void> {
    await this.redis.setex(`group:${groupId}`, ttl, JSON.stringify(info));
  }

  public async getGroupChatInfo(groupId: string): Promise<GroupChatInfo | null> {
    const data = await this.redis.get(`group:${groupId}`);
    return data ? JSON.parse(data) : null;
  }

  public async deleteMessage(messageId: string): Promise<void> {
    await Promise.all([
      this.redis.del(`voice:${messageId}`),
      this.redis.del(`status:${messageId}`),
      this.redis.del(`playback:${messageId}`)
    ]);
  }

  public async deleteGroupChat(groupId: string): Promise<void> {
    await this.redis.del(`group:${groupId}`);
  }
} 