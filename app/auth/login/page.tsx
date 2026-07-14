import { GoogleSignInButton } from "@/components/google-signin-button";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Closet</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Your wardrobe, organized.
          </p>
        </div>
        <GoogleSignInButton />
      </div>
    </div>
  );
}
