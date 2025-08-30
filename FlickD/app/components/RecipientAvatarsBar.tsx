import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getAvatarColor, getInitials } from '../utils/avatarUtils';

interface GroupChatMember {
  userId: string;
  name: string;
  joinedAt: string;
}

interface RecipientAvatarsBarProps {
  members: GroupChatMember[];
  currentUserId: string;
  maxVisible?: number;
  onMemberPress?: (member: GroupChatMember) => void;
}

const THEME = {
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  background: '#28282B',
};

export default function RecipientAvatarsBar({
  members,
  currentUserId,
  maxVisible = 4,
  onMemberPress,
}: RecipientAvatarsBarProps) {
  // Filter out current user from the members list
  const otherMembers = members.filter(member => member.userId !== currentUserId);
  
  // Show up to maxVisible members, then show count for remaining
  const visibleMembers = otherMembers.slice(0, maxVisible);
  const remainingCount = Math.max(0, otherMembers.length - maxVisible);

  if (otherMembers.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {visibleMembers.map((member, index) => (
          <TouchableOpacity
            key={member.userId}
            style={[
              styles.avatarContainer,
              { backgroundColor: getAvatarColor(member.userId) }
            ]}
            onPress={() => onMemberPress?.(member)}
            activeOpacity={0.7}
          >
            <Text style={styles.avatarText}>
              {getInitials(member.name)}
            </Text>
          </TouchableOpacity>
        ))}
        
        {remainingCount > 0 && (
          <View 
            style={[
              styles.avatarContainer,
              styles.countContainer
            ]}
          >
            <Text style={styles.countText}>
              +{remainingCount}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 12, // Space between avatars
  },
  avatarContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  avatarText: {
    color: THEME.white,
    fontSize: 18,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  countContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  countText: {
    color: THEME.white,
    fontSize: 14,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

// Export the component and types for use in other files
export { GroupChatMember, RecipientAvatarsBarProps };

