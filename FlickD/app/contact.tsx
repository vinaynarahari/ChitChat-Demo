import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView as SNSafeAreaView } from 'react-native-safe-area-context';
import AnimatedSVGBackground from '../components/AnimatedSVGBackground';
import PulsatingBackground from '../components/PulsatingBackground';

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  primary: '#282828',
  gray: '#666666',
  lightGray: '#EEEEEE'
};

export default function ContactPage() {
  const router = useRouter();
  const isAndroid = Platform.OS === 'android';

  return (
    <SNSafeAreaView style={styles.container} edges={isAndroid ? ['top'] : undefined}>
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
                activeOpacity={0.7}
                {...(isAndroid ? { android_ripple: { color: '#26A7DE', borderless: false } } : {})}
              >
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
            ),
            title: 'Contact',
          }}
        />
        <View style={styles.content}>
          <BlurView intensity={40} tint="dark" style={styles.infoBox}>
            <LinearGradient
              colors={['rgba(255, 255, 255, 0.1)', 'rgba(255, 255, 255, 0.05)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.infoGradient}
            >
              <View style={styles.iconContainer}>
                <View style={styles.iconCircle}>
                  <Ionicons name="mail" size={40} color={THEME.white} />
                </View>
              </View>
              <Text style={styles.infoText}>For support or inquiries, please contact us at:</Text>
              <View style={styles.infoSection}>
                <Text style={styles.label}>Email</Text>
                <Text style={styles.value}>vinay.na.narahari@gmail.com</Text>
              </View>
              <View style={styles.infoSection}>
                <Text style={styles.label}>Phone</Text>
                <Text style={styles.value}>630-540-8225</Text>
              </View>
              <Text style={styles.infoText}>We typically respond within 1-2 business days.</Text>
            </LinearGradient>
          </BlurView>
        </View>
      </BlurView>
    </SNSafeAreaView>
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
  content: {
    flex: 1,
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 120 : 160,
  },
  infoBox: {
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
  infoGradient: {
    padding: 20,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: THEME.accentBlue,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: THEME.accentBlue,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  infoText: {
    fontSize: 16,
    color: THEME.white,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 24,
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

}); 