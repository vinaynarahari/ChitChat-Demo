const { MongoClient, ObjectId } = require('mongodb');

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://test_user:mypassword1@cluster0.ddewxiq.mongodb.net/flickD?retryWrites=true&w=majority&appName=Cluster0";

/**
 * Cleanup script for orphaned/corrupted messages missing isRead field
 * - Optionally deletes or marks as read
 * - Targets messages with groupChatId: null or non-existent group
 *
 * Usage:
 *   node cleanup-orphaned-messages.js --delete   # to delete
 *   node cleanup-orphaned-messages.js            # to just mark as read
 */
async function cleanupOrphanedMessages({ deleteMode = false } = {}) {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db('flickD');
    const recordedMessagesCollection = db.collection('recordedMessages');
    const groupChatsCollection = db.collection('groupChats');

    // Find all messages missing isRead
    const messages = await recordedMessagesCollection.find({ isRead: { $exists: false } }).toArray();
    if (messages.length === 0) {
      console.log('No messages missing isRead field. Nothing to clean up.');
      return;
    }
    console.log(`Found ${messages.length} messages missing isRead field.`);

    // Find orphaned (groupChatId null or group not found)
    const orphaned = [];
    const valid = [];
    for (const msg of messages) {
      if (!msg.groupChatId) {
        orphaned.push(msg);
        continue;
      }
      // Try to find group
      let groupId = msg.groupChatId;
      // If groupId is string, try to convert to ObjectId
      if (typeof groupId === 'string' && /^[a-fA-F0-9]{24}$/.test(groupId)) {
        groupId = new ObjectId(groupId);
      }
      const group = await groupChatsCollection.findOne({ _id: groupId });
      if (!group) {
        orphaned.push(msg);
      } else {
        valid.push(msg);
      }
    }
    console.log(`Orphaned/corrupted messages: ${orphaned.length}`);
    console.log(`Messages with valid group: ${valid.length}`);

    if (orphaned.length === 0) {
      console.log('No orphaned/corrupted messages to clean up.');
      return;
    }

    if (deleteMode) {
      // Delete orphaned messages
      const ids = orphaned.map(m => m._id);
      const result = await recordedMessagesCollection.deleteMany({ _id: { $in: ids } });
      console.log(`Deleted ${result.deletedCount} orphaned/corrupted messages.`);
    } else {
      // Mark orphaned messages as read
      const ids = orphaned.map(m => m._id);
      const result = await recordedMessagesCollection.updateMany(
        { _id: { $in: ids } },
        { $set: { isRead: true, updatedAt: new Date() } }
      );
      console.log(`Marked ${result.modifiedCount} orphaned/corrupted messages as read.`);
    }
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('Database connection closed');
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    deleteMode: args.includes('--delete')
  };
}

if (require.main === module) {
  const opts = parseArgs();
  console.log('Starting orphaned message cleanup...');
  if (opts.deleteMode) {
    console.log('Delete mode: orphaned messages will be deleted!');
  } else {
    console.log('Mark-as-read mode: orphaned messages will be marked as read.');
  }
  cleanupOrphanedMessages(opts)
    .then(() => {
      console.log('Cleanup complete.');
      process.exit(0);
    })
    .catch(e => {
      console.error('Cleanup failed:', e);
      process.exit(1);
    });
} 