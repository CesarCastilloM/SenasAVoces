import { supabase } from '../lib/supabaseClient';

function hasSupabase() {
  if (supabase) return true;
  console.error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  return false;
}

// Initialize user progress for a new user
export async function initializeUserProgress(userId) {
  if (!hasSupabase()) return { success: false, error: new Error('Supabase is not configured') };

  try {
    const { error } = await supabase
      .from('user_progress')
      .insert({
        user_id: userId,
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

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error initializing user progress:', error);
    return { success: false, error };
  }
}

// Fetch user progress
export async function fetchUserProgress(userId) {
  if (!hasSupabase()) return null;

  try {
    const { data, error } = await supabase
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching user progress:', error);
    return null;
  }
}

// Fetch module progress for a user
export async function fetchModuleProgress(userId) {
  if (!hasSupabase()) return [];

  try {
    const { data, error } = await supabase
      .from('module_progress')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching module progress:', error);
    return [];
  }
}

// Update user progress after completing a sign
export async function updateSignProgress(userId, signName, module, accuracy, timeSpent) {
  if (!hasSupabase()) return { success: false, error: new Error('Supabase is not configured') };

  try {
    // Record the practice session
    const { error: practiceError } = await supabase
      .from('sign_practice')
      .insert({
        user_id: userId,
        sign_name: signName,
        module: module,
        accuracy: accuracy,
        time_spent: timeSpent,
      });

    if (practiceError) throw practiceError;

    // Update user progress
    let currentProgress;
    const { data: progressData, error: fetchError } = await supabase
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    // If user progress doesn't exist, initialize it first
    if (fetchError && fetchError.code === 'PGRST116') {
      const { error: initError } = await initializeUserProgress(userId);
      if (initError) throw initError;
      
      // Fetch the newly created progress
      const { data: newProgress, error: refetchError } = await supabase
        .from('user_progress')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (refetchError) throw refetchError;
      currentProgress = newProgress;
    } else if (fetchError) {
      throw fetchError;
    } else {
      currentProgress = progressData;
    }

    const newTotalSigns = (currentProgress.total_signs_learned || 0) + 1;
    const newTotalTime = (currentProgress.total_practice_time || 0) + Math.floor(timeSpent / 60);
    const newAverageAccuracy = (
      (currentProgress.average_accuracy * currentProgress.total_signs_learned + accuracy) / newTotalSigns
    ).toFixed(2);

    const { error: updateError } = await supabase
      .from('user_progress')
      .update({
        total_signs_learned: newTotalSigns,
        total_practice_time: newTotalTime,
        average_accuracy: parseFloat(newAverageAccuracy),
        last_practice_date: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    // Update weekly activity and practice days
    await updateWeeklyActivity(userId);
    await updatePracticeDays(userId);

    return { success: true };
  } catch (error) {
    console.error('Error updating sign progress:', error);
    return { success: false, error };
  }
}

// Update module progress
export async function updateModuleProgress(userId, moduleId, signsCompleted, totalSigns, status) {
  if (!hasSupabase()) return { success: false, error: new Error('Supabase is not configured') };

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('module_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (existing) {
      // Update existing module progress
      const { error: updateError } = await supabase
        .from('module_progress')
        .update({
          signs_completed: signsCompleted,
          total_signs: totalSigns,
          status: status || existing.status,
        })
        .eq('user_id', userId)
        .eq('module_id', moduleId);

      if (updateError) throw updateError;
    } else {
      // Create new module progress
      const { error: insertError } = await supabase
        .from('module_progress')
        .insert({
          user_id: userId,
          module_id: moduleId,
          signs_completed: signsCompleted,
          total_signs: totalSigns,
          status: status || 'current',
        });

      if (insertError) throw insertError;
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating module progress:', error);
    return { success: false, error };
  }
}

// Update streak
export async function updateStreak(userId) {
  if (!hasSupabase()) return { success: false, error: new Error('Supabase is not configured') };

  try {
    let currentProgress;
    const { data: progressData, error: fetchError } = await supabase
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    // If user progress doesn't exist, initialize it first
    if (fetchError && fetchError.code === 'PGRST116') {
      const { error: initError } = await initializeUserProgress(userId);
      if (initError) throw initError;
      
      // Fetch the newly created progress
      const { data: newProgress, error: refetchError } = await supabase
        .from('user_progress')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (refetchError) throw refetchError;
      currentProgress = newProgress;
    } else if (fetchError) {
      throw fetchError;
    } else {
      currentProgress = progressData;
    }

    const lastPractice = currentProgress.last_practice_date ? new Date(currentProgress.last_practice_date) : null;
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let newStreak = currentProgress.streak_days || 0;

    if (lastPractice) {
      // Check if last practice was yesterday (consecutive day)
      if (lastPractice.toDateString() === yesterday.toDateString()) {
        newStreak += 1;
      }
      // Check if last practice was today (already practiced today)
      else if (lastPractice.toDateString() === today.toDateString()) {
        newStreak = newStreak; // Keep same streak
      }
      // Streak broken
      else {
        newStreak = 1;
      }
    } else {
      // First practice ever
      newStreak = 1;
    }

    const { error: updateError } = await supabase
      .from('user_progress')
      .update({
        streak_days: newStreak,
        last_practice_date: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    return { success: true, streak: newStreak };
  } catch (error) {
    console.error('Error updating streak:', error);
    return { success: false, error };
  }
}

// Get recent practice history
export async function getRecentPractice(userId, limit = 10) {
  if (!hasSupabase()) return [];

  try {
    const { data, error } = await supabase
      .from('sign_practice')
      .select('*')
      .eq('user_id', userId)
      .order('practice_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching recent practice:', error);
    return [];
  }
}

// Get practice history grouped by day for heatmap (Anki/Migaku style).
// Returns an array of { date: 'YYYY-MM-DD', count: number, accuracy: number } for the last `days` days.
export async function getPracticeHeatmapData(userId, days = 140) {
  if (!hasSupabase()) return [];

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('sign_practice')
      .select('practice_date, accuracy, time_spent')
      .eq('user_id', userId)
      .gte('practice_date', startDate.toISOString())
      .order('practice_date', { ascending: true });

    if (error) throw error;

    // Group by day
    const byDay = new Map();
    for (const row of data || []) {
      const d = new Date(row.practice_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const entry = byDay.get(key) || { date: key, count: 0, accSum: 0, accCount: 0, timeSpent: 0 };
      entry.count += 1;
      if (typeof row.accuracy === 'number') {
        entry.accSum += row.accuracy;
        entry.accCount += 1;
      }
      entry.timeSpent += row.time_spent || 0;
      byDay.set(key, entry);
    }

    return Array.from(byDay.values()).map((e) => ({
      date: e.date,
      count: e.count,
      accuracy: e.accCount > 0 ? e.accSum / e.accCount : 0,
      timeSpent: e.timeSpent,
    }));
  } catch (error) {
    console.error('Error fetching practice heatmap data:', error);
    return [];
  }
}

// Record video view
export async function recordVideoView(userId, signName, moduleId, lessonId) {
  if (!hasSupabase()) return { success: false, error: new Error('Supabase is not configured') };

  try {
    const { error } = await supabase
      .from('video_views')
      .insert({
        user_id: userId,
        sign_name: signName,
        module_id: moduleId,
        lesson_id: lessonId,
        view_date: new Date().toISOString(),
      });

    if (error) throw error;

    // Update lesson progress
    await updateLessonProgress(userId, lessonId, signName);

    return { success: true };
  } catch (error) {
    console.error('Error recording video view:', error);
    return { success: false, error };
  }
}

// Update lesson progress
export async function updateLessonProgress(userId, lessonId, signName) {
  if (!hasSupabase()) return { success: false, error: new Error('Supabase is not configured') };

  try {
    let currentProgress;
    const { data: progressData, error: fetchError } = await supabase
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code === 'PGRST116') {
      const { error: initError } = await initializeUserProgress(userId);
      if (initError) throw initError;
      
      const { data: newProgress, error: refetchError } = await supabase
        .from('user_progress')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (refetchError) throw refetchError;
      currentProgress = newProgress;
    } else if (fetchError) {
      throw fetchError;
    } else {
      currentProgress = progressData;
    }

    const lessonProgress = currentProgress.lesson_progress || {};
    if (!lessonProgress[lessonId]) {
      lessonProgress[lessonId] = { signs_viewed: [], completed: false };
    }
    
    if (!lessonProgress[lessonId].signs_viewed.includes(signName)) {
      lessonProgress[lessonId].signs_viewed.push(signName);
    }

    const { error: updateError } = await supabase
      .from('user_progress')
      .update({ lesson_progress: lessonProgress })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    return { success: true };
  } catch (error) {
    console.error('Error updating lesson progress:', error);
    return { success: false, error };
  }
}

// Update weekly activity
export async function updateWeeklyActivity(userId) {
  if (!hasSupabase()) return { success: false, error: new Error('Supabase is not configured') };

  try {
    let currentProgress;
    const { data: progressData, error: fetchError } = await supabase
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code === 'PGRST116') {
      const { error: initError } = await initializeUserProgress(userId);
      if (initError) throw initError;
      
      const { data: newProgress, error: refetchError } = await supabase
        .from('user_progress')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (refetchError) throw refetchError;
      currentProgress = newProgress;
    } else if (fetchError) {
      throw fetchError;
    } else {
      currentProgress = progressData;
    }

    const weeklyActivity = currentProgress.weekly_activity || [];
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
    const weekNumber = Math.floor(today.getDate() / 7);

    // Ensure we have enough weeks
    while (weeklyActivity.length <= weekNumber) {
      weeklyActivity.push(Array(7).fill(0));
    }

    // Increment today's activity level (max 4)
    weeklyActivity[weekNumber][dayOfWeek] = Math.min(4, (weeklyActivity[weekNumber][dayOfWeek] || 0) + 1);

    const { error: updateError } = await supabase
      .from('user_progress')
      .update({ weekly_activity: weeklyActivity })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    return { success: true };
  } catch (error) {
    console.error('Error updating weekly activity:', error);
    return { success: false, error };
  }
}

// Get recommendations based on user progress
export async function getRecommendations(userId) {
  if (!hasSupabase()) return [];

  try {
    const { data: progressData, error: progressError } = await supabase
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (progressError && progressError.code !== 'PGRST116') throw progressError;

    const { data: moduleData, error: moduleError } = await supabase
      .from('module_progress')
      .select('*')
      .eq('user_id', userId);

    if (moduleError) throw moduleError;

    const recommendations = [];

    // Recommend current module if not completed
    const currentModule = moduleData?.find(m => m.status === 'current');
    if (currentModule) {
      recommendations.push({
        type: 'continue',
        moduleId: currentModule.module_id,
        reason: 'Continúa con tu módulo actual',
      });
    }

    // Recommend practice if streak is low
    if (progressData?.streak_days < 3) {
      recommendations.push({
        type: 'practice',
        reason: 'Practica más para aumentar tu racha',
      });
    }

    // Recommend review if accuracy is below threshold
    if (progressData?.average_accuracy < 0.7) {
      recommendations.push({
        type: 'review',
        reason: 'Repasa señas para mejorar tu precisión',
      });
    }

    // Recommend next module if current is nearly complete
    if (currentModule && currentModule.signs_completed / currentModule.total_signs > 0.8) {
      const nextModuleIndex = moduleData?.findIndex(m => m.module_id === currentModule.module_id) + 1;
      if (nextModuleIndex < moduleData?.length) {
        recommendations.push({
          type: 'next_module',
          moduleId: moduleData[nextModuleIndex].module_id,
          reason: '¡Estás cerca de completar este módulo!',
        });
      }
    }

    return recommendations;
  } catch (error) {
    console.error('Error getting recommendations:', error);
    return [];
  }
}

// Update practice days count
export async function updatePracticeDays(userId) {
  if (!hasSupabase()) return { success: false, error: new Error('Supabase is not configured') };

  try {
    // Count unique practice days
    const { data: practiceData, error: countError } = await supabase
      .from('sign_practice')
      .select('practice_date')
      .eq('user_id', userId);

    if (countError) throw countError;

    const uniqueDays = new Set(
      practiceData?.map(p => new Date(p.practice_date).toDateString()) || []
    ).size;

    const { error: updateError } = await supabase
      .from('user_progress')
      .update({ practice_days: uniqueDays })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    return { success: true, practiceDays: uniqueDays };
  } catch (error) {
    console.error('Error updating practice days:', error);
    return { success: false, error };
  }
}
