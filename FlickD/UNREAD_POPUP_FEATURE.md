# Unread Messages Popup Feature

## Overview

This feature implements a popup that appears when users have unread messages, displaying a Tinder-style card stack interface for viewing message summaries. The popup automatically appears when the homepage loads and detects unread messages.

## Features

### 1. Automatic Unread Detection
- Checks for unread messages when the homepage loads
- Uses the `/api/group-chats/unread-count` endpoint to get total unread count
- Only shows popup if there are unread messages

### 2. Tinder-Style Card Stack
- Displays group chats with unread messages as swipeable cards
- Each card shows:
  - Group avatar (first letter of group name)
  - Group name and unread count
  - Message summary (if available)
  - Message count and last updated date
  - Status indicator (checkmark for summarized, clock for pending)

### 3. Summary Modes
- **Unread**: Shows summary of unread messages only
- **Last Hour**: Shows summary of messages from the last hour
- **Last Day**: Shows summary of messages from the last 24 hours

### 4. Interactive Features
- Swipe left/right to dismiss cards
- Tap cards to refresh summaries
- Mode toggle buttons to switch between time periods
- Close button to dismiss popup
- "View All Summaries" button to navigate to full summaries page

## Implementation Details

### Frontend Components

#### `UnreadMessagesPopup.tsx`
- Main popup component with Tinder-style card stack
- Handles unread message checking and display
- Manages card animations and interactions
- Integrates with existing summaries functionality

#### Updated `homepage.tsx`
- Added automatic unread message checking on mount
- Integrated popup component
- Added test button for manual popup triggering

### Backend Endpoints

#### `/api/group-chats/unread-count` (existing)
- Returns total unread count across all group chats
- Uses Redis for performance optimization
- Falls back to database calculation if Redis fails

#### `/api/groupchats/:groupId/summary` (new)
- Returns summary for unread messages in a specific group
- Uses the same non-OpenAI summarization method as the existing summaries feature
- Creates summaries by combining first, middle, and last sentences from transcripts
- Returns message count and last updated timestamp

### Data Flow

1. **Homepage Load**: Automatically checks for unread messages
2. **Unread Detection**: Calls `/api/group-chats/unread-count` endpoint
3. **Popup Display**: If unread messages exist, shows popup with card stack
4. **Summary Generation**: For each group, fetches and displays message summaries
5. **User Interaction**: Users can swipe cards, change modes, or navigate to full summaries

## Usage

### Automatic Display
The popup automatically appears when:
- User navigates to homepage
- User has unread messages
- Internet connection is available

### Manual Testing
Use the "Test Unread Popup" button on the homepage to manually trigger the popup for testing purposes.

### Navigation
- **Close Popup**: Tap the X button or "Not Now"
- **View Full Summaries**: Tap "View All Summaries" to navigate to `/summaries`
- **Swipe Cards**: Swipe left/right to dismiss individual cards

## Technical Requirements

### Dependencies
- `expo-blur`: For popup background blur effect
- `expo-linear-gradient`: For card gradient backgrounds
- `@react-native-community/netinfo`: For network connectivity checking
- `react-native-reanimated`: For smooth card animations

### Backend Requirements
- Redis for unread count caching
- MongoDB collections: `recordedMessages`, `messageReadStatus`, `groupChats`
- Non-OpenAI summarization using transcript processing

## Error Handling

- Network connectivity checks before API calls
- Retry logic for failed requests (max 3 attempts)
- Graceful fallbacks for missing data
- User-friendly error messages

## Performance Considerations

- Lazy loading of summaries
- Cached unread counts in Redis
- Optimized card animations
- Efficient API calls with proper error handling

## Future Enhancements

- Push notifications for new unread messages
- Real-time updates via WebSocket
- Customizable popup timing
- Summary caching for offline viewing
- Batch summary generation for multiple groups 