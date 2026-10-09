import { NavLink as Link } from "@/components/nav-link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
      <section className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-teal-700">
          Personal health companion
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Daffy
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Daffy helps you reach your health goals: personal daily targets, a log of your meals and activity, your lab
          results and documents in one place, and an AI coach that answers your questions. Currently a pilot for invited users.
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
        <p className="mt-8 text-sm text-slate-500">
          <Link href="/privacy" className="font-semibold text-teal-700 hover:underline">
            Privacy Policy
          </Link>
        </p>
      </section>
    </main>
  );
}
