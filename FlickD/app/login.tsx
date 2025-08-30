import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import FluidLoginBackground from '../components/FluidLoginBackground';
import { useAuth } from './context/AuthContext';

const SESSION_REDIRECT_KEY = 'sessionRedirected';

// Comprehensive logging function for login events
const logLoginEvent = (event: string, data: any, level: 'info' | 'warn' | 'error' = 'info') => {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    event,
    ...data
  };
  
  switch (level) {
    case 'error':
      console.error(`[LOGIN-DEBUG][${timestamp}] ${event}:`, logData);
      break;
    case 'warn':
      console.warn(`[LOGIN-DEBUG][${timestamp}] ${event}:`, logData);
      break;
    default:
      console.log(`[LOGIN-DEBUG][${timestamp}] ${event}:`, logData);
  }
};

export default function LoginScreen() {
  const router = useRouter();
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [groupChats, setGroupChats] = useState([]);

  logLoginEvent('LOGIN_SCREEN_MOUNTED', {
    isLoading,
    hasEmail: !!email,
    hasPassword: !!password,
    reason: 'login_component_mounted'
  });

  const handleLogin = async () => {
    logLoginEvent('LOGIN_BUTTON_PRESSED', {
      email,
      hasPassword: !!password,
      passwordLength: password.length,
      reason: 'user_initiated_login'
    });

    try {
      setLoading(true);
      setError('');
      
      logLoginEvent('LOGIN_STATE_UPDATED', {
        loading: true,
        error: '',
        reason: 'login_state_reset'
      });

      logLoginEvent('LOGIN_CALLING_AUTH_LOGIN', {
        email,
        reason: 'calling_auth_context_login'
      });

      await login(email, password);
      
      logLoginEvent('LOGIN_AUTH_SUCCESS', {
        email,
        reason: 'auth_context_login_successful'
      });

      logLoginEvent('LOGIN_NAVIGATING', {
        email,
        destination: '/(tabs)/gcTestDatabase',
        reason: 'navigating_to_main_app'
      });

      router.replace('/(tabs)/gcTestDatabase');
      
      logLoginEvent('LOGIN_NAVIGATION_COMPLETE', {
        email,
        destination: '/(tabs)/gcTestDatabase',
        reason: 'navigation_completed'
      });

    } catch (error: any) {
      logLoginEvent('LOGIN_ERROR', {
        email,
        error: error.message || 'unknown_error',
        errorType: typeof error,
        reason: 'login_process_failed'
      }, 'error');

      setError(error.message || 'An unexpected error occurred');
      
      logLoginEvent('LOGIN_ERROR_DISPLAYED', {
        email,
        displayedError: error.message || 'An unexpected error occurred',
        reason: 'error_shown_to_user'
      });
    } finally {
      setLoading(false);
      
      logLoginEvent('LOGIN_STATE_FINAL', {
        email,
        loading: false,
        hasError: !!error,
        reason: 'login_process_completed'
      });
    }
  };

  const checkStoredTokens = async () => {
    logLoginEvent('LOGIN_TOKEN_CHECK_START', {
      reason: 'user_requested_token_check'
    });

    try {
      const [accessToken, refreshToken, user] = await Promise.all([
        AsyncStorage.getItem('accessToken'),
        AsyncStorage.getItem('refreshToken'),
        AsyncStorage.getItem('user'),
      ]);
      
      logLoginEvent('LOGIN_TOKEN_CHECK_RESULT', {
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        hasUser: !!user,
        accessTokenLength: accessToken?.length || 0,
        refreshTokenLength: refreshToken?.length || 0,
        userLength: user?.length || 0,
        reason: 'token_check_completed'
      });

      Alert.alert(
        'Stored Tokens',
        `Access Token: ${accessToken ? 'Present' : 'Missing'}\nRefresh Token: ${refreshToken ? 'Present' : 'Missing'}\nUser: ${user ? 'Present' : 'Missing'}`
      );
    } catch (error) {
      logLoginEvent('LOGIN_TOKEN_CHECK_ERROR', {
        error: error instanceof Error ? error.message : 'unknown_error',
        reason: 'token_check_failed'
      }, 'error');

      Alert.alert('Error', 'Failed to check stored tokens');
    }
  };

  if (loading) {
    logLoginEvent('LOGIN_SHOWING_LOADING', {
      reason: 'displaying_loading_state'
    });

    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  logLoginEvent('LOGIN_RENDERING_FORM', {
    hasEmail: !!email,
    hasPassword: !!password,
    hasError: !!error,
    isLoading,
    reason: 'rendering_login_form'
  });

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <FluidLoginBackground />
      <LinearGradient
        colors={["rgba(35, 39, 42, 0.7)", "rgba(40, 40, 40, 0.7)", "rgba(27, 43, 76, 0.7)", "rgba(40, 43, 90, 0.7)", "rgba(35, 39, 42, 0.7)"]}
        style={styles.gradientOverlay}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <BlurView intensity={90} tint="dark" style={styles.fullGlassBlur}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <View style={styles.contentContainer}>
            <Text style={styles.title}>Welcome Back!</Text>
            <Text style={styles.subtitle}>Sign in to continue</Text>
            
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Username</Text>
              <BlurView intensity={30} tint="dark" style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your Username"
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </BlurView>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Password</Text>
              <BlurView intensity={30} tint="dark" style={styles.inputWrapper}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Enter your password"
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity 
                  style={styles.eyeIcon}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons 
                    name={showPassword ? "eye-off" : "eye"} 
                    size={24} 
                    color="#fff"
                  />
                </TouchableOpacity>
              </BlurView>
            </View>

            <TouchableOpacity 
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Signing in...' : 'SIGN IN'}
              </Text>
            </TouchableOpacity>

            <View style={styles.socialSection}>
              <Text style={styles.socialText}>Or continue with</Text>
              <View style={styles.socialIcons}>
                <TouchableOpacity style={styles.socialIcon}>
                  <Ionicons name="logo-google" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.socialIcon}>
                  <Ionicons name="logo-apple" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.socialIcon}>
                  <Ionicons name="logo-facebook" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity 
              onPress={() => router.push('/signup')} 
              style={styles.signupLink}
            >
              <Text style={styles.signupText}>
                {"Don't have an account? "}<Text style={styles.signupTextBold}>Sign up</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#23272A',
    marginTop: -50,
    marginBottom: -50,
  },
  container: {
    flex: 1,
  },
  gradientOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 2,
  },
  fullGlassBlur: {
    flex: 1,
    padding: 20,
    zIndex: 3,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 40,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    color: '#fff',
    marginBottom: 8,
    fontSize: 16,
  },
  inputWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  input: {
    padding: 16,
    fontSize: 16,
    color: '#fff',
  },
  passwordInput: {
    paddingRight: 50,
  },
  eyeIcon: {
    position: 'absolute',
    right: 16,
    top: 16,
  },

  button: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 30,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#282828',
    fontSize: 16,
    fontWeight: 'bold',
  },
  socialSection: {
    alignItems: 'center',
    marginBottom: 30,
  },
  socialText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginBottom: 16,
  },
  socialIcons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  socialIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  signupLink: {
    alignItems: 'center',
  },
  signupText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
  },
  signupTextBold: {
    color: '#fff',
    fontWeight: 'bold',
  },
}); 