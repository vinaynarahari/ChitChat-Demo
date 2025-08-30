import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useAuth } from '../context/AuthContext';

// Theme colors
const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
};

interface GroupChatMember {
  userId: string;
  name: string;
  joinedAt: string;
}

interface GroupChat {
  _id: string;
  name: string;
  description?: string;
  createdBy: string;
  members: GroupChatMember[];
  createdAt: string;
  lastMessageAt?: string;
  unreadCount?: number;
  groupIcon?: string;
}

interface GroupChatListItemProps {
  item: GroupChat;
  onPress: () => void;
  onLongPress: () => void;
  selected: boolean;
  onLeaveChat?: (groupId: string) => void;
}

export default function GroupChatListItem({ 
  item, 
  onPress, 
  onLongPress, 
  selected,
  onLeaveChat 
}: GroupChatListItemProps) {
  const { user } = useAuth();

  // Defensive: Only render if item is a valid group chat object
  if (
    !item ||
    typeof item !== 'object' ||
    typeof item.name !== 'string' ||
    !Array.isArray(item.members)
  ) {
    return null;
  }

  // Defensive fallback for group name and avatar letter
  const displayName = item.name && typeof item.name === 'string' && item.name.trim().length > 0
    ? item.name.trim()
    : 'Unnamed';
  const avatarLetter = displayName.charAt(0).toUpperCase();

  return (
    <TouchableOpacity
      style={[
        styles.groupListItem,
        selected ? styles.selectedGroupListItem : null
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      activeOpacity={0.7}
    >
      <View style={styles.groupListItemContent}>
        <View style={styles.avatar}>
          {item.groupIcon ? (
            <Image 
              source={{ uri: item.groupIcon }} 
              style={styles.avatarImage}
            />
          ) : (
            <Text style={styles.avatarText}>
              {item.name.charAt(0).toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.groupInfo}>
          <Text style={[styles.simpleGroupName, item.unreadCount && item.unreadCount > 0 ? styles.boldWhite : styles.regularGray]}>{displayName}</Text>
          {item.unreadCount && item.unreadCount > 0 ? (
            <Text style={[styles.unreadMessageText, styles.boldWhite]}>
              {item.unreadCount > 9 ? '9+ new messages' : `${item.unreadCount}+ new messages`}
            </Text>
          ) : (
            <Text style={styles.lastMessageText}>No new messages</Text>
          )}
        </View>
      </View>

    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  groupListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: 'transparent',
  },
  selectedGroupListItem: {
    backgroundColor: 'rgba(38,167,222,0.07)',
  },
  groupListItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: THEME.accentBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 20,
  },
  groupInfo: {
    flex: 1,
  },
  simpleGroupName: {
    fontSize: 16,
    marginBottom: 2,
    letterSpacing: 0.2,
  },
  boldWhite: {
    color: '#fff',
    fontWeight: 'bold',
  },
  regularGray: {
    color: '#bdbdbd',
    fontWeight: '400',
  },
  simpleMemberCount: {
    color: '#bdbdbd',
    fontSize: 12,
    fontWeight: '500',
  },
  simpleUnreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#26A7DE',
    marginLeft: 10,
  },
  unreadBadgeContainer: {
    minWidth: 28,
    height: 22,
    borderRadius: 11,
    backgroundColor: THEME.accentBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  unreadMessageText: {
    fontSize: 14,
    marginTop: 2,
  },
  lastMessageText: {
    color: '#bdbdbd',
    fontSize: 14,
    marginTop: 2,
    fontWeight: '400',
  },

}); 