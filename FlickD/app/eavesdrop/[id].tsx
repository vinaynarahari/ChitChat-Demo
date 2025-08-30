import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { EavesdropChat } from '../components/EavesdropChat';
import { useGroupChatContext } from '../context/GroupChatContext';

export default function EavesdropPage() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { groupChats, messages } = useGroupChatContext();
  const [prefetchedChat, setPrefetchedChat] = useState<any>(null);
  const [prefetchedMessages, setPrefetchedMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Dummy/defaults for required props
  const getAudioUrl = async (messageId: string) => messageId;
  const playbackPosition = {};
  const playbackDuration = {};
  const isPlaying = null;
  const playMessage = () => {};
  const pauseMessage = () => {};
  const seekMessage = () => {};
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

  useEffect(() => {
    if (!id) return;
    // Prefetch chat data and messages
    const chat = groupChats.find((c) => c._id === id);
    setPrefetchedChat(chat || null);
    const unread = messages
      .filter(msg => 
        msg.groupChatId === id && 
        !msg.isRead && 
        msg.senderId !== chat?.createdBy // or user?.userId if available
      )
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    setPrefetchedMessages(unread);
    setLoading(false);
  }, [id, groupChats, messages]);

  const handleExit = () => {
    router.back();
  };

  if (loading) return null; // Or a spinner

  return (
    <View style={styles.container}>
      <EavesdropChat
        chatId={id as string}
        onExit={handleExit}
        getAudioUrl={getAudioUrl}
        playbackPosition={playbackPosition}
        playbackDuration={playbackDuration}
        isPlaying={isPlaying}
        playMessage={playMessage}
        pauseMessage={pauseMessage}
        seekMessage={seekMessage}
        formatTime={formatTime}
        prefetchedChatData={prefetchedChat}
        prefetchedMessages={prefetchedMessages}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
}); 