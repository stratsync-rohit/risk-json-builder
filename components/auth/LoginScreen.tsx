'use client'

import Image from 'next/image'

type LoginScreenProps = {
  busy: boolean
  disabled: boolean
  error: string
  onSignIn: () => void
}

export function LoginScreen({ busy, disabled, error, onSignIn }: LoginScreenProps) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-8 text-slate-900">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-5 flex size-12 items-center justify-center overflow-hidden rounded-xl">
        <Image src="/image.png" alt="StratSync logo" width={48} height={48} className="size-12 object-contain" />
      </div>
      <h1 className="text-xl font-bold tracking-tight">Risk JSON Builder</h1>
      <p className="mt-2 text-sm text-slate-500">Sign in with your Stratsync account</p>
      <button type="button" disabled={disabled || busy} onClick={onSignIn} className="mt-7 inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? 'Signing in…' : 'Continue with Google'}
      </button>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700">{error}</p>}
    </section>
  </main>
}
