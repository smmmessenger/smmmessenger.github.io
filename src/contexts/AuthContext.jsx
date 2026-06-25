import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { initGoogleDrive, loginToGoogle, logoutFromGoogle, trySilentLogin } from '../lib/storage';
import { deriveKey, verifyKey, loadOrCreateSalt } from '../lib/encryption';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [isGoogleReady, setIsGoogleReady] = useState(false);
  const [isGoogleAuthed, setIsGoogleAuthed] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // isAutoConnecting: true while we attempt silent Google reconnect on page load
  const [isAutoConnecting, setIsAutoConnecting] = useState(true);
  const [encryptionKey, setEncryptionKey] = useState(null);
  const [error, setError] = useState(null);

  const initStarted = useRef(false);

  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;

    const checkGoogle = setInterval(() => {
      if (typeof google !== 'undefined' && typeof gapi !== 'undefined') {
        clearInterval(checkGoogle);
        initGoogleDrive(
          async () => {
            setIsGoogleReady(true);

            // Automatically try to silently reconnect to Google.
            // If the user's Google session is still active in this browser
            // (which it almost always is), this will succeed without any
            // popup and skip them straight to the master password step.
            try {
              const success = await trySilentLogin();
              if (success) {
                await loadOrCreateSalt();
                setIsGoogleAuthed(true);
              }
            } catch {
              // Silent login failed — no problem, they'll use the button
            }
            setIsAutoConnecting(false);
          },
          (err) => {
            setError(err.message || 'Google API initialisation failed.');
            setIsAutoConnecting(false);
          }
        );
      }
    }, 100);

    return () => {
      initStarted.current = false;
      clearInterval(checkGoogle);
    };
  }, []);

  /**
   * Manual Google login (shows popup on first-ever use, silent after that).
   */
  const login = async () => {
    setError(null);
    try {
      await loginToGoogle();
      await loadOrCreateSalt();
      setIsGoogleAuthed(true);
    } catch (e) {
      setError(e.message || 'Google sign-in failed.');
    }
  };

  const logout = () => {
    logoutFromGoogle();
    setEncryptionKey(null);
    setIsAuthenticated(false);
    setIsGoogleAuthed(false);
  };

  /**
   * Derive and verify the encryption key from the given master password.
   */
  const unlock = async (password) => {
    setError(null);
    try {
      const key = await deriveKey(password);
      const valid = await verifyKey(key);

      if (!valid) {
        return { success: false, error: 'Incorrect master password.' };
      }

      setEncryptionKey(key);
      setIsAuthenticated(true);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Failed to derive encryption key.' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        isGoogleReady,
        isGoogleAuthed,
        isAutoConnecting,
        isAuthenticated,
        encryptionKey,
        error,
        login,
        logout,
        unlock,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
