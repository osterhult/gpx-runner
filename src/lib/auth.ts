import { useState, useEffect } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  User
} from 'firebase/auth';
import { auth } from './firebase';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false); // Start as false to show login immediately
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If no auth, just set loading to false and return
    if (!auth) {
      console.log("Firebase auth not available");
      setLoading(false);
      return;
    }

    console.log("Setting up auth listener");
    
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log("Auth state changed:", user?.email);
      setUser(user);
      setLoading(false);
    }, (error) => {
      console.error("Auth error:", error);
      setError(error.message);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return { user, loading, error };
};

export const login = async (email: string, password: string) => {
  if (!auth) throw new Error("Auth not initialized");
  return signInWithEmailAndPassword(auth, email, password);
};

export const register = async (email: string, password: string) => {
  if (!auth) throw new Error("Auth not initialized");
  return createUserWithEmailAndPassword(auth, email, password);
};

export const logout = async () => {
  if (!auth) throw new Error("Auth not initialized");
  return signOut(auth);
};

export const resetPassword = async (email: string) => {
  if (!auth) throw new Error("Auth not initialized");
  return sendPasswordResetEmail(auth, email);
};