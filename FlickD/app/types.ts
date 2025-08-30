export interface GroupChatMember {
  userId: string;
  name: string;
  joinedAt: string;
  lastReadAt?: string;
}

export interface GroupChat {
  _id: string;
  name: string;
  description?: string;
  createdBy: string;
  members: GroupChatMember[];
  createdAt: string;
  lastMessageAt?: string;
  unreadCount?: number;
  groupIcon?: string;  // URL to the group icon image
}

export interface Message {
  _id: string;
  senderId: string;
  groupChatId?: string;
  timestamp: string;
  transcription?: string;
  isRead: boolean;
  isDelivered: boolean;
  audioUrl: string;
  mediaUrl?: string;
  jobName?: string;
} 