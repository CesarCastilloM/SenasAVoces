// useIsAdmin — shared admin check for route guards and UI (navbar).
// Returns: null while checking, true/false once resolved.
// Single source of truth: the `admins` table via isAdminUser().
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isAdminUser } from '../services/lessonService.js';

export function useIsAdmin() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setIsAdmin(false);
      return undefined;
    }
    setIsAdmin(null);
    isAdminUser(user.id).then((ok) => {
      if (!cancelled) setIsAdmin(ok);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  return isAdmin;
}
