import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Alert, Animated, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { uploadMediaToS3 } from '../../utils/mediaUpload';
import { API_URL } from '../config';
import { getAuthToken } from '../services/authService';
import { getAvatarColor, getInitials } from '../utils/avatarUtils';

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

interface User {
  userId: string;
  name: string;
  email: string;
}

interface GroupInfoModalProps {
  visible: boolean;
  onClose: () => void;
  group: GroupChat | null;
  currentUser: User | null;
  onRemoveMember: (userId: string) => void;
  onAddMember: () => void;
  onUpdateGroup: (groupId: string, updates: Partial<GroupChat>) => Promise<void>;
  onLeaveGroup: () => void;
}

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
};

const GroupInfoModal: React.FC<GroupInfoModalProps> = ({
  visible,
  onClose,
  group,
  currentUser,
  onRemoveMember,
  onAddMember,
  onUpdateGroup,
  onLeaveGroup,
}) => {
  const [isUploading, setIsUploading] = useState(false);

  // Filter out duplicate members by userId
  const uniqueMembers = group?.members
    ? group.members.filter((member, index, self) =>
        self.findIndex(m => m.userId === member.userId) === index
      )
    : [];

  const handleChangeIcon = async () => {
    if (!group || !currentUser) return;

    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant permission to access your photos');
        return;
      }

      // Pick the image
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setIsUploading(true);
        const token = await getAuthToken();
        
        // Upload to S3 first
        const iconUrl = await uploadMediaToS3(result.assets[0].uri, 'image');
        
        // Update group chat with new icon URL
        const response = await fetch(`${API_URL}/groupchats/${group._id}/icon`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ iconUrl }),
        });

        if (!response.ok) {
          return; // Silently return on error since functionality works
        }

        const updatedGroup = await response.json().catch(() => null);
        if (!updatedGroup) {
          return; // Silently return on error since functionality works
        }

        await onUpdateGroup(group._id, { groupIcon: updatedGroup.groupIcon });
      }
    } catch (error) {
      // Silently handle error since functionality works
      return;
    } finally {
      setIsUploading(false);
    }
  };

  const renderRightActions = (progress: Animated.AnimatedInterpolation<any>, onDelete: () => void) => {
    const trans = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [80, 0], // 80px is the width of the delete button
    });
    return (
      <Animated.View style={{ transform: [{ translateX: trans }], height: '100%' }}>
        <TouchableOpacity
          style={{
            backgroundColor: '#FF3B30',
            justifyContent: 'center',
            alignItems: 'center',
            width: 80,
            height: '100%',
          }}
          onPress={onDelete}
          activeOpacity={0.8}
        >
          <Ionicons name="trash" size={28} color="#fff" />
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderMemberItem = ({ item }: { item: GroupChatMember }) => {
    const isCreator = group?.createdBy === item.userId;
    const isCurrentUser = currentUser?.userId === item.userId;
    // Allow creator to remove others, and allow any user to remove themselves (unless creator)
    const canDelete = (group?.createdBy === currentUser?.userId && !isCreator) || (isCurrentUser && !isCreator);

    const handleRemoveMember = () => {
      Alert.alert(
        'Remove Member',
        `Are you sure you want to remove ${item.name} from the group?`,
        [
          {
            text: 'Cancel',
            style: 'cancel'
          },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => onRemoveMember(item.userId)
          }
        ]
      );
    };

    return (
      <Swipeable
        renderRightActions={(progress, dragX) => 
          canDelete ? renderRightActions(progress, handleRemoveMember) : null
        }
        enabled={canDelete}
      >
        <View style={styles.memberItem}>
          <View style={[
            styles.memberAvatar,
            { backgroundColor: getAvatarColor(item.userId) }
          ]}>
            <Text style={styles.memberAvatarText}>
              {getInitials(item.name)}
            </Text>
          </View>
          <View style={styles.memberInfo}>
            <View style={styles.memberNameContainer}>
              <Text style={styles.memberName}>{item.name}</Text>
              {isCreator && (
                <View style={styles.creatorBadge}>
                  <Ionicons name="star" size={14} color="#26A7DE" />
                  <Text style={styles.creatorBadgeText}>Creator</Text>
                </View>
              )}
            </View>
            <Text style={styles.memberJoinDate}>
              Joined {new Date(item.joinedAt).toLocaleDateString()}
            </Text>
          </View>
          {/* Show a shield for protected creator, nothing for others */}
          {!canDelete && isCreator && (
            <View style={styles.protectedMemberIcon}>
              <Ionicons name="shield-checkmark" size={20} color="#26A7DE" />
            </View>
          )}
        </View>
      </Swipeable>
    );
  };

  if (!group) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.groupInfoModal]}>
          <FlatList
            data={uniqueMembers}
            renderItem={renderMemberItem}
            keyExtractor={(item) => item.userId}
            contentContainerStyle={styles.membersListContent}
            ListHeaderComponent={
              <>
                <View style={styles.groupInfoHeader}>
                  <TouchableOpacity 
                    onPress={onClose}
                    style={styles.closeButton}
                  >
                    <Ionicons name="close" size={24} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.groupInfoTitle}>Group Info</Text>
                </View>
                <View style={{ alignItems: 'center', marginVertical: 16 }}>
                  {/* Group icon and name */}
                  <View style={{ alignItems: 'center' }}>
                    <View style={[
                      { 
                        width: 64, 
                        height: 64, 
                        borderRadius: 32, 
                        backgroundColor: getAvatarColor(group._id),
                        justifyContent: 'center', 
                        alignItems: 'center', 
                        marginBottom: 8 
                      }
                    ]}>
                      <Text style={{ color: '#fff', fontSize: 32, fontWeight: 'bold' }}>
                        {getInitials(group.name)}
                      </Text>
                      <TouchableOpacity style={styles.changeIconButton} onPress={handleChangeIcon}>
                        <Ionicons name="camera" size={18} color="#fff" />
                      </TouchableOpacity>
                    </View>
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 4 }}>{group.name}</Text>
                    <Text style={{ color: '#aaa', fontSize: 13 }}>Created on {new Date(group.createdAt).toLocaleDateString()}</Text>
                  </View>
                </View>
                <Text style={styles.membersSectionTitle}>Members</Text>
                <TouchableOpacity 
                  style={styles.addMemberItem}
                  onPress={onAddMember}
                >
                  <View style={[styles.memberAvatar, styles.addMemberAvatar]}>
                    <Ionicons name="add" size={24} color="#fff" />
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>Add Members</Text>
                    <Text style={styles.memberJoinDate}>
                      Invite people to join the group
                    </Text>
                  </View>
                </TouchableOpacity>
              </>
            }
            ListFooterComponent={
              <TouchableOpacity
                style={styles.leaveButton}
                onPress={() => {
                  Alert.alert(
                    'Leave Group',
                    'Are you sure you want to leave this group?',
                    [
                      {
                        text: 'Cancel',
                        style: 'cancel'
                      },
                      {
                        text: 'Leave',
                        style: 'destructive',
                        onPress: onLeaveGroup
                      }
                    ]
                  );
                }}
              >
                <Text style={styles.leaveButtonText}>Leave Conversation</Text>
              </TouchableOpacity>
            }
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 60,
  },
  groupInfoModal: {
    backgroundColor: 'rgba(40,40,43,0.95)',
    borderRadius: 28,
    width: '90%',
    maxHeight: '80%',
    paddingTop: 20,
    overflow: 'hidden',
  },
  groupInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  closeButton: {
    padding: 8,
  },
  groupInfoTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 15,
  },
  groupInfoContent: {
    alignItems: 'center',
    padding: 20,
  },
  groupInfoAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  groupInfoAvatarImage: {
    width: '100%',
    height: '100%',
  },
  groupInfoAvatarText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  groupInfoName: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  groupInfoDescription: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginBottom: 24,
  },
  membersSection: {
    width: '100%',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  membersSectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  membersListContainer: {
    flex: 1,
    minHeight: 100,
    maxHeight: 300, // adjust as needed for your UI
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  memberAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  memberJoinDate: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  addMemberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  addMemberAvatar: {
    backgroundColor: THEME.accentBlue,
    borderWidth: 0,
  },
  memberNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  creatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.5)',
  },
  creatorBadgeText: {
    color: '#26A7DE',
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 2,
  },
  changeIconButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
    borderTopLeftRadius: 12,
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  membersListContent: {
    paddingBottom: 20,
  },
  leaveButton: {
    backgroundColor: '#FF3B30',
    padding: 15,
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: 20,
    alignItems: 'center',
  },
  leaveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  protectedMemberIcon: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 40,
  },
});

export default GroupInfoModal; 