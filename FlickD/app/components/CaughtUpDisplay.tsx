import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface CaughtUpDisplayProps {
  groupMembers: { userId: string; name?: string }[];
  caughtUpUsers: string[];
  currentUserId: string;
  isVisible: boolean;
  onPress: () => void;
}

const CaughtUpDisplay: React.FC<CaughtUpDisplayProps> = ({
  groupMembers,
  caughtUpUsers,
  currentUserId,
  isVisible,
  onPress
}) => {
  if (!isVisible || !groupMembers || groupMembers.length <= 2) {
    return null;
  }

  // Filter out current user from caught up users
  const otherCaughtUpUsers = caughtUpUsers.filter(userId => userId !== currentUserId);
  
  if (otherCaughtUpUsers.length === 0) {
    return null;
  }

  // Get names of caught up users
  const caughtUpNames = otherCaughtUpUsers
    .map(userId => {
      const member = groupMembers.find(m => m.userId === userId);
      return member?.name || userId;
    })
    .slice(0, 3); // Show max 3 names

  const displayText = caughtUpNames.length > 3 
    ? `${caughtUpNames.slice(0, 2).join(', ')} +${caughtUpNames.length - 2} others`
    : caughtUpNames.join(', ');

  return (
    <TouchableOpacity onPress={onPress} style={styles.container}>
      <View style={styles.indicator}>
        <Text style={styles.text}>✓</Text>
      </View>
      {caughtUpNames.length > 0 && (
        <Text style={styles.namesText}>{displayText}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },
  indicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#26A7DE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  namesText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 10,
    marginLeft: 4,
    maxWidth: 100,
  },
});

export default CaughtUpDisplay; 