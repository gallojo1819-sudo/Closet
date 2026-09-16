import { useState, type FormEvent } from "react";
import {
  closeAccountDialog,
  openAccountDialog,
  sendMagicLink,
  signInWithApple,
  signOutAccount,
  useAccount,
} from "@/lib/cloud/account";
import { LOCAL_ONLY_CAPTION, SIGN_IN_PROMPT, savedAccountCopy } from "@/lib/cloud/copy";
import { cn } from "@/lib/utils";

export function AccountChip({ night, count }: { night: boolean; count: number }) {
  const account = useAccount();
  const quiet = night ? "text-champagne/70" : "text-ink-soft";

  if (!account.configured) return null;
  if (account.pending) return null;

  if (account.progress) {
    return <span className={cn("micro max-w-[14rem] truncate sm:max-w-none", quiet)}>{account.progress}</span>;
  }
  if (account.user && account.localOnly) {
    return <span className={cn("micro max-w-[16rem] truncate sm:max-w-none", quiet)}>{LOCAL_ONLY_CAPTION}</span>;
  }

  if (!account.user) {
    return (
      <>
        <button
          type="button"
          onClick={() => openAccountDialog()}
          className={cn("micro text-left hover:opacity-80", quiet)}
        >
          {SIGN_IN_PROMPT}
        </button>
        {account.dialogOpen && <SignInDialog night={night} />}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => openAccountDialog()}
        className={cn("micro max-w-[11rem] truncate sm:max-w-none hover:opacity-80", quiet)}
      >
        {savedAccountCopy(count)}
      </button>
      {account.dialogOpen && <SignedInDialog night={night} email={account.user.email} />}
    </>
  );
}

function SignInDialog({ night }: { night: boolean }) {
  const account = useAccount();
  const [email, setEmail] = useState("");

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    void sendMagicLink(email);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close"
        onClick={() => closeAccountDialog()}
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-sm border border-hairline p-6",
          night ? "bg-night text-champagne" : "bg-paper text-ink",
        )}
      >
        <p className="micro text-ink-soft">Account</p>
        <h2 className="mt-1 font-editorial text-2xl tracking-tight">
          Same closet on this phone.
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Sign in so the rack follows you. Today and Closet stay open without an account — sync starts after.
        </p>
        <button
          type="button"
          onClick={() => void signInWithApple()}
          className="mt-5 h-11 w-full bg-accent text-sm text-paper"
        >
          Sign in with Apple
        </button>
        {account.emailSent ? (
          <p className="mt-4 text-sm text-ink-soft">Check your email for the link.</p>
        ) : (
          <form onSubmit={onEmail} className="mt-4">
            <label className="micro text-ink-soft" htmlFor="closet-email">
              Magic link
            </label>
            <input
              id="closet-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="mt-1 h-11 w-full border border-hairline bg-transparent px-3 text-sm"
            />
            <button
              type="submit"
              className="mt-2 h-11 w-full border border-hairline text-sm"
            >
              Email me a link
            </button>
          </form>
        )}
        {account.error && <p className="mt-3 micro text-accent">{account.error}</p>}
        <button
          type="button"
          onClick={() => closeAccountDialog()}
          className="mt-4 micro text-ink-soft"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

function SignedInDialog({ night, email }: { night: boolean; email: string | null }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close"
        onClick={() => closeAccountDialog()}
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-sm border border-hairline p-6",
          night ? "bg-night text-champagne" : "bg-paper text-ink",
        )}
      >
        <p className="micro text-ink-soft">Account</p>
        <h2 className="mt-1 font-editorial text-2xl tracking-tight">On this account.</h2>
        <p className="mt-2 text-sm text-ink-soft">
          {email ?? "Signed in"}. The rack on this phone is a cache of your account.
        </p>
        <button
          type="button"
          onClick={() => void signOutAccount()}
          className="mt-5 h-11 w-full border border-hairline text-sm"
        >
          Sign out
        </button>
        <button
          type="button"
          onClick={() => closeAccountDialog()}
          className="mt-3 micro text-ink-soft"
        >
          Close
        </button>
      </div>
    </div>
  );
}
