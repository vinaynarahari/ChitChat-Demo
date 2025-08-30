import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useAuth } from '../context/AuthContext';
import { getAvatarColor, getInitials } from '../utils/avatarUtils';
import GroupChatListItem from './GroupChatListItem';
import RecipientAvatarsBar from './RecipientAvatarsBar';

const API_URL = Constants.expoConfig?.extra?.API_URL;
const SCREEN_HEIGHT = Dimensions.get('window').height;

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
}

type UserLite = { 
  userId?: string; 
  _id?: string; 
  name: string;
  email: string;
};

interface GroupChatListProps {
  groupChats: GroupChat[];
  selectedChat: GroupChat | null;
  onSelectChat: (chat: GroupChat) => void;
  onEavesdrop: (chat: GroupChat) => void;
  onCreateChat: (name: string, users: string[]) => Promise<void>;
  onDeleteChat: (groupId: string) => Promise<void>;
  onLeaveChat: (groupId: string) => Promise<void>;
  externalModalTrigger?: boolean;
  onExternalModalTriggerReset?: () => void;
}

export default function GroupChatList({
  groupChats,
  selectedChat,
  onSelectChat,
  onEavesdrop,
  onCreateChat,
  onDeleteChat,
  onLeaveChat,
  externalModalTrigger,
  onExternalModalTriggerReset,
}: GroupChatListProps) {
  const [modalVisible, setModalVisible] = React.useState(false);
  const [newGroupName, setNewGroupName] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [allUsers, setAllUsers] = React.useState<UserLite[]>([]);
  const [selectedUsers, setSelectedUsers] = React.useState<string[]>([]);
  const [userSearch, setUserSearch] = React.useState('');
  const [isSearching, setIsSearching] = React.useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<UserLite[]>([]);
  const { user } = useAuth();
  const router = useRouter();

  // Add ref for FlatList to control scrolling
  const flatListRef = React.useRef<FlatList>(null);
  // Track if search bar is focused to prevent scroll interruptions
  const [isSearchFocused, setIsSearchFocused] = React.useState(false);

  // Animation values for swipe-to-close
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  // Close modal function
  const closeModal = () => {
    setModalVisible(false);
    setNewGroupName('');
    setSelectedUsers([]);
  };

  // Gesture handler for swipe-to-close
  const panGesture = Gesture.Pan()
    .activeOffsetY([10, 1000])
    .failOffsetX([-50, 50])
    .simultaneousWithExternalGesture()
    .onStart(() => {
      console.log('Gesture started');
    })
    .onUpdate((event) => {
      console.log('Gesture update:', event.translationY);
      if (event.translationY > 0) {
        translateY.value = event.translationY;
        opacity.value = Math.max(0.3, 1 - event.translationY / (SCREEN_HEIGHT * 0.8));
      }
    })
    .onEnd((event) => {
      console.log('Gesture ended:', event.translationY, 'threshold:', SCREEN_HEIGHT * 0.15);
      const shouldClose = event.translationY > SCREEN_HEIGHT * 0.15;
      
      if (shouldClose) {
        console.log('Closing modal');
        translateY.value = withSpring(SCREEN_HEIGHT, { damping: 15, stiffness: 150 });
        opacity.value = withSpring(0, { damping: 15, stiffness: 150 });
        runOnJS(closeModal)();
      } else {
        console.log('Spring back');
        translateY.value = withSpring(0, { damping: 15, stiffness: 150 });
        opacity.value = withSpring(1, { damping: 15, stiffness: 150 });
      }
    });

  // Animated styles
  const animatedModalStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
      opacity: opacity.value,
    };
  });

  // Animated overlay style for background opacity
  const animatedOverlayStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: `rgba(0, 0, 0, ${0.7 * opacity.value})`,
    };
  });

  // Tap gesture for background dismissal
  const tapGesture = Gesture.Tap()
    .maxDistance(10)
    .onEnd(() => {
      console.log('Background tapped, closing modal');
      runOnJS(closeModal)();
    });

  // Reset animation values when modal opens/closes
  React.useEffect(() => {
    if (modalVisible) {
      translateY.value = 0;
      opacity.value = 1;
    }
  }, [modalVisible]);

  // Handle external modal trigger
  React.useEffect(() => {
    if (externalModalTrigger) {
      setModalVisible(true);
      onExternalModalTriggerReset?.();
    }
  }, [externalModalTrigger, onExternalModalTriggerReset]);

  const searchUsers = async (name: string) => {
    setIsSearching(true);
    try {
      const searchUrl = `${API_URL}/users${name.trim() ? `?name=${encodeURIComponent(name)}` : ''}`;

      const response = await fetch(searchUrl);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to search users');
      }
      
      const users = await response.json();
      
      const mappedUsers = users.map((user: UserLite) => ({
        ...user,
        userId: user._id // Map _id to userId for consistency
      }));

      setSearchResults(mappedUsers);
    } catch (error: any) {
      setSearchResults([]); // Clear results on error without showing alert
    } finally {
      setIsSearching(false);
    }
  };

  React.useEffect(() => {
    if (modalVisible) {
      searchUsers(''); // Load all users initially
    }
  }, [modalVisible]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert('Error', 'Please enter a group name');
      return;
    }

    try {
      // OPTIMIZATION: Show loading state immediately for instant feedback
      setIsCreatingGroup(true);

      // Always include the creator's username in the member list
      const creatorUsername = user?.name || '';

      const memberUsernames = (selectedUsers.includes(creatorUsername)
        ? selectedUsers
        : [creatorUsername, ...selectedUsers]
      ).filter((name): name is string => typeof name === 'string' && name.length > 0);

      await onCreateChat(newGroupName, memberUsernames);
      
      closeModal();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to create group chat');
      
      // OPTIMIZATION: Reset UI state on error
      setNewGroupName('');
      setSelectedUsers([]);
      setModalVisible(false);
    } finally {
      // OPTIMIZATION: Always reset loading state
      setIsCreatingGroup(false);
    }
  };

  const handleLeaveChat = async (groupId: string) => {
    try {
      await onLeaveChat(groupId);
    } catch (error) {
      console.error('Error leaving chat:', error);
      Alert.alert('Error', 'Failed to leave group chat');
    }
  };

  const filteredGroupChats = groupChats.filter(chat =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredUsers = allUsers.filter(u =>
    u.name.toLowerCase().includes(userSearch.toLowerCase())
  );

  // Get all unique members from all group chats
  const getAllUniqueMembers = (): GroupChatMember[] => {
    const allMembers: GroupChatMember[] = [];
    const seenUserIds = new Set<string>();
    
    groupChats.forEach(chat => {
      chat.members.forEach(member => {
        if (!seenUserIds.has(member.userId) && member.userId !== user?.userId) {
          seenUserIds.add(member.userId);
          allMembers.push(member);
        }
      });
    });
    
    return allMembers;
  };

  const renderGroupChat = ({ item }: { item: GroupChat }) => (
    <GroupChatListItem
      item={item}
      onPress={() => onSelectChat(item)}
      onLongPress={() => onEavesdrop(item)}
      selected={selectedChat?._id === item._id}
      onLeaveChat={handleLeaveChat}
    />
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.newspaperButton}
          onPress={() => router.push('/newspaper')}
          activeOpacity={0.7}
          accessibilityLabel="Newspaper"
        >
          <Ionicons name="newspaper-outline" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Messages</Text>
        <TouchableOpacity
          style={styles.profileButton}
          onPress={() => router.push('/settings')}
          activeOpacity={0.7}
          accessibilityLabel="Settings"
        >
          <View style={[
            styles.profileAvatar,
            { backgroundColor: getAvatarColor(user?.userId || '') }
          ]}>
            <Text style={styles.profileAvatarText}>
              {getInitials(user?.name || 'User')}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
      
      <ScrollView 
        style={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
      >
        <TextInput
          style={styles.searchBar}
          placeholder="Search group chats..."
          placeholderTextColor="#aaa"
          value={searchQuery}
          onChangeText={(text) => {
            setSearchQuery(text);
          }}
          onFocus={() => {
            setIsSearchFocused(true);
          }}
          onBlur={() => {
            setIsSearchFocused(false);
          }}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          blurOnSubmit={false}
        />
        
        <RecipientAvatarsBar
          members={getAllUniqueMembers()}
          currentUserId={user?.userId || ''}
          maxVisible={6}
          onMemberPress={(member: GroupChatMember) => {
            console.log('Member pressed:', member.name);
          }}
        />
        
        <FlatList
          data={filteredGroupChats}
          renderItem={renderGroupChat}
          keyExtractor={item => item._id}
          style={styles.groupList}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={11}
          scrollEventThrottle={16}
          scrollEnabled={!isSearchFocused}
          nestedScrollEnabled={true}
        />
      </ScrollView>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <Animated.View style={[styles.modalOverlay, animatedOverlayStyle]}>
          <GestureDetector gesture={tapGesture}>
            <View style={styles.backgroundTapArea} />
          </GestureDetector>
          <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.modalContent, animatedModalStyle]}>
              <View style={styles.swipeIndicator} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Create Group Chat</Text>
              </View>
              
              <KeyboardAvoidingView 
                style={styles.keyboardAvoidingView}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={0}
              >
                <View style={styles.modalScrollContent}>
                  <View style={styles.modalContentPadding}>
                  <TextInput
                    style={[styles.input, { color: '#fff' }]}
                    placeholder="Group name"
                    placeholderTextColor="#999"
                    value={newGroupName}
                    onChangeText={setNewGroupName}
                  />
                  <Text style={styles.selectUsersLabel}>Add Members</Text>
                  <View style={styles.searchContainer}>
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search users..."
                      placeholderTextColor="#666"
                      value={userSearch}
                      onChangeText={(text) => {
                        setUserSearch(text);
                        if (text.trim().length > 0) {
                          searchUsers(text);
                        } else {
                          setSearchResults([]);
                        }
                      }}
                    />
                    {isSearching ? (
                      <ActivityIndicator size="small" color={THEME.accentBlue} />
                    ) : null}
                  </View>
                  {userSearch.trim().length > 0 ? (
                    <FlatList
                      data={searchResults}
                      keyExtractor={(item) => item._id || ''}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={[
                            styles.userItem,
                            selectedUsers.includes(item.name) ? styles.userItemSelected : null
                          ]}
                          onPress={() => {
                            const isCurrentlySelected = selectedUsers.includes(item.name);
                            const newSelectedUsers = isCurrentlySelected
                              ? selectedUsers.filter(un => un !== item.name)
                              : [...selectedUsers, item.name];
                            
                            setSelectedUsers(newSelectedUsers);
                          }}
                        >
                          <View style={[
                            styles.userAvatar,
                            { backgroundColor: getAvatarColor(item._id || item.userId || '') }
                          ]}>
                            <Text style={styles.userAvatarText}>
                              {getInitials(item.name)}
                            </Text>
                          </View>
                          <View style={styles.userInfo}>
                            <Text style={styles.userName}>{item.name}</Text>
                          </View>
                          {selectedUsers.includes(item.name) ? (
                            <Ionicons name="checkmark-circle" size={20} color={THEME.accentBlue} />
                          ) : null}
                        </TouchableOpacity>
                      )}
                      style={styles.searchResults}
                      nestedScrollEnabled={true}
                    />
                  ) : null}
                  {selectedUsers.length > 0 ? (
                    <View style={styles.selectedUsersContainer}>
                      <Text style={styles.selectedUsersLabel}>Selected Members ({selectedUsers.length}):</Text>
                      {selectedUsers.map((username, index) => (
                        <Text key={index} style={styles.selectedUserText}>
                          • {username}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
              </KeyboardAvoidingView>
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={closeModal}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.createButton, isCreatingGroup && styles.createButtonDisabled]}
                  onPress={handleCreateGroup}
                  disabled={isCreatingGroup}
                >
                  {isCreatingGroup ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.createButtonText}>Create</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Animated.View>
          </GestureDetector>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 60,
  },
  searchBar: {
    backgroundColor: '#23242a',
    color: '#fff',
    borderRadius: 14,
    padding: 12,
    fontSize: 16,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(38,167,222,0.13)',
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    letterSpacing: 0.2,
    flex: 1,
    textAlign: 'center',
  },
  addButton: {
    marginRight: 12,
  },
  placeholderLeft: {
    width: 40,
    height: 40,
  },
  newspaperButton: {
    padding: 8,
    paddingLeft: 16,
  },
  profileButton: {
    padding: 8,
    paddingRight: 16,
  },
  profileAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
  profileAvatarText: {
    color: THEME.white,
    fontSize: 12,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  groupList: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  backgroundTapArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  modalContent: {
    backgroundColor: THEME.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    padding: 0,
    width: '100%',
    height: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 2,
    flexDirection: 'column',
  },
  swipeIndicator: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  modalScrollContent: {
    flex: 1,
  },
  modalContentPadding: {
    padding: 24,
    paddingBottom: 0,
  },
  modalHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    paddingTop: 24,
    paddingHorizontal: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: THEME.white,
    textAlign: 'center',
  },
  closeButton: {
    padding: 8,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: THEME.white,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  selectUsersLabel: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    color: THEME.white,
    fontSize: 16,
    marginRight: 12,
  },
  searchResults: {
    maxHeight: 300,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 8,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    marginBottom: 8,
  },
  userItemSelected: {
    backgroundColor: 'rgba(38, 167, 222, 0.2)',
    borderColor: THEME.accentBlue,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: THEME.accentBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userAvatarText: {
    color: THEME.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: '500',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 24,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 12,
    backgroundColor: THEME.background,
  },
  modalButton: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  createButton: {
    backgroundColor: THEME.accentBlue,
  },
  cancelButtonText: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: '600',
  },
  createButtonText: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: '600',
  },
  selectedUsersContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
  },
  selectedUsersLabel: {
    color: THEME.white,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  selectedUserText: {
    color: THEME.white,
    fontSize: 14,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
}); 