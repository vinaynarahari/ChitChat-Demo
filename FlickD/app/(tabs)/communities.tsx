import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import GradientWavesBackground from '../../components/GradientWavesBackground';

interface Community {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  imageUrl: string;
  category: string;
  isJoined: boolean;
}

const sampleCommunities: Community[] = [
  {
    id: '1',
    name: 'Tech Innovators',
    description: 'Latest in AI, Web3, and emerging technologies',
    memberCount: 2847,
    imageUrl: 'https://picsum.photos/400/600?random=1',
    category: 'Technology',
    isJoined: false,
  },
  {
    id: '2',
    name: 'Coffee Enthusiasts',
    description: 'Share your brewing techniques and cafe discoveries',
    memberCount: 1203,
    imageUrl: 'https://picsum.photos/400/600?random=2',
    category: 'Lifestyle',
    isJoined: true,
  },
  {
    id: '3',
    name: 'Digital Nomads',
    description: 'Remote work tips and travel destinations',
    memberCount: 5692,
    imageUrl: 'https://picsum.photos/400/600?random=3',
    category: 'Travel',
    isJoined: false,
  },
  {
    id: '4',
    name: 'Fitness Warriors',
    description: 'Workout routines, nutrition, and motivation',
    memberCount: 3456,
    imageUrl: 'https://picsum.photos/400/600?random=4',
    category: 'Health',
    isJoined: true,
  },
  {
    id: '5',
    name: 'Creative Minds',
    description: 'Art, design, and creative inspiration',
    memberCount: 892,
    imageUrl: 'https://picsum.photos/400/600?random=5',
    category: 'Art',
    isJoined: false,
  },
  {
    id: '6',
    name: 'Startup Founders',
    description: 'Building the next big thing together',
    memberCount: 1567,
    imageUrl: 'https://picsum.photos/400/600?random=6',
    category: 'Business',
    isJoined: false,
  },
];

export default function Communities() {
  const handleJoinCommunity = (communityId: string) => {
    console.log('Joining community:', communityId);
    // Add join logic here
  };

  const handleLeaveCommunity = (communityId: string) => {
    console.log('Leaving community:', communityId);
    // Add leave logic here
  };

  const renderCommunityCard = ({ item }: { item: Community }) => (
    <TouchableOpacity style={styles.communityCard} activeOpacity={0.9}>
      <Image source={{ uri: item.imageUrl }} style={styles.communityImage} />
      <View style={styles.communityOverlay}>
        <View style={styles.communityHeader}>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{item.category}</Text>
          </View>
          <TouchableOpacity style={styles.moreButton}>
            <Ionicons name="ellipsis-horizontal" size={20} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
        </View>
        
        <View style={styles.communityFooter}>
          <View style={styles.communityInfo}>
            <Text style={styles.communityName} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={styles.communityDescription} numberOfLines={2}>
              {item.description}
            </Text>
            <View style={styles.memberInfo}>
              <Ionicons name="people" size={16} color="rgba(255,255,255,0.7)" />
              <Text style={styles.memberCount}>
                {item.memberCount.toLocaleString()} members
              </Text>
            </View>
          </View>
          
          <TouchableOpacity
            style={[styles.joinButton, item.isJoined && styles.joinedButton]}
            onPress={() => item.isJoined ? handleLeaveCommunity(item.id) : handleJoinCommunity(item.id)}
            activeOpacity={0.8}
          >
            <Text style={[styles.joinButtonText, item.isJoined && styles.joinedButtonText]}>
              {item.isJoined ? 'Joined' : 'Join'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      {/* Gradient Waves Animated Background */}
      <GradientWavesBackground />
      {/* Full-page Glassmorphic Blur */}
      <BlurView intensity={90} tint="dark" style={styles.fullGlassBlur}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <Text style={styles.title}>Communities</Text>
            <Text style={styles.subtitle}>Connect with like-minded people</Text>
          </View>
          
          <FlatList
            data={sampleCommunities}
            renderItem={renderCommunityCard}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </SafeAreaView>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#282828',
  },
  fullGlassBlur: {
    flex: 1,
    zIndex: 2,
    borderRadius: 0,
    backgroundColor: 'rgba(40,40,43,0.30)',
    borderWidth: 0,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 24,
    elevation: 10,
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  row: {
    justifyContent: 'space-between',
  },
  separator: {
    height: 16,
  },
  communityCard: {
    width: '48%',
    height: 280,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(40,40,43,0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  communityImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  communityOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: 12,
    justifyContent: 'space-between',
  },
  communityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  categoryBadge: {
    backgroundColor: 'rgba(38, 167, 222, 0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  categoryText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  moreButton: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  communityFooter: {
    gap: 12,
  },
  communityInfo: {
    gap: 4,
  },
  communityName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  communityDescription: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    lineHeight: 16,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  memberCount: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '500',
  },
  joinButton: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  joinedButton: {
    backgroundColor: 'rgba(38, 167, 222, 0.8)',
  },
  joinButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
  joinedButtonText: {
    color: '#FFFFFF',
  },
}); 