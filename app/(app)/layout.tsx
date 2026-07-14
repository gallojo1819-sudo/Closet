import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/logout-button";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <div className="min-h-svh bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur">
        <span className="text-lg font-semibold tracking-tight">Closet</span>
        <LogoutButton />
      </header>
      <main className="mx-auto w-full max-w-md px-4 pb-20 pt-6">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
