import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Alert, Platform, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import AnimatedSVGBackground from '../components/AnimatedSVGBackground';
import PulsatingBackground from '../components/PulsatingBackground';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
import { getAvatarColor, getInitials } from './utils/avatarUtils';

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  primary: '#282828',
  gray: '#666666',
  lightGray: '#EEEEEE'
};

const SETTINGS_OPTIONS = [
  { label: 'Contact Us', icon: <Ionicons name="mail-outline" size={24} color={THEME.white} /> },
  { label: 'Help & Support', icon: <Ionicons name="help-circle-outline" size={24} color={THEME.white} /> },
];

const TOGGLE_OPTIONS = [
  { 
    label: 'Auto Recording', 
    icon: <Ionicons name="mic-outline" size={24} color={THEME.white} />,
    description: 'Automatically start recording after messages finish playing'
  }
];

export default function SettingsPage() {
  const { logout, user } = useAuth();
  const router = useRouter();
  const { autoRecordingEnabled, toggleAutoRecording } = useSettings();

  console.log('[SETTINGS] Auto-recording enabled:', autoRecordingEnabled);

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/login');
    } catch (error) {
      Alert.alert('Logout Error', 'Failed to logout');
    }
  };

  const handleAutoRecordingToggle = () => {
    console.log('[SETTINGS] Toggling auto-recording from:', autoRecordingEnabled, 'to:', !autoRecordingEnabled);
    toggleAutoRecording();
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
            title: 'Account Information',
          }}
        />
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.optionsList}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          {/* Profile Information Section */}
          <View style={styles.profileSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>My Profile</Text>
            </View>
            <BlurView intensity={40} tint="dark" style={styles.profileInfoBox}>
              <LinearGradient
                colors={['rgba(255, 255, 255, 0.1)', 'rgba(255, 255, 255, 0.05)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.profileInfoGradient}
              >
                <View style={styles.avatarContainer}>
                  <View style={[
                    styles.avatar,
                    { backgroundColor: getAvatarColor(user?.userId || '') }
                  ]}>
                    <Text style={styles.avatarText}>
                      {getInitials(user?.name || 'User')}
                    </Text>
                  </View>
                </View>
                <View style={styles.infoSection}>
                  <Text style={styles.label}>Name</Text>
                  <Text style={styles.value}>{user?.name || 'N/A'}</Text>
                </View>
                <View style={styles.infoSection}>
                  <Text style={styles.label}>Username</Text>
                  <Text style={styles.value}>{user?.email || 'N/A'}</Text>
                </View>
              </LinearGradient>
            </BlurView>
          </View>

          {/* Settings Options Section */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Settings</Text>
          </View>

          {SETTINGS_OPTIONS.map((option, idx) => (
            <TouchableOpacity 
              key={option.label} 
              style={styles.optionRow} 
              onPress={() => {
                if (option.label === 'Contact Us') router.push('/contact');
                if (option.label === 'Help & Support') router.push('/help');
              }}
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
                    <Text style={styles.optionLabel}>{option.label}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={22} color={THEME.gray} />
                </LinearGradient>
              </BlurView>
            </TouchableOpacity>
          ))}
          
          {/* Toggle Options Section */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Preferences</Text>
          </View>
          
          {TOGGLE_OPTIONS.map((option, idx) => (
            <TouchableOpacity 
              key={option.label} 
              style={styles.optionRow}
              onPress={handleAutoRecordingToggle}
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
                    <View style={styles.labelContainer}>
                      <Text style={styles.optionLabel}>{option.label}</Text>
                      <Text style={styles.optionDescription}>
                        {autoRecordingEnabled ? 'Enabled' : 'Disabled'} - {option.description}
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={autoRecordingEnabled}
                    onValueChange={() => {}}
                    trackColor={{ false: THEME.gray, true: THEME.accentBlue }}
                    thumbColor={THEME.white}
                    ios_backgroundColor={THEME.gray}
                    style={{ 
                      transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }],
                      marginLeft: 8
                    }}
                    pointerEvents="none"
                  />
                </LinearGradient>
              </BlurView>
            </TouchableOpacity>
          ))}
          
          <TouchableOpacity style={[styles.optionRow, styles.logoutRow]} onPress={handleLogout}>
            <BlurView intensity={40} tint="dark" style={[styles.blurContainer, styles.logoutBlur]}>
              <LinearGradient
                colors={['rgba(255, 59, 48, 0.3)', 'rgba(255, 59, 48, 0.1)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradient}
              >
                <View style={styles.iconLabelRow}>
                  <MaterialIcons name="logout" size={24} color="#FF3B30" />
                  <Text style={[styles.optionLabel, { color: '#FF3B30' }]}>Logout</Text>
                </View>
              </LinearGradient>
            </BlurView>
          </TouchableOpacity>
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
  profileSection: {
    marginBottom: 24,
  },
  profileInfoBox: {
    borderRadius: 20,
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
  profileInfoGradient: {
    padding: 20,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: THEME.white,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  infoSection: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 4,
  },
  value: {
    fontSize: 18,
    color: THEME.white,
    fontWeight: '500',
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
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    minHeight: 60, // Ensure minimum height for toggle options
  },
  iconLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    minWidth: 0,
  },
  optionLabel: {
    fontSize: 17,
    color: THEME.white,
    fontWeight: '500',
    marginLeft: 8,
  },
  logoutRow: {
    marginTop: 24,
  },
  logoutBlur: {
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
  },
  sectionHeader: {
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: THEME.white,
    marginLeft: 4,
  },
  labelContainer: {
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
    marginRight: 12,
  },
  optionDescription: {
    fontSize: 14,
    color: THEME.gray,
    marginTop: 2,
    flexWrap: 'wrap',
  },
}); 