"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  signUpAction,
  type AuthActionState,
} from "@/app/auth/actions";
import { AuthSubmitButton } from "@/components/auth-submit-button";

const initialState: AuthActionState = {};

export default function SignUpPage() {
  const [state, formAction] = useActionState(signUpAction, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Create account</h1>
        <p className="mt-2 text-sm text-slate-600">
          Start your secure onboarding journey.
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Email
            </span>
            <input
              type="email"
              name="email"
              required
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 placeholder:text-slate-400 focus:ring-2"
              placeholder="you@example.com"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Password
            </span>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 placeholder:text-slate-400 focus:ring-2"
              placeholder="At least 8 characters"
            />
          </label>

          {state.error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.error}
            </p>
          ) : null}
          {state.success ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {state.success}
            </p>
          ) : null}

          <AuthSubmitButton
            idleLabel="Create account"
            pendingLabel="Creating account..."
          />
        </form>

        <p className="mt-5 text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="font-semibold text-teal-700">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
