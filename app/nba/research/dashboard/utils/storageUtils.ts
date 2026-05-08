// Utility functions for safe browser storage access

import { SESSION_KEY } from '../types';

/**
 * Safely gets an item from sessionStorage
 */
export function getSessionStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Safely sets an item in sessionStorage
 */
export function setSessionStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage access failures on restricted browsers.
  }
}

/**
 * Safely gets an item from localStorage
 */
export function getLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Safely sets an item in localStorage
 */
export function setLocalStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage access failures on restricted browsers.
  }
}

/**
 * Safely gets the saved session from sessionStorage
 */
export function getSavedSession(): string | null {
  return getSessionStorage(SESSION_KEY);
}

/**
 * Safely saves a session to sessionStorage
 */
export function saveSession(value: string): void {
  setSessionStorage(SESSION_KEY, value);
}

/**
 * Safely updates a property in the saved session
 */
export function updateSessionProperty(key: string, value: any): void {
  const saved = getSavedSession();
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      parsed[key] = value;
      setSessionStorage(SESSION_KEY, JSON.stringify(parsed));
    } catch {}
  }
}

/**
 * Safely removes a session from sessionStorage
 */
export function removeSession(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage access failures on restricted browsers.
  }
}

