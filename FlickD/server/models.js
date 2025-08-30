const { ObjectId } = require('mongodb');

// Schema for recorded messages
const recordedMessageSchema = {
  _id: ObjectId,
  audioUrl: String,
  duration: Number,
  senderId: ObjectId,
  senderName: String,
  timestamp: Date,
  groupChatId: ObjectId,
  transcription: Object
};

// Schema for group chats
const groupChatSchema = {
  _id: ObjectId,
  name: String,
  description: String,
  createdBy: ObjectId,
  members: [{
    userId: String,
    name: String,
    joinedAt: Date,
    lastReadAt: Date
  }],
  createdAt: Date,
  lastMessageAt: Date,
  groupIcon: String  // URL to the group icon image
};

// Schema for message read status
const messageReadStatusSchema = {
  _id: ObjectId,
  userId: ObjectId,
  groupChatId: ObjectId,
  lastReadMessageId: ObjectId,
  lastReadAt: Date
};

// Schema for comments
const commentSchema = {
  _id: ObjectId,
  postId: ObjectId,
  userId: ObjectId,
  userName: String,
  content: String,
  media: [{
    type: String,  // 'image' or 'audio'
    url: String,
    duration: Number,
    size: Number,
    mimeType: String
  }],
  createdAt: Date,
  updatedAt: Date,
  likes: Number
};

// Schema for posts
const postSchema = {
  _id: ObjectId,
  userId: ObjectId,
  content: String,
  media: [{
    type: String,  // 'image', 'video', or 'audio'
    url: String,
    duration: Number,
    size: Number,
    mimeType: String
  }],
  createdAt: Date,
  updatedAt: Date,
  likes: Number,
  comments: [{
    _id: ObjectId,
    userId: ObjectId,
    userName: String,
    content: String,
    media: [{
      type: String,  // 'image' or 'audio'
      url: String,
      duration: Number,
      size: Number,
      mimeType: String
    }],
    createdAt: Date,
    updatedAt: Date,
    likes: Number
  }],
  tags: [String],
  isPublic: Boolean
};

module.exports = {
  recordedMessageSchema,
  groupChatSchema,
  messageReadStatusSchema,
  postSchema,
  commentSchema
}; 