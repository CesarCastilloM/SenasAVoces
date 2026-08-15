import { createContext, useContext, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { initializeUserProgress, getPracticeHeatmapData } from '../services/progressService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [userProgress, setUserProgress] = useState(null);
  const [moduleProgress, setModuleProgress] = useState([]);
  const [practiceHistory, setPracticeHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const authConfigError = isSupabaseConfigured ? "" : "Faltan variables de entorno de Supabase.";
  const [justLoggedIn, setJustLoggedIn] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        fetchUserProgress(session.user.id);
        fetchModuleProgress(session.user.id);
        fetchPracticeHistory(session.user.id);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        fetchUserProgress(session.user.id);
        fetchModuleProgress(session.user.id);
        fetchPracticeHistory(session.user.id);
        setJustLoggedIn(true);
        // Navigate to dashboard after successful auth
        setTimeout(() => {
          const currentPath = window.location.pathname;
          if (currentPath === '/' || currentPath === '/login' || currentPath === '/signup') {
            window.history.pushState({}, "", '/dashboard');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
        }, 100);
      } else {
        setProfile(null);
        setUserProgress(null);
        setModuleProgress([]);
        setPracticeHistory([]);
        setJustLoggedIn(false);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId) => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const fetchUserProgress = async (userId) => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('user_progress')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (error) {
        // If no progress exists yet, create default
        if (error.code === 'PGRST116') {
          setUserProgress({
            current_level: 1,
            current_lesson: 1,
            lesson_progress: {},
            total_signs_learned: 0,
            total_practice_time: 0,
            average_accuracy: 0,
            streak_days: 0,
            weekly_activity: [],
            daily_quests: [],
            practice_days: 0,
          });
        } else {
          throw error;
        }
      } else {
        setUserProgress(data);
      }
    } catch (error) {
      console.error('Error fetching user progress:', error);
    }
  };

  const fetchModuleProgress = async (userId) => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('module_progress')
        .select('*')
        .eq('user_id', userId);
      
      if (error) throw error;
      setModuleProgress(data || []);
    } catch (error) {
      console.error('Error fetching module progress:', error);
    }
  };

  const fetchPracticeHistory = async (userId) => {
    try {
      const data = await getPracticeHeatmapData(userId, 140);
      setPracticeHistory(data || []);
    } catch (error) {
      console.error('Error fetching practice history:', error);
      setPracticeHistory([]);
    }
  };

  const signUp = async ({ email, password, fullName }) => {
    if (!supabase) {
      return { data: null, error: new Error(authConfigError), requiresEmailConfirmation: false };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
          emailRedirectTo: undefined,
        },
      });

      if (error) throw error;
      
      // Check if user was created but session is null (email confirmation required)
      if (data.user && !data.session) {
        // Initialize user progress for the new user
        if (data.user?.id) {
          await initializeUserProgress(data.user.id);
        }
        return { 
          data, 
          requiresEmailConfirmation: true,
          email: email,
          error: null 
        };
      }
      
      // Initialize user progress for the new user (if session exists)
      if (data.user?.id) {
        await initializeUserProgress(data.user.id);
      }
      
      return { data, error: null, requiresEmailConfirmation: false };
    } catch (error) {
      return { data: null, error, requiresEmailConfirmation: false };
    }
  };

  const signIn = async ({ email, password }) => {
    if (!supabase) {
      return { data: null, error: new Error(authConfigError) };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  const signInWithGoogle = async () => {
    if (!supabase) {
      return { data: null, error: new Error(authConfigError) };
    }

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  const signOut = async () => {
    if (!supabase) return;

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      setProfile(null);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const updateProfile = async (updates) => {
    if (!supabase || !user) return { error: 'No user' };
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();
      if (error) throw error;
      setProfile(data);
      return { data, error: null };
    } catch (error) {
      console.error('Error updating profile:', error);
      return { data: null, error };
    }
  };

  const value = {
    user,
    profile,
    userProgress,
    moduleProgress,
    practiceHistory,
    loading,
    authConfigError,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    updateProfile,
    refreshPracticeHistory: () => user && fetchPracticeHistory(user.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
