import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { AuthState, User, LoginResponse } from '../types/auth';

const API_URL = Constants.expoConfig?.extra?.API_URL;
const SESSION_REDIRECT_KEY = 'sessionRedirected';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<void>;
  state: AuthState;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Comprehensive logging function for auth events
const logAuthEvent = (event: string, data: any, level: 'info' | 'warn' | 'error' = 'info') => {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    event,
    ...data
  };
  
  switch (level) {
    case 'error':
      console.error(`[AUTH-DEBUG][${timestamp}] ${event}:`, logData);
      break;
    case 'warn':
      console.warn(`[AUTH-DEBUG][${timestamp}] ${event}:`, logData);
      break;
    default:
      console.log(`[AUTH-DEBUG][${timestamp}] ${event}:`, logData);
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    refreshToken: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // DIAGNOSTIC: Add context instance tracking
  const authContextInstanceIdRef = useRef(Math.random().toString(36).substring(7));
  const authMountTimeRef = useRef(Date.now());

  useEffect(() => {
    logAuthEvent('AUTH_CONTEXT_MOUNTED', {
      authContextInstanceId: authContextInstanceIdRef.current,
      mountTime: authMountTimeRef.current,
      initialState: state,
      reason: 'auth_context_created'
    });
    
    // Check for stored tokens on app start
    loadStoredAuth();

    return () => {
      logAuthEvent('AUTH_CONTEXT_UNMOUNTED', {
        authContextInstanceId: authContextInstanceIdRef.current,
        lifespan: Date.now() - authMountTimeRef.current,
        finalState: state,
        reason: 'auth_context_destroyed'
      });
    };
  }, []);

  // DIAGNOSTIC: Track auth state changes
  useEffect(() => {
    logAuthEvent('AUTH_STATE_CHANGED', {
      authContextInstanceId: authContextInstanceIdRef.current,
      hasUser: !!state.user,
      userId: state.user?.userId,
      hasAccessToken: !!state.accessToken,
      hasRefreshToken: !!state.refreshToken,
      isLoading: state.isLoading,
      isAuthenticated: state.isAuthenticated,
      accessTokenLength: state.accessToken?.length || 0,
      refreshTokenLength: state.refreshToken?.length || 0,
      reason: 'auth_state_update'
    });
  }, [state.user, state.accessToken, state.refreshToken, state.isLoading, state.isAuthenticated]);

  const loadStoredAuth = async () => {
    logAuthEvent('LOAD_STORED_AUTH_START', { 
      reason: 'checking_persisted_auth' 
    });
    
    try {
      const [accessToken, refreshToken, userData] = await Promise.all([
        AsyncStorage.getItem('accessToken'),
        AsyncStorage.getItem('refreshToken'),
        AsyncStorage.getItem('user'),
      ]);

      logAuthEvent('STORED_AUTH_RETRIEVED', {
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        hasUserData: !!userData,
        accessTokenLength: accessToken?.length || 0,
        refreshTokenLength: refreshToken?.length || 0,
        userDataLength: userData?.length || 0,
        reason: 'storage_check_complete'
      });

      if (accessToken && refreshToken && userData) {
        const parsedUser = JSON.parse(userData);
        
        logAuthEvent('STORED_AUTH_VALID', {
          userId: parsedUser.userId,
          email: parsedUser.email,
          name: parsedUser.name,
          reason: 'valid_stored_auth_found'
        });

        setState({
          user: parsedUser,
          accessToken,
          refreshToken,
          isLoading: false,
          isAuthenticated: true,
        });
        
        logAuthEvent('AUTH_STATE_RESTORED', {
          userId: parsedUser.userId,
          isAuthenticated: true,
          reason: 'state_restored_from_storage'
        });
      } else {
        logAuthEvent('STORED_AUTH_INVALID', {
          hasAccessToken: !!accessToken,
          hasRefreshToken: !!refreshToken,
          hasUserData: !!userData,
          reason: 'incomplete_stored_auth'
        });
        
        setState(prev => ({ ...prev, isLoading: false }));
        
        logAuthEvent('AUTH_STATE_CLEARED', {
          reason: 'no_valid_stored_auth'
        });
      }
    } catch (error) {
      logAuthEvent('LOAD_STORED_AUTH_ERROR', {
        error: error instanceof Error ? error.message : 'unknown_error',
        reason: 'storage_access_failed'
      }, 'error');
      
      setState(prev => ({ ...prev, isLoading: false }));
    }
  };

  const login = async (email: string, password: string) => {
    const maxRetries = 3;
    let retryCount = 0;

    logAuthEvent('LOGIN_START', {
      email,
      maxRetries,
      reason: 'user_initiated_login'
    });

    while (retryCount < maxRetries) {
      try {
        logAuthEvent('LOGIN_ATTEMPT', {
          attempt: retryCount + 1,
          maxRetries,
          email,
          apiUrl: `${API_URL}/login`,
          reason: 'attempting_login'
        });
        
        // Test server connection first
        try {
          const testResponse = await fetch(`${API_URL}/test`);
          if (!testResponse.ok) {
            throw new Error('Server is not responding properly');
          }
          
          logAuthEvent('SERVER_CONNECTION_TEST', {
            status: 'success',
            statusCode: testResponse.status,
            reason: 'server_reachable'
          });
        } catch (error) {
          logAuthEvent('SERVER_CONNECTION_TEST', {
            status: 'failed',
            error: error instanceof Error ? error.message : 'unknown_error',
            reason: 'server_unreachable'
          }, 'error');
          
          throw new Error('Unable to connect to server. Please check if the server is running.');
        }

        const response = await fetch(`${API_URL}/login`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ email, password }),
        });

        logAuthEvent('LOGIN_RESPONSE_RECEIVED', {
          status: response.status,
          statusText: response.statusText,
          attempt: retryCount + 1,
          reason: 'server_response_received'
        });

        const data: LoginResponse = await response.json();
        
        logAuthEvent('LOGIN_RESPONSE_PARSED', {
          hasAccessToken: !!data.accessToken,
          hasRefreshToken: !!data.refreshToken,
          hasUserId: !!data.userId,
          hasName: !!data.name,
          hasEmail: !!data.email,
          email: data.email,
          userId: data.userId,
          name: data.name,
          error: data.error,
          reason: 'response_data_parsed'
        });

        if (!response.ok) {
          logAuthEvent('LOGIN_RESPONSE_ERROR', {
            status: response.status,
            error: data.error,
            attempt: retryCount + 1,
            reason: 'server_returned_error'
          }, 'error');
          
          throw new Error(data.error || 'Login failed');
        }

        if (!data.accessToken || !data.refreshToken) {
          logAuthEvent('LOGIN_MISSING_TOKENS', {
            hasAccessToken: !!data.accessToken,
            hasRefreshToken: !!data.refreshToken,
            responseData: { ...data, accessToken: '[REDACTED]', refreshToken: '[REDACTED]' },
            reason: 'incomplete_login_response'
          }, 'error');
          
          throw new Error('Invalid response: missing tokens');
        }

        const user: User = {
          userId: data.userId,
          name: data.name,
          email: data.email,
        };

        logAuthEvent('LOGIN_USER_OBJECT_CREATED', {
          userId: user.userId,
          name: user.name,
          email: user.email,
          reason: 'user_object_prepared'
        });

        // Store tokens and user data
        logAuthEvent('LOGIN_STORING_TOKENS', {
          userId: user.userId,
          reason: 'storing_auth_data'
        });

        await Promise.all([
          AsyncStorage.setItem('accessToken', data.accessToken),
          AsyncStorage.setItem('refreshToken', data.refreshToken),
          AsyncStorage.setItem('user', JSON.stringify(user)),
        ]);

        logAuthEvent('LOGIN_TOKENS_STORED', {
          userId: user.userId,
          reason: 'auth_data_stored_successfully'
        });

        setState({
          user,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          isLoading: false,
          isAuthenticated: true,
        });

        logAuthEvent('LOGIN_SUCCESS', {
          userId: user.userId,
          email: user.email,
          name: user.name,
          attempt: retryCount + 1,
          reason: 'login_completed_successfully'
        });

        return; // Success, exit the retry loop
      } catch (error) {
        logAuthEvent('LOGIN_ATTEMPT_FAILED', {
          attempt: retryCount + 1,
          maxRetries,
          error: error instanceof Error ? error.message : 'unknown_error',
          willRetry: retryCount < maxRetries - 1,
          reason: 'login_attempt_error'
        }, 'error');
        
        if (retryCount === maxRetries - 1) {
          // Last retry failed, throw the error
          setState(prev => ({ ...prev, isLoading: false }));
          
          logAuthEvent('LOGIN_FAILED_FINAL', {
            totalAttempts: maxRetries,
            finalError: error instanceof Error ? error.message : 'unknown_error',
            reason: 'all_login_attempts_exhausted'
          }, 'error');
          
          throw error;
        }
        
        // Wait before retrying (exponential backoff)
        const retryDelay = Math.pow(2, retryCount) * 1000;
        
        logAuthEvent('LOGIN_RETRY_DELAY', {
          attempt: retryCount + 1,
          retryDelay,
          nextAttempt: retryCount + 2,
          reason: 'waiting_before_retry'
        });
        
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retryCount++;
      }
    }
  };

  const logout = async () => {
    logAuthEvent('LOGOUT_START', {
      currentUserId: state.user?.userId,
      currentEmail: state.user?.email,
      hasAccessToken: !!state.accessToken,
      hasRefreshToken: !!state.refreshToken,
      reason: 'user_initiated_logout'
    });

    try {
      // Store current state for cleanup reference
      const currentUserId = state.user?.userId;
      const currentEmail = state.user?.email;

      // FIXED: Notify server FIRST before clearing local state
      if (currentUserId) {
        logAuthEvent('LOGOUT_NOTIFYING_SERVER', {
          userId: currentUserId,
          apiUrl: `${API_URL}/logout`,
          reason: 'server_cleanup_attempt'
        });

        try {
          const response = await fetch(`${API_URL}/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId }),
          });

          logAuthEvent('LOGOUT_SERVER_RESPONSE', {
            userId: currentUserId,
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            reason: 'server_logout_response'
          });

          if (response.ok) {
            const responseData = await response.json();
            logAuthEvent('LOGOUT_SERVER_SUCCESS', {
              userId: currentUserId,
              message: responseData.message,
              reason: 'server_logout_confirmed'
            });
          } else {
            logAuthEvent('LOGOUT_SERVER_ERROR', {
              userId: currentUserId,
              status: response.status,
              statusText: response.statusText,
              reason: 'server_logout_failed'
            }, 'warn');
          }
        } catch (error) {
          logAuthEvent('LOGOUT_SERVER_NOTIFICATION_FAILED', {
            userId: currentUserId,
            error: error instanceof Error ? error.message : 'unknown_error',
            reason: 'server_unreachable_during_logout'
          }, 'warn');
          // Continue with local logout even if server notification fails
        }
      } else {
        logAuthEvent('LOGOUT_NO_USER_ID', {
          reason: 'no_user_to_notify_server'
        }, 'warn');
      }

      logAuthEvent('LOGOUT_CLEARING_LOCAL_STATE', {
        userId: currentUserId,
        email: currentEmail,
        reason: 'clearing_local_state_after_server_notification'
      });

      // THEN clear local state after server notification
      setState({
        user: null,
        accessToken: null,
        refreshToken: null,
        isLoading: false,
        isAuthenticated: false,
      });

      logAuthEvent('LOGOUT_LOCAL_STATE_CLEARED', {
        userId: currentUserId,
        reason: 'local_state_reset_complete'
      });

      logAuthEvent('LOGOUT_CLEARING_STORAGE', {
        userId: currentUserId,
        reason: 'removing_persisted_auth'
      });

      // Clear stored data
      await Promise.all([
        AsyncStorage.removeItem('accessToken'),
        AsyncStorage.removeItem('refreshToken'),
        AsyncStorage.removeItem('user'),
      ]);

      logAuthEvent('LOGOUT_STORAGE_CLEARED', {
        userId: currentUserId,
        reason: 'persisted_auth_removed'
      });

      // Verify storage is actually cleared
      const [accessToken, refreshToken, userData] = await Promise.all([
        AsyncStorage.getItem('accessToken'),
        AsyncStorage.getItem('refreshToken'),
        AsyncStorage.getItem('user'),
      ]);

      logAuthEvent('LOGOUT_STORAGE_VERIFICATION', {
        userId: currentUserId,
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        hasUserData: !!userData,
        storageCleared: !accessToken && !refreshToken && !userData,
        reason: 'verifying_storage_cleanup'
      });

      logAuthEvent('LOGOUT_SUCCESS', {
        userId: currentUserId,
        email: currentEmail,
        reason: 'logout_completed_successfully'
      });

    } catch (error) {
      logAuthEvent('LOGOUT_ERROR', {
        error: error instanceof Error ? error.message : 'unknown_error',
        currentUserId: state.user?.userId,
        reason: 'logout_process_error'
      }, 'error');

      // Ensure state is cleared even if there's an error
      setState({
        user: null,
        accessToken: null,
        refreshToken: null,
        isLoading: false,
        isAuthenticated: false,
      });

      logAuthEvent('LOGOUT_FORCED_STATE_CLEAR', {
        reason: 'ensuring_clean_state_after_error'
      });

      throw error;
    }
  };

  const refreshAccessToken = async () => {
    logAuthEvent('TOKEN_REFRESH_START', {
      hasRefreshToken: !!state.refreshToken,
      currentUserId: state.user?.userId,
      reason: 'access_token_refresh_needed'
    });

    try {
      if (!state.refreshToken) {
        logAuthEvent('TOKEN_REFRESH_NO_REFRESH_TOKEN', {
          reason: 'no_refresh_token_available'
        }, 'error');
        
        throw new Error('No refresh token available');
      }

      logAuthEvent('TOKEN_REFRESH_ATTEMPTING', {
        apiUrl: `${API_URL}/refresh-token`,
        currentUserId: state.user?.userId,
        reason: 'sending_refresh_request'
      });

      const response = await fetch(`${API_URL}/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: state.refreshToken }),
      });

      logAuthEvent('TOKEN_REFRESH_RESPONSE', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        reason: 'refresh_response_received'
      });

      const data = await response.json();

      if (!response.ok) {
        logAuthEvent('TOKEN_REFRESH_FAILED', {
          status: response.status,
          error: data.error,
          reason: 'server_rejected_refresh'
        }, 'error');

        // If refresh token is invalid, log the user out
        logAuthEvent('TOKEN_REFRESH_FORCING_LOGOUT', {
          reason: 'invalid_refresh_token'
        });

        await logout();
        throw new Error(data.error || 'Token refresh failed');
      }

      if (!data.accessToken) {
        logAuthEvent('TOKEN_REFRESH_NO_ACCESS_TOKEN', {
          reason: 'refresh_response_missing_access_token'
        }, 'error');
        
        throw new Error('No access token in refresh response');
      }

      logAuthEvent('TOKEN_REFRESH_STORING_NEW_TOKEN', {
        currentUserId: state.user?.userId,
        reason: 'updating_stored_access_token'
      });

      // Update the access token in storage and state
      await AsyncStorage.setItem('accessToken', data.accessToken);
      
      setState(prev => ({
        ...prev,
        accessToken: data.accessToken,
      }));

      logAuthEvent('TOKEN_REFRESH_SUCCESS', {
        currentUserId: state.user?.userId,
        reason: 'access_token_refreshed_successfully'
      });

      return data.accessToken;
    } catch (error) {
      logAuthEvent('TOKEN_REFRESH_ERROR', {
        error: error instanceof Error ? error.message : 'unknown_error',
        currentUserId: state.user?.userId,
        reason: 'token_refresh_process_error'
      }, 'error');

      // If refresh fails, log the user out
      logAuthEvent('TOKEN_REFRESH_FORCING_LOGOUT_ON_ERROR', {
        reason: 'refresh_failed_forcing_logout'
      });

      await logout();
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        refreshAccessToken,
        state,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 