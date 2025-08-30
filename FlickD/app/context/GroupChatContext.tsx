import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { AppState, Alert } from 'react-native';

const API_URL = Constants.expoConfig?.extra?.API_URL;

// Type definitions
export interface GroupChatMember {
  userId: string;
  name: string;
  joinedAt: string;
}

export interface Message {
  _id: string;
  groupChatId: string;
  senderId: string;
  content?: string;
  audioUrl?: string;
  mediaUrl?: string;
  transcription?: string;
  type: 'text' | 'voice' | 'image' | 'video';
  timestamp: string;
  isRead: boolean;
  isDelivered: boolean;
  readBy?: Record<string, string>;
  deliveredTo?: string[];
  processingStatus?: 'processing' | 'ready' | 'failed';
  duration?: number;
  jobName?: string;
  completedAt?: string;
  clientTempId?: string;
}

export interface GroupChat {
  _id: string;
  name: string;
  createdBy: string;
  members: GroupChatMember[];
  unreadCount?: number;
  lastMessage?: Message;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
}

// Recording state interface
export interface RecordingState {
  groupId: string;
  recordingUsers: string[];
  isAnyoneRecording: boolean;
  startedBy?: string;
  stoppedBy?: string;
  disconnectedUser?: string;
  resetBy?: string;
  leftUser?: string;
  removedUser?: string;
  transferredFrom?: string;
}

interface GroupChatContextProps {
  groupChats: GroupChat[];
  selectedChat: GroupChat | null;
  messages: Message[];
  socket: Socket | null;
  isNavigating: boolean;
  setIsNavigating: React.Dispatch<React.SetStateAction<boolean>>;
  fetchGroupChats: (userId?: string) => Promise<void>;
  fetchMessages: (groupId: string, preload?: boolean, priority?: boolean) => Promise<void>;
  fetchOlderMessages: (groupId: string) => Promise<boolean>;
  selectGroupChat: (chat: GroupChat) => Promise<void>;
  markMessageAsRead: (message: Message) => Promise<void>;
  markMessageAsViewed: (message: Message) => Promise<void>;
  markMessageAsDelivered: (message: Message) => Promise<void>;
  updateUnreadCount: (groupChatId: string, delta: number) => void;
  setGroupChats: React.Dispatch<React.SetStateAction<GroupChat[]>>;
  setSelectedChat: React.Dispatch<React.SetStateAction<GroupChat | null>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  updateGroup: (groupId: string, updates: Partial<GroupChat>) => Promise<void>;
  debugRooms: () => void;
  testReadReceipt: (messageId: string) => void;
  debugResetUnreadCount: () => Promise<void>;
  testTranscriptionReady: () => Promise<void>;
  clearGroupChatCache: (groupId?: string) => Promise<void>;
  isLoadingMessages: boolean;
  currentFetchingGroupId: string | null;
  onNewMessage?: (message: Message) => void; // Callback for new messages
  // Recording state management
  recordingStates: Map<string, RecordingState>;
  emitRecordingStart: (groupId: string) => void;
  emitRecordingStop: (groupId: string) => void;
  isAnyoneRecording: (groupId: string) => boolean;
  getRecordingUsers: (groupId: string) => string[];
  resetRecordingState: (groupId: string) => void;
}

const GroupChatContext = createContext<GroupChatContextProps | undefined>(undefined);

export const useGroupChatContext = () => {
  const context = useContext(GroupChatContext);
  if (!context) {
    throw new Error('useGroupChatContext must be used within a GroupChatProvider');
  }
  return context;
};

// Comprehensive logging function for socket events
const logSocketEvent = (event: string, data: any, level: 'info' | 'warn' | 'error' = 'info') => {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    event,
    ...data
  };
  
  switch (level) {
    case 'error':
      console.error(`[SOCKET-DEBUG][${timestamp}] ${event}:`, logData);
      break;
    case 'warn':
      console.warn(`[SOCKET-DEBUG][${timestamp}] ${event}:`, logData);
      break;
    default:
      console.log(`[SOCKET-DEBUG][${timestamp}] ${event}:`, logData);
  }
};

export const GroupChatProvider = ({ children, onNewMessage }: { children: ReactNode; onNewMessage?: (message: Message) => void }) => {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [groupChats, setGroupChats] = useState<GroupChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<GroupChat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isNavigating, setIsNavigating] = useState(false);
  const API_URL = Constants.expoConfig?.extra?.API_URL;
  const SOCKET_URL = API_URL ? API_URL.replace(/\/api$/, '') : 'https://api.justchit.chat';
  const alreadyMarkedRef = useRef(new Set());
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [currentFetchingGroupId, setCurrentFetchingGroupId] = useState<string | null>(null);
  const [allMessages, setAllMessages] = useState<{ [chatId: string]: Message[] }>({});
  const [recordingStates, setRecordingStates] = useState<Map<string, RecordingState>>(new Map());
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState<{ [chatId: string]: boolean }>({});
  const [hasMoreMessages, setHasMoreMessages] = useState<{ [chatId: string]: boolean }>({});
  const [currentPage, setCurrentPage] = useState<{ [chatId: string]: number }>({});

  // Check if we're in a reauth state (user has to sign in again)
  const isReauthing = isLoading || !isAuthenticated || !user;

  // ENHANCED: Separate debouncing references to prevent conflicts
  const lastChatChangeRef = useRef(0);
  const lastFetchMessagesRef = useRef(0);
  const lastFetchGroupChatsRef = useRef(0);
  const hasInitializedRef = useRef(false);

  // DIAGNOSTIC: Add logging to track context lifecycle and state changes
  const contextInstanceIdRef = useRef(Math.random().toString(36).substring(7));
  const mountTimeRef = useRef(Date.now());
  
  // Log context instance creation
  useEffect(() => {
    logSocketEvent('CONTEXT_INSTANCE_CREATED', {
      contextInstanceId: contextInstanceIdRef.current,
      mountTime: mountTimeRef.current,
      hasUser: !!user,
      userId: user?.userId,
      isAuthenticated,
      isLoading,
      isReauthing,
      reason: 'context_mounted_or_recreated'
    });
    
    return () => {
      logSocketEvent('CONTEXT_INSTANCE_DESTROYED', {
        contextInstanceId: contextInstanceIdRef.current,
        lifespan: Date.now() - mountTimeRef.current,
        reason: 'context_unmounted'
      });
    };
  }, []);

  // DIAGNOSTIC: Track every state change


  // ENHANCED: Cache cleanup function to prevent memory issues
  const cleanupOldCache = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const messageCacheKeys = keys.filter(key => key.startsWith('groupchat_messages_'));
      
      for (const key of messageCacheKeys) {
        try {
          const cachedData = await AsyncStorage.getItem(key);
          if (cachedData) {
            const parsedData = JSON.parse(cachedData);
            const cacheAge = Date.now() - (parsedData._cacheTimestamp || 0);
            
            // Remove cache older than 1 hour
            if (cacheAge > 60 * 60 * 1000) {
              await AsyncStorage.removeItem(key);
              console.log('[cleanupOldCache] Removed old cache:', key);
            }
          }
        } catch (error) {
          // Remove corrupted cache entries
          await AsyncStorage.removeItem(key);
          console.log('[cleanupOldCache] Removed corrupted cache:', key);
        }
      }
    } catch (error) {
      console.warn('[cleanupOldCache] Error cleaning cache:', error);
    }
  };

  // FIXED: Comprehensive cache cleanup function for logout
  const cleanupAllCaches = async () => {
    try {
      console.log('[cleanupAllCaches] Starting comprehensive cache cleanup');
      const keys = await AsyncStorage.getAllKeys();
      
      // Define all cache key patterns that should be cleaned on logout
      const cachePatterns = [
        'groupchat_messages_',
        'voice_message_',
        'recording_state_',
        'audio_cache_',
        'transcription_cache_',
        'user_preferences_',
        'chat_history_',
        'message_draft_',
        'temp_audio_',
        'playback_cache_'
      ];
      
      const cacheKeysToRemove = keys.filter(key => 
        cachePatterns.some(pattern => key.startsWith(pattern))
      );
      
      if (cacheKeysToRemove.length > 0) {
        console.log('[cleanupAllCaches] Found cache keys to remove:', cacheKeysToRemove);
        await AsyncStorage.multiRemove(cacheKeysToRemove);
        console.log('[cleanupAllCaches] ✅ Removed', cacheKeysToRemove.length, 'cache entries');
      } else {
        console.log('[cleanupAllCaches] No cache entries found to remove');
      }
      
      // Verify cleanup
      const remainingKeys = await AsyncStorage.getAllKeys();
      const remainingCacheKeys = remainingKeys.filter(key => 
        cachePatterns.some(pattern => key.startsWith(pattern))
      );
      
      if (remainingCacheKeys.length === 0) {
        console.log('[cleanupAllCaches] ✅ All cache entries successfully removed');
      } else {
        console.warn('[cleanupAllCaches] ⚠️ Some cache entries remain:', remainingCacheKeys);
      }
      
    } catch (error) {
      console.error('[cleanupAllCaches] ❌ Error during cache cleanup:', error);
    }
  };

  // ENHANCED: Cache restoration function for better login/logout handling
  const restoreMessageCache = async (groupId: string) => {
    try {
      const cacheKey = `groupchat_messages_${groupId}`;
      const cachedMessages = await AsyncStorage.getItem(cacheKey);
      
      if (cachedMessages) {
        const parsedMessages = JSON.parse(cachedMessages);
        const cacheAge = Date.now() - (parsedMessages._cacheTimestamp || 0);
        
        // Use cache if it's less than 10 minutes old (reduced for faster response)
        if (cacheAge < 10 * 60 * 1000) {
          console.log('[restoreMessageCache] Restoring cache for group:', groupId, 'age:', cacheAge);
          setAllMessages(prev => ({ ...prev, [groupId]: parsedMessages.messages || parsedMessages }));
          return true;
        }
      }
      return false;
    } catch (error) {
      console.warn('[restoreMessageCache] Error restoring cache:', error);
      return false;
    }
  };

  // ENHANCED: Single initialization effect - only fetch group chats once on user change
  useEffect(() => {
    if (user?.userId && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      fetchGroupChats(user.userId);
      // Clean up old cache on initialization
      cleanupOldCache().catch(err => console.warn('Cache cleanup failed:', err));
    } else if (!user?.userId) {
      // User signed out - reset everything
      console.log('[GroupChatContext] User signed out, clearing all recording states');
      hasInitializedRef.current = false;
      setGroupChats([]);
      setMessages([]);
      setSelectedChat(null);
      setRecordingStates(new Map());
      setAllMessages({});
      setCurrentPage({});
      setHasMoreMessages({});
      setUnreadCounts({});
      setIsLoadingMessages(false);
      setCurrentFetchingGroupId(null);
      setIsLoadingOlderMessages({});
      
      // FIXED: Comprehensive cache cleanup on logout
      cleanupAllCaches().catch(err => console.warn('Cache cleanup failed during logout:', err));
      
      // Disconnect socket if it exists
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
    }
  }, [user?.userId, socket]);

  // Initialize socket connection
  useEffect(() => {
    if (!user?.userId) {
      return;
    }

    const newSocket = io(SOCKET_URL, {
      auth: {
        userId: user.userId
      },
      query: {
        userId: user.userId
      },
      // Add reconnection settings for better reliability
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    // Socket connection events
    newSocket.on('connect', () => {
      console.log('[Socket] Connected successfully');
      
      // FIXED: Don't reset recording states on connection - only clear local state
      setRecordingStates(new Map());
    });

    newSocket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      
      // Clear local recording states on disconnect
      setRecordingStates(new Map());
    });

    // Add reconnection event handlers
    newSocket.on('reconnect', (attemptNumber) => {
      console.log('[Socket] Reconnected after', attemptNumber, 'attempts');
      
      // Re-join the current chat room after reconnection
      if (selectedChat) {
        newSocket.emit('join_chat', selectedChat._id);
      }
    });

    newSocket.on('reconnect_attempt', (attemptNumber) => {
      console.log('[Socket] Reconnection attempt', attemptNumber);
    });

    newSocket.on('reconnect_error', (error) => {
      console.error('[Socket] Reconnection error:', error);
    });

    newSocket.on('reconnect_failed', () => {
      console.error('[Socket] Reconnection failed after all attempts');
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [user?.userId]);

  // Join chat room when selected chat changes
  useEffect(() => {
    if (socket && selectedChat) {
      console.log('[Socket] Joining chat room:', selectedChat._id);
      socket.emit('join_chat', selectedChat._id);
      // Fetch messages for this chat
      fetchMessages(selectedChat._id, false, false);
    }
  }, [socket, selectedChat]);

  // Listen for chat join confirmation
  useEffect(() => {
    if (!socket) return;

    const handleChatJoined = (data: { groupId: string; success: boolean; error?: string }) => {
      if (data.success) {
      } else {
      }
    };

    const handleDebugRoomsResponse = (data: { rooms: string[] }) => {
      // Skip debug logging during navigation to reduce noise
      if (isNavigating) {
        return;
      }
    };

    socket.on('chat_joined', handleChatJoined);
    socket.on('debug_rooms_response', handleDebugRoomsResponse);

    return () => {
      socket.off('chat_joined', handleChatJoined);
      socket.off('debug_rooms_response', handleDebugRoomsResponse);
    };
  }, [socket]);

  // Listen for new messages
  useEffect(() => {
    if (!socket || !user?.userId) return;

    const handleNewMessage = (message: Message) => {
      // Add message to the list if it's for the current chat
      if (selectedChat?._id === message.groupChatId) {
        setMessages(prev => {
          // Check if message already exists to avoid duplicates
          const existingIndex = prev.findIndex(m => m._id === message._id);
          if (existingIndex !== -1) {
            // Update existing message only if the new message has more recent data
            const existingMessage = prev[existingIndex];
            const newMessage = {
              ...existingMessage,
              ...message,
              // Preserve existing read status if the new message doesn't have it
              isRead: message.isRead !== undefined ? message.isRead : existingMessage.isRead,
              readBy: { ...existingMessage.readBy, ...message.readBy }
            };
            const newMessages = [...prev];
            newMessages[existingIndex] = newMessage;
            return newMessages;
          }
          
          // Add new message and sort
          const newMessages = [...prev, message].sort((a, b) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          
          // Call the callback for animation if provided
          if (onNewMessage) {
            onNewMessage(message);
          }
          
          // Update cache with new message list (async, don't wait)
          const cacheKey = `groupchat_messages_${message.groupChatId}`;
          AsyncStorage.setItem(cacheKey, JSON.stringify(newMessages))
            .catch(err => {
              // Silent fail for cache updates
            });
          
          // Fetch fresh messages with priority for current chat to ensure immediate updates
          if (selectedChat?._id === message.groupChatId) {
            fetchMessages(message.groupChatId, false, true);
          }
          
          return newMessages;
        });

        // If this is a voice message from another user and we're in the chat, trigger playback
        if (message.type === 'voice' && 
            message.senderId !== user.userId && 
            !message.isRead && 
            message.audioUrl) {
        }
      }

      // Update allMessages map for preloading
      setAllMessages(prev => {
        const currentMessages = prev[message.groupChatId] || [];
        const existingIndex = currentMessages.findIndex(m => m._id === message._id);
        
        if (existingIndex !== -1) {
          // Update existing message
          const newMessages = [...currentMessages];
          newMessages[existingIndex] = message;
          return { ...prev, [message.groupChatId]: newMessages };
        }
        
        // Add new message and sort
        const newMessages = [...currentMessages, message].sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        
        return { ...prev, [message.groupChatId]: newMessages };
      });
    };

    socket.on('new_message', handleNewMessage);
    
    // Add error handling for socket events
    const handleSocketError = (error: any) => {
      console.error('[Socket] Socket error:', error);
    };
    
    socket.on('error', handleSocketError);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('error', handleSocketError);
    };
  }, [socket, user?.userId, selectedChat?._id, onNewMessage]);

  // REMOVED: Periodic message refresh - rely on socket events instead

  // Handle socket disconnection and reconnection
  useEffect(() => {
    if (!socket || !selectedChat) return;

    const handleDisconnect = () => {
      console.log('[Socket] Disconnected, will attempt to rejoin chat on reconnect');
    };

    const handleReconnect = () => {
      console.log('[Socket] Reconnected, rejoining chat:', selectedChat._id);
      socket.emit('join_chat', selectedChat._id);
      // Also fetch messages immediately after reconnection
      fetchMessages(selectedChat._id, false);
    };

    socket.on('disconnect', handleDisconnect);
    socket.on('reconnect', handleReconnect);

    return () => {
      socket.off('disconnect', handleDisconnect);
      socket.off('reconnect', handleReconnect);
    };
  }, [socket, selectedChat]);

  // Listen for message read updates
  useEffect(() => {
    if (!socket) return;

    const handleMessageReadUpdate = (data: { messageId: string; userId: string; timestamp: string; isFullyRead: boolean }) => {
      // Update messages state
      setMessages(prevMessages => {
        const updatedMessages = prevMessages.map(msg => {
          if (msg._id === data.messageId) {
            const updatedReadBy = {
              ...msg.readBy,
              [data.userId]: data.timestamp
            };
            const updatedMsg = {
              ...msg,
              readBy: updatedReadBy,
              isRead: data.isFullyRead
            };
            return updatedMsg;
          }
          return msg;
        });
        
        // Update cache with updated messages
        if (selectedChat?._id) {
          const cacheKey = `groupchat_messages_${selectedChat._id}`;
          AsyncStorage.setItem(cacheKey, JSON.stringify(updatedMessages))
            .catch(err => {
              // Silent fail for cache updates
            });
        }
        
        return updatedMessages;
      });

      // If this is the current user's read update, reset unread count
      if (data.userId === user?.userId) {
        setGroupChats(prevChats => 
          prevChats.map(chat =>
            chat._id === selectedChat?._id ? { ...chat, unreadCount: 0 } : chat
          )
        );
      }
    };

    socket.on('message_read_update', handleMessageReadUpdate);

    return () => {
      socket.off('message_read_update', handleMessageReadUpdate);
    };
  }, [socket, selectedChat, user?.userId]);

  // Listen for unread count updates
  useEffect(() => {
    if (!socket || !user?.userId) return;

    const handleUnreadCountUpdate = (data: { chatId: string; userId: string; unreadCount: number }) => {
      // Skip updates during navigation to prevent refresh
      if (isNavigating) {
        return;
      }
      
      // Only update unread count if it's for the current user
      if (data.userId === user.userId) {
        setGroupChats(prevChats => 
          prevChats.map(chat => {
            if (chat._id === data.chatId) {
              // If user is currently in this chat, keep unread count at 0
              if (selectedChat?._id === data.chatId) {
                return { ...chat, unreadCount: 0 };
              }
              // Otherwise, update with the server value
              return { ...chat, unreadCount: data.unreadCount };
            }
            return chat;
          })
        );
      }
    };

    socket.on('unread_count_update', handleUnreadCountUpdate);

    return () => {
      socket.off('unread_count_update', handleUnreadCountUpdate);
    };
  }, [socket, user?.userId, selectedChat?._id]);

  // Listen for group chat updates
  useEffect(() => {
    if (!socket || !user?.userId) return;

    const handleGroupMemberAdded = (data: { groupId: string; newMember: GroupChatMember }) => {
      setGroupChats(prevChats => 
        prevChats.map(chat => {
          if (chat._id === data.groupId) {
            // Check if member already exists to avoid duplicates
            const memberExists = chat.members.some(member => member.userId === data.newMember.userId);
            if (!memberExists) {
              return {
                ...chat,
                members: [...chat.members, data.newMember]
              };
            }
          }
          return chat;
        })
      );
      
      // Update selectedChat if it's the same group
      if (selectedChat?._id === data.groupId) {
        setSelectedChat(prev => {
          if (!prev) return prev;
          const memberExists = prev.members.some(member => member.userId === data.newMember.userId);
          if (!memberExists) {
            return {
              ...prev,
              members: [...prev.members, data.newMember]
            };
          }
          return prev;
        });
      }
    };

    const handleGroupMembersBatchAdded = (data: { groupId: string; newMembers: GroupChatMember[]; totalMembers: number }) => {
      setGroupChats(prevChats => 
        prevChats.map(chat => {
          if (chat._id === data.groupId) {
            // Filter out members that already exist to avoid duplicates
            const existingMemberIds = new Set(chat.members.map(m => m.userId));
            const newMembersToAdd = data.newMembers.filter(member => !existingMemberIds.has(member.userId));
            
            if (newMembersToAdd.length > 0) {
              return {
                ...chat,
                members: [...chat.members, ...newMembersToAdd]
              };
            }
          }
          return chat;
        })
      );
      
      // Update selectedChat if it's the same group
      if (selectedChat?._id === data.groupId) {
        setSelectedChat(prev => {
          if (!prev) return prev;
          const existingMemberIds = new Set(prev.members.map(m => m.userId));
          const newMembersToAdd = data.newMembers.filter(member => !existingMemberIds.has(member.userId));
          
          if (newMembersToAdd.length > 0) {
            return {
              ...prev,
              members: [...prev.members, ...newMembersToAdd]
            };
          }
          return prev;
        });
      }
    };

    const handleGroupMemberRemoved = (data: { groupId: string; removedUserId: string }) => {
      // If current user was removed, remove the group completely from their list
      if (data.removedUserId === user?.userId) {
        setGroupChats(prevChats => prevChats.filter(chat => chat._id !== data.groupId));
        
        // Clear selectedChat if it's the same group
        if (selectedChat?._id === data.groupId) {
          setSelectedChat(null);
          setMessages([]);
        }
        return;
      }
      
      // For other users being removed, just update the members list
      setGroupChats(prevChats => 
        prevChats.map(chat => {
          if (chat._id === data.groupId) {
            return {
              ...chat,
              members: chat.members.filter(member => member.userId !== data.removedUserId)
            };
          }
          return chat;
        })
      );
      
      // Update selectedChat if it's the same group
      if (selectedChat?._id === data.groupId) {
        setSelectedChat(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            members: prev.members.filter(member => member.userId !== data.removedUserId)
          };
        });
      }
    };

    const handleGroupMemberLeft = (data: { groupId: string; leftUserId: string }) => {
      // If current user left, remove the group completely from their list
      if (data.leftUserId === user?.userId) {
        setGroupChats(prevChats => prevChats.filter(chat => chat._id !== data.groupId));
        
        // Clear selectedChat if it's the same group
        if (selectedChat?._id === data.groupId) {
          setSelectedChat(null);
          setMessages([]);
        }
        return;
      }
      
      // For other users leaving, just update the members list
      setGroupChats(prevChats => 
        prevChats.map(chat => {
          if (chat._id === data.groupId) {
            return {
              ...chat,
              members: chat.members.filter(member => member.userId !== data.leftUserId)
            };
          }
          return chat;
        })
      );
      
      // Update selectedChat if it's the same group
      if (selectedChat?._id === data.groupId) {
        setSelectedChat(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            members: prev.members.filter(member => member.userId !== data.leftUserId)
          };
        });
      }
    };

    const handleGroupOwnershipTransferred = (data: { groupId: string; newCreatorId: string; newCreatorName: string }) => {
      setGroupChats(prevChats => 
        prevChats.map(chat => {
          if (chat._id === data.groupId) {
            return {
              ...chat,
              createdBy: data.newCreatorId
            };
          }
          return chat;
        })
      );
    };

    const handleGroupDeleted = (data: { groupId: string }) => {
      setGroupChats(prevChats => 
        prevChats.filter(chat => chat._id !== data.groupId)
      );
      
      // If the deleted group was selected, clear the selection
      if (selectedChat?._id === data.groupId) {
        setSelectedChat(null);
        setMessages([]);
      }
    };

    socket.on('group_member_added', handleGroupMemberAdded);
    socket.on('group_members_batch_added', handleGroupMembersBatchAdded);
    socket.on('group_member_removed', handleGroupMemberRemoved);
    socket.on('group_member_left', handleGroupMemberLeft);
    socket.on('group_ownership_transferred', handleGroupOwnershipTransferred);
    socket.on('group_deleted', handleGroupDeleted);

    return () => {
      socket.off('group_member_added', handleGroupMemberAdded);
      socket.off('group_members_batch_added', handleGroupMembersBatchAdded);
      socket.off('group_member_removed', handleGroupMemberRemoved);
      socket.off('group_member_left', handleGroupMemberLeft);
      socket.off('group_ownership_transferred', handleGroupOwnershipTransferred);
      socket.off('group_deleted', handleGroupDeleted);
    };
  }, [socket, user?.userId, selectedChat?._id]);

  // FIXED: Improved recording state management
  useEffect(() => {
    if (!socket) return;

    const handleRecordingStateUpdate = (data: RecordingState) => {
      console.log('[Socket] Recording state update:', data);
      
      // Handle different types of recording state updates
      if (data.resetBy) {
        console.log('[Socket] Recording state reset by:', data.resetBy);
        setRecordingStates(prev => {
          const newMap = new Map(prev);
          newMap.delete(data.groupId);
          return newMap;
        });
        return;
      }
      
      if (data.recordingUsers.length === 0 && !data.isAnyoneRecording) {
        console.log('[Socket] No users recording, clearing state for group:', data.groupId);
        setRecordingStates(prev => {
          const newMap = new Map(prev);
          newMap.delete(data.groupId);
          return newMap;
        });
        return;
      }
      
      // Update recording state
      setRecordingStates(prev => {
        const newStates = new Map(prev);
        newStates.set(data.groupId, data);
        return newStates;
      });
    };

    const handleRecordingStartRejected = (data: { groupId: string; reason: string; currentRecordingUsers: string[] }) => {
      // Show alert to user about recording being rejected
      Alert.alert(
        'Recording Blocked', 
        data.reason || 'Another user is currently recording. Please wait for them to finish.',
        [{ text: 'OK' }]
      );
      
      // Update the recording state to reflect current users
      setRecordingStates(prev => {
        const newStates = new Map(prev);
        newStates.set(data.groupId, {
          groupId: data.groupId,
          recordingUsers: data.currentRecordingUsers,
          isAnyoneRecording: data.currentRecordingUsers.length > 0
        });
        return newStates;
      });
    };

    socket.on('recording_state_update', handleRecordingStateUpdate);
    socket.on('recording_start_rejected', handleRecordingStartRejected);

    return () => {
      socket.off('recording_state_update', handleRecordingStateUpdate);
      socket.off('recording_start_rejected', handleRecordingStartRejected);
    };
  }, [socket]);

  // Reset unreadCount to 0 when entering a chat
  const selectGroupChat = async (chat: GroupChat) => {
    // ENHANCED: Don't re-select if already selected
    if (selectedChat?._id === chat._id) {
      console.log('[selectGroupChat] Already selected chat:', chat._id);
      return;
    }

    // ENHANCED: Add minimal debouncing to prevent rapid chat switching
    const timeSinceLastSelection = Date.now() - lastChatChangeRef.current;
    if (timeSinceLastSelection < 50) { // Reduced from 150ms to 50ms for faster response
      console.log('[selectGroupChat] Debouncing rapid chat selection:', chat._id);
      return;
    }
    
    lastChatChangeRef.current = Date.now();

    try {
      console.log('[selectGroupChat] Selecting chat:', chat._id);
      
      // CRITICAL FIX: Clean up recording state from previous chat before switching
      if (selectedChat && socket && user?.userId) {
        const previousChatId = selectedChat._id;
        const isPrevious2PersonChat = selectedChat.members && selectedChat.members.length === 2;
        
        // Leave recording queue from previous chat
        socket.emit('leave_recording_queue', {
          groupId: previousChatId,
          userId: user.userId
        });
        
        // Check if user was recording in previous chat
        const previousRecordingState = recordingStates.get(previousChatId);
        const wasUserRecording = previousRecordingState?.recordingUsers.includes(user.userId);
        
        if (wasUserRecording) {
          console.log('[selectGroupChat] User was recording, stopping recording for previous chat');
          socket.emit('recording_stop', { 
            groupId: previousChatId,
            userId: user.userId,
            reason: 'user_switched_chat'
          });
        }
      }
      
      // Set the selected chat first
      setSelectedChat(chat);
      setIsNavigating(true);

      // ENHANCED: Try to restore from cache first for instant UI
      const cacheRestored = await restoreMessageCache(chat._id);
      if (cacheRestored) {
        // Show cached messages immediately
        const cachedMessages = allMessages[chat._id] || [];
        setMessages(cachedMessages);
        console.log('[selectGroupChat] Showing cached messages:', cachedMessages.length);
      }

      // Fetch fresh messages in background
      await fetchMessages(chat._id, false, false);

      // Reset navigation state after a brief delay
      setTimeout(() => {
        setIsNavigating(false);
      }, 100);

    } catch (error) {
      console.error('[selectGroupChat] Error selecting chat:', error);
    }
  };

  // Do NOT reset unread count on unmount (this can hide messages incorrectly)
  useEffect(() => {
    if (!selectedChat || !user?.userId) return;

    // When user enters a chat, ensure unread count is 0
    setGroupChats(prevChats =>
      prevChats.map(chat =>
        chat._id === selectedChat._id ? { ...chat, unreadCount: 0 } : chat
      )
    );

    // No cleanup function needed here — unreadCount is handled only on enter
  }, [selectedChat, user?.userId]);

  // REMOVED: Mass recording state cleanup that was causing spam

  // Listen for transcription updates (live transcript/audio)
  useEffect(() => {
    if (!socket || !selectedChat) return;

    const handleTranscriptionReady = async ({ messageId, transcription }: { messageId: string, transcription: any }) => {
      // INSTANT UPDATE: Update transcription directly from socket data for immediate display
      setMessages((prevMessages) => {
        const idx = prevMessages.findIndex(
          msg => msg._id === messageId || (msg.clientTempId && msg.clientTempId === messageId)
        );
        
        if (idx !== -1) {
          const newMessages = [...prevMessages];
          // Update the message with the transcription data directly
          newMessages[idx] = { 
            ...newMessages[idx], 
            transcription,
            processingStatus: 'ready'
          };
          
          const sortedMessages = newMessages.sort((a, b) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          
          // Update cache with transcription update
          if (selectedChat?._id) {
            const cacheKey = `groupchat_messages_${selectedChat._id}`;
            AsyncStorage.setItem(cacheKey, JSON.stringify(sortedMessages))
              .catch(err => {
                // Silent fail for cache updates
              });
          }
          
          return sortedMessages;
        } else {
          return prevMessages;
        }
      });
      
      // BACKGROUND SYNC: Also fetch the complete updated message for any additional data
      try {
        const resp = await fetch(`${API_URL}/messages/db/${messageId}`);
        
        if (resp.ok) {
          const updatedMessage = await resp.json();
          
          // Only update if there are additional changes beyond transcription
          setMessages((prevMessages) => {
            const idx = prevMessages.findIndex(
              msg => msg._id === updatedMessage._id || (msg.clientTempId && updatedMessage.clientTempId && msg.clientTempId === updatedMessage.clientTempId)
            );
            
            if (idx !== -1) {
              const newMessages = [...prevMessages];
              // Merge any additional properties from database while preserving instant transcription
              newMessages[idx] = { 
                ...newMessages[idx], 
                ...updatedMessage,
                // Ensure transcription from live update is preserved if it's newer
                transcription: newMessages[idx].transcription || updatedMessage.transcription
              };
              
              const sortedMessages = newMessages.sort((a, b) => 
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
              );
              
              return sortedMessages;
            } else {
              // Message not in current list, add it
              const newMessages = [...prevMessages, updatedMessage];
              const sortedMessages = newMessages.sort((a, b) => 
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
              );
              return sortedMessages;
            }
          });
        } else {
        }
      } catch (err) {
      }
    };

    // Test socket connection
    const handleTestEvent = (data: any) => {
    };

    socket.on('transcription:ready', handleTranscriptionReady);
    socket.on('test', handleTestEvent);
    
    // Emit a test event to verify connection
    socket.emit('test', { message: 'Testing socket connection' });
    
    // Debug: Check if user is in the correct room
    setTimeout(() => {
    }, 1000);
    
    return () => {
      socket.off('transcription:ready', handleTranscriptionReady);
      socket.off('test', handleTestEvent);
    };
  }, [socket, selectedChat]);

  // REMOVED: Auto-refresh for messages - rely on socket events instead

  // REMOVED: Background sync intervals - rely on socket events instead

  // REMOVED: App state change listener - causing excessive calls

  // REMOVED: Preloading all messages - only fetch when needed

  // REMOVED: Additional background refresh - causing spam

  const fetchGroupChats = async (userId?: string) => {
    // FIXED: Reduce debounce time to prevent recording blocking
    const timeSinceLastFetch = Date.now() - lastFetchGroupChatsRef.current;
    if (timeSinceLastFetch < 500) { // Reduced from 5000ms to 500ms
      console.log('[fetchGroupChats] Debouncing rapid fetch request');
      return;
    }
    
    lastFetchGroupChatsRef.current = Date.now();
    
    try {
      console.log('[fetchGroupChats] Fetching group chats for user:', userId);
      const url = userId ? `${API_URL}/groupchats?userId=${userId}` : `${API_URL}/groupchats`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch group chats');
      const data = await response.json();
      
      const sortedData = data.sort((a: GroupChat, b: GroupChat) => {
        const dateA = new Date(a.lastMessageAt || a.createdAt);
        const dateB = new Date(b.lastMessageAt || b.createdAt);
        return dateB.getTime() - dateA.getTime();
      });
      
      setGroupChats(sortedData);
      console.log('[fetchGroupChats] Updated group chats:', sortedData.length);
    } catch (error) {
      console.error('[fetchGroupChats] Error fetching group chats:', error);
    }
  };

  // FIXED: Improved fetchMessages with better caching and pagination
  const fetchMessages = async (groupId: string, preload = false, priority = false) => {
    let shouldShowCache = false; // Declare at function level for proper scope
    
    // FIXED: Skip all preloading - only fetch when user opens chat
    if (preload) {
      console.log('[fetchMessages] Skipping preload request');
      return;
    }

    // Prevent duplicate requests
    if (isLoadingMessages && currentFetchingGroupId === groupId && !priority) {
      console.log('[fetchMessages] Skipping duplicate request for group:', groupId);
      return;
    }

    if (isLoadingMessages && currentFetchingGroupId !== groupId && !priority) {
      console.log('[fetchMessages] Skipping request - already loading different group:', currentFetchingGroupId);
      return;
    }

    // FIXED: Reduce debounce time to prevent recording blocking
    const lastRequestTime = lastFetchMessagesRef.current;
    const timeSinceLastRequest = Date.now() - lastRequestTime;
    
    if (timeSinceLastRequest < 300) { // Reduced from 2000ms to 300ms
      console.log('[fetchMessages] Debouncing rapid request for group:', groupId);
      return;
    }
    
    lastFetchMessagesRef.current = Date.now();

    try {
      setIsLoadingMessages(true);
      setCurrentFetchingGroupId(groupId);

      const cacheKey = `groupchat_messages_${groupId}`;

      // STEP 1: Check cache first
      const cachedMessages = await AsyncStorage.getItem(cacheKey);
      if (cachedMessages) {
        try {
          const parsedMessages = JSON.parse(cachedMessages);
          const cacheAge = Date.now() - (parsedMessages._cacheTimestamp || 0);
          
          // Use cache if less than 2 minutes old
          if (cacheAge < 2 * 60 * 1000) {
            console.log('[fetchMessages] Using cached messages for group:', groupId, 'age:', cacheAge);
            setMessages(parsedMessages.messages || parsedMessages);
            setAllMessages(prev => ({ ...prev, [groupId]: parsedMessages.messages || parsedMessages }));
            shouldShowCache = true;
            
            // If cache is very recent (less than 30 seconds), skip server fetch
            if (cacheAge < 30 * 1000) {
              console.log('[fetchMessages] Cache is very recent, skipping server fetch');
              return;
            }
          }
        } catch (cacheError) {
          console.warn('Cache parsing error:', cacheError);
        }
      }

      // STEP 2: Fetch from server
      console.log('[fetchMessages] Fetching latest 20 messages for group:', groupId);
      const response = await fetch(`${API_URL}/messages/${groupId}?userId=${user?.userId}&limit=20&page=1`);
      if (!response.ok) throw new Error('Failed to fetch messages');
      
      let data = await response.json();
      data = data.sort((a: Message, b: Message) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      // STEP 3: Update cache
      try {
        const cacheData = {
          messages: data,
          _cacheTimestamp: Date.now()
        };
        await AsyncStorage.setItem(cacheKey, JSON.stringify(cacheData));
        console.log('[fetchMessages] Updated cache for group:', groupId, 'messages:', data.length);
      } catch (cacheError) {
        console.warn('Cache update error:', cacheError);
      }
      
      // STEP 4: Update state
      setMessages(data);
      setAllMessages(prev => ({ ...prev, [groupId]: data }));
      
      // Initialize pagination state
      setCurrentPage(prev => ({ ...prev, [groupId]: 1 }));
      setHasMoreMessages(prev => ({ ...prev, [groupId]: data.length === 20 }));
      
      // Update unread count
      const unreadCount = data.filter((msg: any) => 
        msg.senderId !== user?.userId && !msg.isRead
      ).length;
      
      setGroupChats(prevChats => 
        prevChats.map(chat => 
          chat._id === groupId ? { ...chat, unreadCount } : chat
        )
      );
      
    } catch (error) {
      console.error('Error fetching messages:', error);
      if (!shouldShowCache) {
        setMessages([]);
      }
    } finally {
      setIsLoadingMessages(false);
      setCurrentFetchingGroupId(null);
    }
  };

  // Fetch older messages for infinite scroll
  const fetchOlderMessages = async (groupId: string): Promise<boolean> => {
    if (isLoadingOlderMessages[groupId] || hasMoreMessages[groupId] === false) {
      return false;
    }

    try {
      setIsLoadingOlderMessages(prev => ({ ...prev, [groupId]: true }));
      
      const page = (currentPage[groupId] || 1) + 1;
      const limit = 20;
      
      const response = await fetch(`${API_URL}/messages/${groupId}?userId=${user?.userId}&page=${page}&limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch older messages');
      
      const olderMessages = await response.json();
      
      if (olderMessages.length === 0) {
        setHasMoreMessages(prev => ({ ...prev, [groupId]: false }));
        return false;
      }

      // Filter out any duplicate messages to prevent issues
      setMessages(prevMessages => {
        const existingIds = new Set(prevMessages.map(msg => msg._id));
        const newMessages = olderMessages.filter((msg: Message) => !existingIds.has(msg._id));
        
        if (newMessages.length > 0) {
          const combined = [...prevMessages, ...newMessages];
          const sorted = combined.sort((a, b) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          
          return sorted;
        }
        
        return prevMessages;
      });

      // Update page number
      setCurrentPage(prev => ({ ...prev, [groupId]: page }));
      
      // Update cache with combined messages
      const cacheKey = `groupchat_messages_${groupId}`;
      const allChatMessages = allMessages[groupId] || [];
      const existingIds = new Set(allChatMessages.map(msg => msg._id));
      const newMessages = olderMessages.filter((msg: Message) => !existingIds.has(msg._id));
      
      if (newMessages.length > 0) {
        const combinedForCache = [...allChatMessages, ...newMessages];
        const sortedForCache = combinedForCache.sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        
        setAllMessages(prev => ({ ...prev, [groupId]: sortedForCache }));
        
        try {
          await AsyncStorage.setItem(cacheKey, JSON.stringify(sortedForCache));
        } catch (cacheError) {
        }
      }

      return true;
      
    } catch (error) {
      return false;
    } finally {
      setIsLoadingOlderMessages(prev => ({ ...prev, [groupId]: false }));
    }
  };

  const markMessageAsRead = async (message: Message) => {
    // Skip read receipt processing during reauth
    if (isReauthing) {
      return;
    }

    // Don't mark messages as read if they're from the current user
    if (message.senderId === user?.userId) {
      return;
    }

    if (!message.isRead && message.groupChatId && socket) {
      try {
        socket.emit('message_read', {
          messageId: message._id,
          userId: user?.userId,
          chatId: message.groupChatId
        });
      } catch (error) {
      }
    }
  };

  const markMessageAsViewed = async (message: Message) => {
    // Skip read receipt processing during reauth
    if (isReauthing) {
      return;
    }

    // Don't mark messages as viewed if they're from the current user
    if (message.senderId === user?.userId) {
      return;
    }

    // Don't process if already read by this user
    const isAlreadyRead = message.readBy && message.readBy[user?.userId || ''];
    if (isAlreadyRead) {
      return;
    }

    if (message.groupChatId && socket && user?.userId) {
      try {
        socket.emit('message_viewed', {
          messageId: message._id,
          userId: user.userId,
          chatId: message.groupChatId
        });
      } catch (error) {
      }
    }
  };

  const markMessageAsDelivered = async (message: Message) => {
    if (!message.isDelivered && message.groupChatId) {
      try {
        await fetch(`${API_URL}/messages/${message._id}/delivered`, { method: 'PUT' });
        setMessages(prevMessages => 
          prevMessages.map(msg => 
            msg._id === message._id ? { ...msg, isDelivered: true } : msg
          )
        );
      } catch (error) {
      }
    }
  };

  const updateUnreadCount = (groupChatId: string, delta: number) => {
    setGroupChats(prevChats => prevChats.map(chat =>
      chat._id === groupChatId && chat.unreadCount !== undefined
        ? { ...chat, unreadCount: Math.max(0, (chat.unreadCount || 0) + delta) }
        : chat
    ));
  };

  const updateGroup = async (groupId: string, updates: Partial<GroupChat>) => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      const response = await fetch(`${API_URL}/groupchats/${groupId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error('Failed to update group');
      }

      const updatedGroup = await response.json();
      
      // Update the group in the local state
      setGroupChats(prevChats => 
        prevChats.map(chat => 
          chat._id === groupId ? { ...chat, ...updatedGroup } : chat
        )
      );

      // Update selected chat if it's the one being modified
      if (selectedChat?._id === groupId) {
        setSelectedChat(prev => prev ? { ...prev, ...updatedGroup } : null);
      }
    } catch (error) {
    }
  };

  // Debug function to check room membership
  const debugRooms = () => {
    if (socket) {
      socket.emit('debug_rooms');
    }
  };

  // Test function to manually trigger read receipt
  const testReadReceipt = (messageId: string) => {
    if (socket && selectedChat && user?.userId) {
      socket.emit('test_read_receipt', {
        messageId,
        userId: user.userId,
        chatId: selectedChat._id
      });
    }
  };

  // Debug function to manually reset unread count for current chat
  const debugResetUnreadCount = async () => {
    if (!selectedChat || !user?.userId) return;
    
    try {
      const response = await fetch(`${API_URL}/groupchats/${selectedChat._id}/reset-unread?userId=${user.userId}`);
      if (response.ok) {
        await fetchGroupChats(user.userId);
      }
    } catch (error) {
    }
  };

  const testTranscriptionReady = async () => {
    if (!selectedChat || !messages.length) {
      return;
    }

    // Find a message with transcription
    const messageWithTranscription = messages.find(msg => msg.transcription);
    if (!messageWithTranscription) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/test/transcription-ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: messageWithTranscription._id,
          groupChatId: selectedChat._id
        })
      });

      if (response.ok) {
      } else {
      }
    } catch (error) {
    }
  };

  const clearGroupChatCache = async (groupId?: string) => {
    try {
      if (groupId) {
        // Clear cache for specific group
        const cacheKey = `groupchat_messages_${groupId}`;
        await AsyncStorage.removeItem(cacheKey);
        console.log('[clearGroupChatCache] Cleared cache for group:', groupId);
        
        // Also clear from memory
        setAllMessages(prev => {
          const newAllMessages = { ...prev };
          delete newAllMessages[groupId];
          return newAllMessages;
        });
      } else {
        // Clear all group chat caches
        const keys = await AsyncStorage.getAllKeys();
        const groupChatKeys = keys.filter(key => key.startsWith('groupchat_messages_'));
        if (groupChatKeys.length > 0) {
          await AsyncStorage.multiRemove(groupChatKeys);
          console.log('[clearGroupChatCache] Cleared all group chat caches:', groupChatKeys.length);
        }
        
        // Clear from memory
        setAllMessages({});
      }
    } catch (error) {
      console.error('[clearGroupChatCache] Error clearing cache:', error);
    }
  };

  const emitRecordingStart = (groupId: string) => {
    if (socket) {
      console.log('[SOCKET] 📡 Emitting recording_start:', { groupId, socketConnected: socket.connected });
      socket.emit('recording_start', { groupId });
    } else {
      console.log('[SOCKET] ❌ No socket available for recording_start');
    }
  };

  const emitRecordingStop = (groupId: string) => {
    if (socket) {
      socket.emit('recording_stop', { groupId });
    }
  };

  const isAnyoneRecording = (groupId: string) => {
    const state = recordingStates.get(groupId);
    return state?.isAnyoneRecording === true;
  };

  const getRecordingUsers = (groupId: string) => {
    const state = recordingStates.get(groupId);
    return state?.recordingUsers || [];
  };

  const resetRecordingState = (groupId: string) => {
    if (socket) {
      socket.emit('reset_recording_state', { groupId });
    }
  };

  // Auto-cleanup stuck recording states
  useEffect(() => {
    if (!selectedChat) return;

    const checkStuckRecordingState = () => {
      const state = recordingStates.get(selectedChat._id);
      if (!state) return;

      const recordingUsers = state.recordingUsers || [];
      const currentUserInRecording = recordingUsers.includes(user?.userId || '');
      
      // Case 1: isAnyoneRecording is true but no users are recording (stuck state)
      if (state.isAnyoneRecording && recordingUsers.length === 0) {
        resetRecordingState(selectedChat._id);
      }
      
      // Case 2: Current user is shown as recording but not actually recording (mismatch)
      if (currentUserInRecording && !state.isAnyoneRecording) {
        resetRecordingState(selectedChat._id);
      }
      
      // Case 3: CRITICAL FIX: If no one is recording but state shows someone is, reset
      if (state.isAnyoneRecording && recordingUsers.length === 0) {
        console.log('[GroupChatContext] Detected stuck recording state, resetting');
        resetRecordingState(selectedChat._id);
      }
      
      // Case 4: CRITICAL FIX: If current user is in recording list but shouldn't be (after logout/login)
      if (currentUserInRecording && user?.userId && !state.isAnyoneRecording) {
        console.log('[GroupChatContext] Current user incorrectly shown as recording, resetting');
        resetRecordingState(selectedChat._id);
      }
    };

    // Check immediately when chat is selected
    checkStuckRecordingState();

    // PERFORMANCE OPTIMIZED: Set up periodic check every 30 seconds
    const interval = setInterval(checkStuckRecordingState, 30000);

    return () => {
      clearInterval(interval);
    };
  }, [selectedChat?._id, recordingStates, resetRecordingState, user?.userId]);

  // CRITICAL FIX: Global cleanup of stuck recording states across all chats
  const recordingStatesRef = useRef(recordingStates);
  recordingStatesRef.current = recordingStates;
  const groupChatsRef = useRef(groupChats);
  groupChatsRef.current = groupChats;

  useEffect(() => {
    const checkAllStuckRecordingStates = () => {
      recordingStatesRef.current.forEach((state, groupId) => {
        const recordingUsers = state.recordingUsers || [];
        const currentUserInRecording = recordingUsers.includes(user?.userId || '');
        const is2PersonChat = groupChatsRef.current.find(chat => chat._id === groupId)?.members?.length === 2;
        
        // Case 1: isAnyoneRecording is true but no users are recording (stuck state)
        if (state.isAnyoneRecording && recordingUsers.length === 0) {
          console.log('[GroupChatContext] Global cleanup: Detected stuck recording state, resetting:', groupId);
          resetRecordingState(groupId);
        }
        
        // Case 2: Current user is shown as recording but not actually recording (mismatch)
        if (currentUserInRecording && !state.isAnyoneRecording) {
          console.log('[GroupChatContext] Global cleanup: Current user incorrectly shown as recording, resetting:', groupId);
          resetRecordingState(groupId);
        }
        
        // Case 3: For 2-person chats, if anyone is recording but no users in list, reset
        if (is2PersonChat && state.isAnyoneRecording && recordingUsers.length === 0) {
          console.log('[GroupChatContext] Global cleanup: 2-person chat stuck recording state, resetting:', groupId);
          resetRecordingState(groupId);
        }
      });
    };

    // Only check periodically, not on every recording state change
    const interval = setInterval(checkAllStuckRecordingStates, 60000);

    return () => {
      clearInterval(interval);
    };
  }, [user?.userId, resetRecordingState]); // Removed recordingStates and groupChats from dependencies

  // FIXED: Simplified user change handling - only clear local recording states
  useEffect(() => {
    if (user?.userId) {
      // User has signed in - clear any stale recording states
      console.log('[GroupChatContext] User signed in, clearing stale recording states');
      setRecordingStates(new Map());
    } else {
      // User has signed out - clear all recording states
      console.log('[GroupChatContext] User signed out, clearing all recording states');
      setRecordingStates(new Map());
    }
  }, [user?.userId]);

  // CRITICAL FIX: Clean up recording state when component unmounts or user changes
  useEffect(() => {
    return () => {
      // Cleanup function that runs when component unmounts or user changes
      if (socket && user?.userId) {
        console.log('[GroupChatContext] Cleaning up recording states on unmount/change');
        
        // Clean up recording state from all chats
        recordingStates.forEach((state, groupId) => {
          const isUserRecording = state.recordingUsers.includes(user.userId);
          const is2PersonChat = groupChats.find(chat => chat._id === groupId)?.members?.length === 2;
          
          if (isUserRecording || (is2PersonChat && state.isAnyoneRecording)) {
            console.log('[GroupChatContext] Cleaning up recording state on unmount:', groupId);
            
            // Stop recording for this user
            socket.emit('recording_stop', { 
              groupId: groupId,
              userId: user.userId,
              reason: 'component_unmount'
            });
            
            // For 2-person chats, reset recording state to free mic for other user
            if (is2PersonChat) {
              socket.emit('reset_recording_state', { groupId: groupId });
            }
          }
          
          // Leave recording queue from all chats
          socket.emit('leave_recording_queue', {
            groupId: groupId,
            userId: user.userId
          });
        });
      }
    };
  }, [socket, user?.userId]); // Removed recordingStates and groupChats from dependencies

  // FIXED: Simplified app state change handling - only handle critical cases
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      // Only handle app termination - don't be aggressive with background/foreground
      if (nextAppState === 'unknown') {
        console.log('[GroupChatContext] App being terminated, cleaning up recording states');
        
        // Only clean up if user is actually recording in selected chat
        if (socket && user?.userId && selectedChat) {
          const state = recordingStates.get(selectedChat._id);
          const isUserRecording = state?.recordingUsers.includes(user.userId);
          
          if (isUserRecording) {
            console.log('[GroupChatContext] Stopping recording on app termination');
            socket.emit('recording_stop', { 
              groupId: selectedChat._id,
              userId: user.userId,
              reason: 'app_termination'
            });
          }
        }
      }
    };

    // Listen for app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription?.remove();
    };
  }, [user?.userId, socket, selectedChat, recordingStates]);

  const value = {
    groupChats,
    selectedChat,
    messages,
    socket,
    isNavigating,
    setIsNavigating,
    fetchGroupChats,
    fetchMessages,
    fetchOlderMessages,
    selectGroupChat,
    markMessageAsRead,
    markMessageAsViewed,
    markMessageAsDelivered,
    updateUnreadCount,
    setGroupChats,
    setSelectedChat,
    setMessages,
    updateGroup,
    debugRooms,
    testReadReceipt,
    debugResetUnreadCount,
    testTranscriptionReady,
    clearGroupChatCache,
    isLoadingMessages,
    currentFetchingGroupId,
    onNewMessage,
    recordingStates,
    emitRecordingStart,
    emitRecordingStop,
    isAnyoneRecording,
    getRecordingUsers,
    resetRecordingState,
  };

  return (
    <GroupChatContext.Provider value={value}>
      {children}
    </GroupChatContext.Provider>
  );
};