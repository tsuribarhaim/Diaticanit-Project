import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
      <section className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-teal-700">
          Phase 1
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Personal Health Companion
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Securely create your health profile and manage your personal documents.
          AI features are intentionally deferred until later phases.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/auth/sign-up"
            className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800"
          >
            Create account
          </Link>
          <Link
            href="/auth/sign-in"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
