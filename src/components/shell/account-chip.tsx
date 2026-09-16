import { useState, type FormEvent } from "react";
import {
  closeAccountDialog,
  openAccountDialog,
  sendMagicLink,
  signInWithGoogle,
  signOutAccount,
  useAccount,
} from "@/lib/cloud/account";
import { backupPhotos } from "@/lib/cloud/sync";
import { LOCAL_ONLY_CAPTION, SIGN_IN_PROMPT, savedAccountCopy } from "@/lib/cloud/copy";
import { cn } from "@/lib/utils";

export function AccountChip({ night, count }: { night: boolean; count: number }) {
  const account = useAccount();
  const quiet = night ? "text-champagne/70" : "text-ink-soft";

  if (!account.configured) return null;
  if (account.pending) return null;

  let label = SIGN_IN_PROMPT;
  if (account.progress) label = account.progress;
  else if (account.user && account.localOnly) label = LOCAL_ONLY_CAPTION;
  else if (account.user) label = savedAccountCopy(count);

  return (
    <>
      <button
        type="button"
        onClick={() => openAccountDialog()}
        className={cn(
          "micro text-left hover:opacity-80",
          account.user ? "max-w-[14rem] truncate sm:max-w-none" : "",
          quiet,
        )}
      >
        {label}
      </button>
      {account.dialogOpen &&
        (account.user ? (
          <SignedInDialog night={night} email={account.user.email} />
        ) : (
          <SignInDialog night={night} />
        ))}
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
          onClick={() => void signInWithGoogle()}
          className="mt-5 h-11 w-full bg-accent text-sm text-paper"
        >
          Sign in with Google
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
          onClick={() => {
            backupPhotos();
            closeAccountDialog();
          }}
          className="mt-5 h-11 w-full bg-accent text-sm text-paper"
        >
          Backup photos
        </button>
        <button
          type="button"
          onClick={() => void signOutAccount()}
          className="mt-3 h-11 w-full border border-hairline text-sm"
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
