import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, SafeAreaView, Platform } from 'react-native';
import { useAuth } from './context/AuthContext';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import AnimatedSVGBackground from '../components/AnimatedSVGBackground';
import PulsatingBackground from '../components/PulsatingBackground';
import { Stack } from 'expo-router';

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  primary: '#282828',
  gray: '#666666',
  lightGray: '#EEEEEE'
};

const HELP_OPTIONS = [
  { 
    label: 'Getting Started', 
    icon: <Ionicons name="rocket-outline" size={24} color={THEME.white} />,
    description: 'Learn the basics of using ChitChat'
  },
  { 
    label: 'Voice Messages', 
    icon: <Ionicons name="mic-outline" size={24} color={THEME.white} />,
    description: 'How to record and send voice messages'
  },
  { 
    label: 'Group Chats', 
    icon: <Ionicons name="people-outline" size={24} color={THEME.white} />,
    description: 'Creating and managing group conversations'
  },
  { 
    label: 'Eavesdrop Mode', 
    icon: <Ionicons name="ear-outline" size={24} color={THEME.white} />,
    description: 'Listen to conversations without joining'
  },
  { 
    label: 'Transcriptions', 
    icon: <Ionicons name="document-text-outline" size={24} color={THEME.white} />,
    description: 'Understanding voice message transcriptions'
  },
  { 
    label: 'Troubleshooting', 
    icon: <Ionicons name="construct-outline" size={24} color={THEME.white} />,
    description: 'Common issues and solutions'
  },
  { 
    label: 'Privacy & Security', 
    icon: <Ionicons name="shield-checkmark-outline" size={24} color={THEME.white} />,
    description: 'How we protect your data'
  },
  { 
    label: 'Contact Support', 
    icon: <Ionicons name="help-circle-outline" size={24} color={THEME.white} />,
    description: 'Get help from our support team'
  },
];

export default function HelpPage() {
  const { user } = useAuth();
  const router = useRouter();

  const handleHelpOption = (option: any) => {
    // Navigate to tutorial for Getting Started
    if (option.label === 'Getting Started') {
      router.push('/tutorial');
      return;
    }
    
    // For other options, show an alert with the option details
    // In the future, this could navigate to specific help content pages
    Alert.alert(
      option.label,
      option.description,
      [
        { text: 'OK', style: 'default' },
        { text: 'Learn More', style: 'default' }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <PulsatingBackground />
      <AnimatedSVGBackground />
      <LinearGradient
        colors={["#23272A", "#282828", "#26A7DE", "#fff0"]}
        style={styles.gradientOverlay}
        start={{ x: 0.1, y: 0.1 }}
        end={{ x: 0.9, y: 0.9 }}
      />
      <BlurView intensity={90} tint="dark" style={styles.fullGlassBlur}>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: true,
            headerStyle: {
              backgroundColor: 'transparent',
            },
            headerTintColor: '#fff',
            headerTitleStyle: {
              fontWeight: 'bold',
              color: '#fff',
              fontSize: 18,
            },
            headerBackTitle: '',
            headerBackVisible: false,
            headerLeft: () => (
              <TouchableOpacity 
                onPress={() => router.back()}
                style={{ marginLeft: 16 }}
              >
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
            ),
            title: 'Help & Support',
          }}
        />
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.optionsList}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          <View style={styles.headerSection}>
            <Text style={styles.headerTitle}>How can we help you?</Text>
            <Text style={styles.headerSubtitle}>
              Find answers to common questions and learn how to use ChitChat effectively.
            </Text>
          </View>

          {HELP_OPTIONS.map((option, idx) => (
            <TouchableOpacity 
              key={option.label} 
              style={styles.optionRow} 
              onPress={() => handleHelpOption(option)}
            >
              <BlurView intensity={40} tint="dark" style={styles.blurContainer}>
                <LinearGradient
                  colors={['rgba(255, 255, 255, 0.1)', 'rgba(255, 255, 255, 0.05)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.gradient}
                >
                  <View style={styles.iconLabelRow}>
                    {option.icon}
                    <View style={styles.textContainer}>
                      <Text style={styles.optionLabel}>{option.label}</Text>
                      <Text style={styles.optionDescription}>{option.description}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={22} color={THEME.gray} />
                </LinearGradient>
              </BlurView>
            </TouchableOpacity>
          ))}

          <View style={styles.footerSection}>
            <Text style={styles.footerText}>
              Can't find what you're looking for? Contact our support team for personalized assistance
            </Text>
          </View>
        </ScrollView>
      </BlurView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.background,
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    opacity: 0.55,
    borderRadius: 0,
  },
  fullGlassBlur: {
    ...StyleSheet.absoluteFillObject,
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
  scrollView: {
    flex: 1,
  },
  optionsList: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 120 : 160,
    paddingBottom: 30,
  },
  headerSection: {
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: THEME.white,
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: THEME.gray,
    lineHeight: 22,
  },
  optionRow: {
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  blurContainer: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 16,
  },
  iconLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  textContainer: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 17,
    color: THEME.white,
    fontWeight: '600',
    marginBottom: 2,
  },
  optionDescription: {
    fontSize: 14,
    color: THEME.gray,
    lineHeight: 18,
  },
  footerSection: {
    marginTop: 32,
    paddingHorizontal: 4,
  },
  footerText: {
    fontSize: 14,
    color: THEME.gray,
    textAlign: 'center',
    lineHeight: 20,
  },
}); 