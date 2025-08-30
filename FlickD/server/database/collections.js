const { MongoClient, ObjectId } = require('mongodb');

// MongoDB configuration from app.config.js
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://test_user:mypassword1@cluster0.ddewxiq.mongodb.net/flickD?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(MONGODB_URI);

let db = null;
let usersCollection = null;
let groupChatsCollection = null;
let recordedMessagesCollection = null;
let messageReadStatusCollection = null;
let postsCollection = null;

async function connectDB() {
  try {
    if (db) {
      console.log('Database already connected');
      return;
    }

    await client.connect();
    console.log('Connected to MongoDB');
    db = client.db('flickD');
    
    // Initialize collections
    usersCollection = db.collection('users');
    groupChatsCollection = db.collection('groupChats');
    recordedMessagesCollection = db.collection('recordedMessages');
    messageReadStatusCollection = db.collection('messageReadStatus');
    postsCollection = db.collection('posts');
    
    // Create indexes for better performance
    await groupChatsCollection.createIndex({ 'members.userId': 1 });
    await recordedMessagesCollection.createIndex({ groupChatId: 1, timestamp: -1 });
    await messageReadStatusCollection.createIndex({ userId: 1, groupChatId: 1 });
    await postsCollection.createIndex({ userId: 1, createdAt: -1 });
    await postsCollection.createIndex({ tags: 1 });
    
    console.log('Database collections initialized:', {
      usersCollection: !!usersCollection,
      groupChatsCollection: !!groupChatsCollection,
      recordedMessagesCollection: !!recordedMessagesCollection,
      messageReadStatusCollection: !!messageReadStatusCollection,
      postsCollection: !!postsCollection
    });
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

function getCollection(name) {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  switch (name) {
    case 'users':
      return usersCollection;
    case 'groupChats':
      return groupChatsCollection;
    case 'recordedMessages':
      return recordedMessagesCollection;
    case 'messageReadStatus':
      return messageReadStatusCollection;
    case 'posts':
      return postsCollection;
    default:
      throw new Error(`Collection ${name} not found`);
  }
}

module.exports = {
  connectDB,
  client,
  getCollection,
  ObjectId
}; 