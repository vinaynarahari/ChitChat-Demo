import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
    FadeIn,
    FadeOut
} from 'react-native-reanimated';
import { useAuth } from '../app/context/AuthContext';
import { getAvatarColor, getInitials } from '../app/utils/avatarUtils';

interface GroupMember {
  userId: string;
  name: string;
}

interface Message {
  _id: string;
  senderId: string;
  readBy?: { [userId: string]: Date | string };
  timestamp: string;
}

interface GroupReadReceiptsProps {
  messages: Message[];
  groupMembers: GroupMember[];
  currentUserId: string;
  isVisible: boolean;
}

const THEME = {
  accentBlue: '#26A7DE',
  white: '#FFFFFF',
  darkGray: '#2C2C2E',
  lightGray: '#48484A',
};

export default function GroupReadReceipts({
  messages,
  groupMembers,
  currentUserId,
  isVisible,
}: GroupReadReceiptsProps) {
  const { accessToken, isLoading, isAuthenticated } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [modalUsers, setModalUsers] = useState<GroupMember[]>([]);
  
  // Use ref to track the last processed data to prevent unnecessary re-renders
  const lastProcessedRef = useRef<{
    messageId: string;
    readByHash: string;
    hash: string;
  }>({
    messageId: '',
    readByHash: '',
    hash: ''
  });

  // Check if we're in a reauth state
  const isReauthing = isLoading || !isAuthenticated || !accessToken;

  // STABLE: Extract only the relevant data from messages to prevent unnecessary re-renders
  const latestMessageData = useMemo(() => {
    if (!messages?.length) return null;
    
    const latestMessage = messages[0];
    if (!latestMessage) return null;
    
    return {
      messageId: latestMessage._id,
      readBy: latestMessage.readBy || {},
      readByHash: JSON.stringify(latestMessage.readBy || {})
    };
  }, [messages]);

  // STABLE: Extract other members count to prevent unnecessary re-renders
  const otherMembersData = useMemo(() => {
    if (!groupMembers?.length || !currentUserId) return null;
    
    const otherMembers = groupMembers.filter(member => member.userId !== currentUserId);
    return {
      members: otherMembers,
      count: otherMembers.length
    };
  }, [groupMembers, currentUserId]);

  // STABLE: Display state that only updates when there's a real change
  const [displayData, setDisplayData] = useState<{
    users: GroupMember[];
    count: number;
    hash: string;
  } | null>(null);

  // Process the read receipts data and only update when there's a real change
  useEffect(() => {
    // Early returns for invalid states
    if (isReauthing || !isVisible || !latestMessageData || !otherMembersData) {
      // Clear display if no data and we currently have data
      if (displayData !== null) {
        setDisplayData(null);
        lastProcessedRef.current = { messageId: '', readByHash: '', hash: '' };
      }
      return;
    }

    // For 2-person chats, don't show group read receipts (they use checkmarks)
    if (otherMembersData.count <= 1) {
      if (displayData !== null) {
        setDisplayData(null);
        lastProcessedRef.current = { messageId: '', readByHash: '', hash: '' };
      }
      return;
    }

    // Create stable identifiers for change detection
    const currentData = {
      messageId: latestMessageData.messageId,
      readByHash: latestMessageData.readByHash,
      hash: `${latestMessageData.messageId}-${latestMessageData.readByHash}`
    };

    // Only process if something actually changed
    if (
      lastProcessedRef.current.messageId === currentData.messageId &&
      lastProcessedRef.current.readByHash === currentData.readByHash &&
      lastProcessedRef.current.hash === currentData.hash
    ) {
      // Data hasn't changed, don't update
      return;
    }

    // Data has changed, process the new read receipts
    const caughtUpUsers = otherMembersData.members.filter(member => {
      const readTimestamp = latestMessageData.readBy[member.userId];
      return readTimestamp && (
        readTimestamp instanceof Date || 
        (typeof readTimestamp === 'string' && readTimestamp.length > 0)
      );
    });

    // Update the last processed data
    lastProcessedRef.current = currentData;

    if (caughtUpUsers.length === 0) {
      // No users have caught up
      if (displayData !== null) {
        setDisplayData(null);
      }
    } else {
      // Users have caught up, update display
      const newHash = `${latestMessageData.messageId}-${caughtUpUsers.map(u => u.userId).sort().join(',')}`;
      
      setDisplayData({
        users: [...caughtUpUsers],
        count: caughtUpUsers.length,
        hash: newHash
      });
    }
  }, [
    // FIXED: Use stable extracted data instead of raw messages array
    latestMessageData,
    otherMembersData,
    isVisible,
    isReauthing,
    displayData // Include displayData to access previous state
  ]);

  const handlePress = useCallback(() => {
    if (displayData && displayData.users.length > 0) {
      setShowModal(true);
      setModalUsers([...displayData.users]);
    }
  }, [displayData]);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    setModalUsers([]);
  }, []);

  // Using centralized avatar utilities from avatarUtils

  // Don't render anything if we don't have display data
  if (!displayData) {
    return null;
  }

  return (
    <>
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.readReceiptsContainer}
          onPress={handlePress}
          activeOpacity={0.8}
        >
          {/* Display up to 3 profile pictures */}
          <View style={styles.avatarsContainer}>
            {displayData.users.slice(0, 3).map((user: GroupMember, index: number) => (
              <View
                key={user.userId}
                style={[
                  styles.avatar,
                  {
                    backgroundColor: getAvatarColor(user.userId),
                    marginLeft: index > 0 ? -8 : 0,
                    zIndex: 3 - index,
                  },
                ]}
              >
                <Text style={styles.avatarText}>
                  {getInitials(user.name)}
                </Text>
              </View>
            ))}
            
            {/* Show count if more than 3 users */}
            {displayData.users.length > 3 && (
              <View 
                style={[styles.avatar, styles.countAvatar]}
              >
                <Text style={styles.countText}>
                  +{displayData.users.length - 3}
                </Text>
              </View>
            )}
          </View>

          {/* Caught up indicator */}
          <View style={styles.readIndicator}>
            <Text style={styles.readText}>
              {displayData.users.length === 1 ? 'Caught up' : `${displayData.users.length} caught up`}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Modal for showing all users */}
      {showModal && (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={handleCloseModal}
        >
          <Animated.View 
            style={styles.modalOverlay}
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
          >
            <Animated.View 
              style={styles.modalContent}
              entering={FadeIn.duration(300)}
              exiting={FadeOut.duration(200)}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Caught up</Text>
                <TouchableOpacity
                  onPress={handleCloseModal}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={24} color={THEME.white} />
                </TouchableOpacity>
              </View>
              
              <ScrollView style={styles.usersList} showsVerticalScrollIndicator={false}>
                {modalUsers.map((user, index) => (
                  <Animated.View 
                    key={user.userId} 
                    style={styles.userItem}
                    entering={FadeIn.delay(index * 50).duration(200)}
                  >
                    <View
                      style={[
                        styles.userAvatar,
                        { backgroundColor: getAvatarColor(user.userId) },
                      ]}
                    >
                      <Text style={styles.userAvatarText}>
                        {getInitials(user.name)}
                      </Text>
                    </View>
                    <Text style={styles.userName}>{user.name}</Text>
                    <Animated.View 
                      style={styles.readBadge}
                      entering={FadeIn.delay(100).duration(200)}
                    >
                      <Ionicons name="checkmark-done" size={16} color={THEME.accentBlue} />
                    </Animated.View>
                  </Animated.View>
                ))}
              </ScrollView>
            </Animated.View>
          </Animated.View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 6,
  },
  readReceiptsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  avatarsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0, 0, 0, 0.75)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  avatarText: {
    color: THEME.white,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  countAvatar: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    marginLeft: -10,
    borderColor: 'rgba(0, 0, 0, 0.75)',
  },
  countText: {
    color: THEME.white,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  readIndicator: {
    marginLeft: 8,
  },
  readText: {
    color: THEME.white,
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.95,
    letterSpacing: 0.3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'rgba(28, 28, 30, 0.98)',
    borderRadius: 20,
    width: '88%',
    maxWidth: 350,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalTitle: {
    color: THEME.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 4,
  },
  usersList: {
    maxHeight: 300,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userAvatarText: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  userName: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
  readBadge: {
    backgroundColor: 'rgba(38, 167, 222, 0.2)',
    borderRadius: 12,
    padding: 4,
  },
}); 