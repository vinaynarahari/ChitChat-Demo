import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useGroupChatContext } from './GroupChatContext';
import { useAuth } from './AuthContext';

interface CaughtUpContextType {
  caughtUpUsers: { [groupId: string]: string[] };
  updateCaughtUpStatus: (groupId: string, userId: string, hasCaughtUp: boolean) => void;
  getCaughtUpUsers: (groupId: string) => string[];
  isUserCaughtUp: (groupId: string, userId: string) => boolean;
  refreshCaughtUpStatus: (groupId: string) => Promise<void>;
}

const CaughtUpContext = createContext<CaughtUpContextType | undefined>(undefined);

export const useCaughtUp = () => {
  const context = useContext(CaughtUpContext);
  if (!context) {
    throw new Error('useCaughtUp must be used within a CaughtUpProvider');
  }
  return context;
};

interface CaughtUpProviderProps {
  children: React.ReactNode;
}

export const CaughtUpProvider: React.FC<CaughtUpProviderProps> = ({ children }) => {
  const [caughtUpUsers, setCaughtUpUsers] = useState<{ [groupId: string]: string[] }>({});
  const { selectedChat, messages } = useGroupChatContext();
  const { user } = useAuth();
  const lastMessageIdRef = useRef<string | null>(null);

  // Update caught up status when messages change
  useEffect(() => {
    if (!selectedChat || !messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage._id === lastMessageIdRef.current) return;

    lastMessageIdRef.current = lastMessage._id;
    
    // Check which users have read the last message
    const usersWhoReadLastMessage = Object.keys(lastMessage.readBy || {});
    
    // Update caught up status for users who read the last message
    setCaughtUpUsers(prev => ({
      ...prev,
      [selectedChat._id]: usersWhoReadLastMessage
    }));
  }, [selectedChat?._id, messages]);

  const updateCaughtUpStatus = (groupId: string, userId: string, hasCaughtUp: boolean) => {
    setCaughtUpUsers(prev => {
      const currentUsers = prev[groupId] || [];
      
      if (hasCaughtUp) {
        // Add user if not already in the list
        if (!currentUsers.includes(userId)) {
          return {
            ...prev,
            [groupId]: [...currentUsers, userId]
          };
        }
      } else {
        // Remove user if in the list
        if (currentUsers.includes(userId)) {
          return {
            ...prev,
            [groupId]: currentUsers.filter(id => id !== userId)
          };
        }
      }
      
      return prev;
    });
  };

  const getCaughtUpUsers = (groupId: string): string[] => {
    return caughtUpUsers[groupId] || [];
  };

  const isUserCaughtUp = (groupId: string, userId: string): boolean => {
    return (caughtUpUsers[groupId] || []).includes(userId);
  };

  const refreshCaughtUpStatus = async (groupId: string): Promise<void> => {
    if (!selectedChat || selectedChat._id !== groupId || !messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return;

    const usersWhoReadLastMessage = Object.keys(lastMessage.readBy || {});
    
    setCaughtUpUsers(prev => ({
      ...prev,
      [groupId]: usersWhoReadLastMessage
    }));
  };

  const value: CaughtUpContextType = {
    caughtUpUsers,
    updateCaughtUpStatus,
    getCaughtUpUsers,
    isUserCaughtUp,
    refreshCaughtUpStatus,
  };

  return (
    <CaughtUpContext.Provider value={value}>
      {children}
    </CaughtUpContext.Provider>
  );
}; 