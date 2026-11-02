import React, { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';
import type { Role } from '../types/studio';
import { setApiUser } from '../api/client';
import { identifierKey, initialsOf, nameFromIdentifier, readProfiles, type ProfileDetails } from '../models/profile';

export type Permission = 'edit' | 'publish' | 'deploy' | 'deploy_production';

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  initials: string;
  role: Role;
  /** The workspace name the person gave on their first sign-in (kept in this browser). */
  workspaceName?: string;
}

export interface SignInOptions {
  /** Not checked yet: there is no sign-in service. */
  password?: string;
  role?: Role;
  /** "Keep me signed in": the profile stays in this browser until sign-out (else until the browser is closed). */
  keep?: boolean;
  /** The first-time profile step's answers, remembered for this email. */
  profile?: ProfileDetails;
}

interface AuthValue {
  user: User | null;
  signingIn: boolean;
  sessionExpired: boolean;
  /** Whether the profile is kept until sign-out (localStorage) or until the browser closes (sessionStorage). */
  keepSignedIn: boolean;
  signIn: (identifier?: string, options?: SignInOptions) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => void;
  expireSession: () => void;
  reauthenticate: () => Promise<void>;
  can: (permission: Permission) => boolean;
  /** The profile remembered in this browser for an email or phone, if they have set one up here before. */
  knownProfile: (identifier: string) => ProfileDetails | null;
  /** Whether anyone has set up a profile in this browser (a first visit is greeted as new). */
  hasKnownProfiles: () => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

interface AuthProviderProps {
  children: React.ReactNode;
}

// Temporary sign-in: there is no auth API yet, so everyone gets this role. A real login replaces this provider later.
const TEMPORARY_ROLE: Role = 'admin';

// The signed-in profile (never a secret): localStorage with "Keep me signed in", else sessionStorage. The browser
// tests sign in by writing this key to sessionStorage, so both places are read.
const SESSION_STORAGE_KEY = 'weave_auth_user';
// Profiles set up in this browser, by email, so a returning person skips the profile step.
const PROFILES_KEY = 'weave_profiles';

const stores = (): Storage[] => {
  const out: Storage[] = [];
  try {
    out.push(sessionStorage, localStorage);
  } catch {
    // storage unavailable (private mode): sign-in lasts for this page only
  }
  return out;
};

function readSavedUser(): { user: User; keep: boolean } | null {
  for (const store of stores()) {
    try {
      const saved = store.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as User;
        if (parsed && typeof parsed.email === 'string') return { user: parsed, keep: store === localStorage };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function readAllProfiles(): Record<string, ProfileDetails> {
  return stores().reduce<Record<string, ProfileDetails>>((all, store) => {
    try {
      return { ...readProfiles(store.getItem(PROFILES_KEY)), ...all };
    } catch {
      return all;
    }
  }, {});
}

function rememberProfile(identifier: string, profile: ProfileDetails, keep: boolean) {
  try {
    const store = keep ? localStorage : sessionStorage;
    const all = readProfiles(store.getItem(PROFILES_KEY));
    all[identifierKey(identifier)] = { name: profile.name.trim(), workspaceName: profile.workspaceName.trim() };
    store.setItem(PROFILES_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [saved] = useState(readSavedUser);
  const [user, setUser] = useState<User | null>(() => {
    if (saved) setApiUser(saved.user.email, saved.user.name);
    return saved?.user ?? null;
  });
  const [keepSignedIn, setKeepSignedIn] = useState(saved?.keep ?? false);

  const [signingIn, setSigningIn] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    if (user) {
      setApiUser(user.email, user.name);
      try {
        // one place at a time: the other is cleared so a later visit does not find an old copy
        (keepSignedIn ? sessionStorage : localStorage).removeItem(SESSION_STORAGE_KEY);
        (keepSignedIn ? localStorage : sessionStorage).setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
      } catch {
        // ignore
      }
    } else {
      setApiUser('');
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }, [user, keepSignedIn]);

  const knownProfile = useCallback((identifier: string) => readAllProfiles()[identifierKey(identifier)] ?? null, []);
  const hasKnownProfiles = useCallback(() => Object.keys(readAllProfiles()).length > 0, []);

  const signIn = useCallback(
    async (identifier = '', options: SignInOptions = {}): Promise<{ ok: boolean; error?: string }> => {
      const { role = TEMPORARY_ROLE, keep = false, profile } = options;
      setSigningIn(true);
      await new Promise((r) => setTimeout(r, 400));

      const cleanId = identifier.trim();
      if (!cleanId) {
        setSigningIn(false);
        return { ok: false, error: 'Enter your email or phone number.' };
      }

      if (profile) rememberProfile(cleanId, profile, keep);
      const details = profile ?? readAllProfiles()[identifierKey(cleanId)] ?? null;
      const name = details?.name.trim() || nameFromIdentifier(cleanId);

      const newUser: User = {
        id: `usr_${Date.now().toString(36)}`,
        name,
        email: cleanId.includes('@') ? cleanId.toLowerCase() : `${cleanId}@weave.local`,
        phone: cleanId.includes('@') ? undefined : cleanId,
        initials: initialsOf(name),
        role,
        workspaceName: details?.workspaceName.trim() || undefined,
      };

      setKeepSignedIn(keep);
      setUser(newUser);
      setSigningIn(false);
      setSessionExpired(false);
      return { ok: true };
    },
    []
  );

  const signOut = useCallback(() => {
    setUser(null);
    setSessionExpired(false);
  }, []);

  const expireSession = useCallback(() => {
    setSessionExpired(true);
  }, []);

  const reauthenticate = useCallback(async () => {
    setSigningIn(true);
    await new Promise((r) => setTimeout(r, 500));
    setSessionExpired(false);
    setSigningIn(false);
  }, []);

  const can = useCallback(
    (permission: Permission) => {
      if (!user || sessionExpired) return false;
      if (permission === 'deploy_production') return user.role === 'admin';
      return user.role !== 'viewer';
    },
    [user, sessionExpired]
  );

  const value = useMemo(
    () => ({
      user,
      signingIn,
      sessionExpired,
      keepSignedIn,
      signIn,
      signOut,
      expireSession,
      reauthenticate,
      can,
      knownProfile,
      hasKnownProfiles,
    }),
    [user, signingIn, sessionExpired, keepSignedIn, signIn, signOut, expireSession, reauthenticate, can, knownProfile, hasKnownProfiles]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
