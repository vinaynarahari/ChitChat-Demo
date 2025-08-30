import { Redirect } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoadingScreen from './components/LoadingScreen';

const SESSION_REDIRECT_KEY = 'sessionRedirected';
const MIN_LOADING_TIME = 2000; // 2 seconds minimum loading time

const THEME = {
  background: '#28282B',
  accentBlue: '#26A7DE',
  white: '#FFFFFE',
  primary: '#282828',
} as const;

// Comprehensive logging function for app initialization
const logAppEvent = (event: string, data: any, level: 'info' | 'warn' | 'error' = 'info') => {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    event,
    ...data
  };
  
  switch (level) {
    case 'error':
      console.error(`[APP-DEBUG][${timestamp}] ${event}:`, logData);
      break;
    case 'warn':
      console.warn(`[APP-DEBUG][${timestamp}] ${event}:`, logData);
      break;
    default:
      console.log(`[APP-DEBUG][${timestamp}] ${event}:`, logData);
  }
};

export default function Index() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // DIAGNOSTIC: Add app instance tracking
  const appInstanceIdRef = useRef(Math.random().toString(36).substring(7));
  const appMountTimeRef = useRef(Date.now());

  useEffect(() => {
    logAppEvent('APP_COMPONENT_MOUNTED', {
      appInstanceId: appInstanceIdRef.current,
      mountTime: appMountTimeRef.current,
      initialIsLoading: isLoading,
      initialIsAuthenticated: isAuthenticated,
      reason: 'app_index_component_created'
    });

    const initializeApp = async () => {
      logAppEvent('APP_INITIALIZATION_START', {
        appInstanceId: appInstanceIdRef.current,
        minLoadingTime: MIN_LOADING_TIME,
        reason: 'beginning_app_initialization'
      });

      try {
        // Simulate minimum loading time
        const startTime = Date.now();
        
        logAppEvent('APP_LOADING_DELAY_START', {
          appInstanceId: appInstanceIdRef.current,
          minLoadingTime: MIN_LOADING_TIME,
          reason: 'enforcing_minimum_loading_time'
        });

        await new Promise(resolve => setTimeout(resolve, MIN_LOADING_TIME));
        
        const loadingTime = Date.now() - startTime;
        logAppEvent('APP_LOADING_DELAY_COMPLETE', {
          appInstanceId: appInstanceIdRef.current,
          actualLoadingTime: loadingTime,
          minLoadingTime: MIN_LOADING_TIME,
          reason: 'minimum_loading_time_enforced'
        });
        
        // Check authentication status
        logAppEvent('APP_AUTH_CHECK_START', {
          appInstanceId: appInstanceIdRef.current,
          reason: 'checking_stored_authentication'
        });

        const [accessToken, refreshToken, userData] = await Promise.all([
          AsyncStorage.getItem('accessToken'),
          AsyncStorage.getItem('refreshToken'),
          AsyncStorage.getItem('user'),
        ]);

        logAppEvent('APP_AUTH_TOKENS_RETRIEVED', {
          appInstanceId: appInstanceIdRef.current,
          hasAccessToken: !!accessToken,
          hasRefreshToken: !!refreshToken,
          hasUserData: !!userData,
          accessTokenLength: accessToken?.length || 0,
          refreshTokenLength: refreshToken?.length || 0,
          userDataLength: userData?.length || 0,
          reason: 'storage_tokens_checked'
        });

        const isAuthenticatedResult = !!accessToken;
        
        logAppEvent('APP_AUTH_STATUS_DETERMINED', {
          appInstanceId: appInstanceIdRef.current,
          isAuthenticated: isAuthenticatedResult,
          hasAccessToken: !!accessToken,
          hasRefreshToken: !!refreshToken,
          hasUserData: !!userData,
          reason: 'authentication_status_determined'
        });

        setIsAuthenticated(isAuthenticatedResult);

        if (userData) {
          try {
            const parsedUser = JSON.parse(userData);
            logAppEvent('APP_USER_DATA_PARSED', {
              appInstanceId: appInstanceIdRef.current,
              userId: parsedUser.userId,
              email: parsedUser.email,
              name: parsedUser.name,
              isAuthenticated: isAuthenticatedResult,
              reason: 'user_data_successfully_parsed'
            });
          } catch (parseError) {
            logAppEvent('APP_USER_DATA_PARSE_ERROR', {
              appInstanceId: appInstanceIdRef.current,
              error: parseError instanceof Error ? parseError.message : 'unknown_error',
              userDataLength: userData.length,
              isAuthenticated: isAuthenticatedResult,
              reason: 'user_data_parse_failed'
            }, 'error');
          }
        }

        logAppEvent('APP_AUTH_CHECK_COMPLETE', {
          appInstanceId: appInstanceIdRef.current,
          isAuthenticated: isAuthenticatedResult,
          willRedirectTo: isAuthenticatedResult ? '/(tabs)/gcTestDatabase' : '/login',
          reason: 'authentication_check_completed'
        });

      } catch (error) {
        logAppEvent('APP_INITIALIZATION_ERROR', {
          appInstanceId: appInstanceIdRef.current,
          error: error instanceof Error ? error.message : 'unknown_error',
          reason: 'app_initialization_failed'
        }, 'error');
      } finally {
        logAppEvent('APP_INITIALIZATION_COMPLETE', {
          appInstanceId: appInstanceIdRef.current,
          isAuthenticated,
          isLoading: false,
          reason: 'app_initialization_finished'
        });
        
        setIsLoading(false);
      }
    };

    initializeApp();

    return () => {
      logAppEvent('APP_COMPONENT_UNMOUNTED', {
        appInstanceId: appInstanceIdRef.current,
        lifespan: Date.now() - appMountTimeRef.current,
        finalIsLoading: isLoading,
        finalIsAuthenticated: isAuthenticated,
        reason: 'app_index_component_destroyed'
      });
    };
  }, []);

  // DIAGNOSTIC: Log state changes
  useEffect(() => {
    logAppEvent('APP_STATE_CHANGED', {
      appInstanceId: appInstanceIdRef.current,
      isLoading,
      isAuthenticated,
      reason: 'app_state_update'
    });
  }, [isLoading, isAuthenticated]);

  if (isLoading) {
    logAppEvent('APP_SHOWING_LOADING', {
      appInstanceId: appInstanceIdRef.current,
      reason: 'displaying_loading_screen'
    });
    return <LoadingScreen message="Loading your experience..." />;
  }

  const redirectPath = isAuthenticated ? "/(tabs)/gcTestDatabase" : "/login";
  
  logAppEvent('APP_REDIRECTING', {
    appInstanceId: appInstanceIdRef.current,
    isAuthenticated,
    redirectPath,
    reason: 'redirecting_based_on_auth_status'
  });

  return <Redirect href={redirectPath} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.background,
  },
});
