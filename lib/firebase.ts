'use client'

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
}

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean)
export const firebaseConfigError = 'Firebase authentication is not configured. Add the NEXT_PUBLIC_FIREBASE_* values to .env.local.'

const firebaseApp: FirebaseApp | null = isFirebaseConfigured && typeof window !== 'undefined'
  ? getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
  : null

export const auth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ hd: 'stratsync.ai' })
