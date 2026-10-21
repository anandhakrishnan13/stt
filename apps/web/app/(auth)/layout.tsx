import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight">
        Speech<span className="text-slate-400">to</span>Text
      </Link>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-8 text-xs text-slate-500">
        Real-time multilingual transcription · accounts secured with argon2id and email OTP
      </p>
    </div>
  );
}
