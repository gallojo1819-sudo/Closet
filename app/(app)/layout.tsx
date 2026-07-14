import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  // The shell is a neutral dark frame; each page owns its own surface (the
  // closet paints a full-bleed cream catalog, add/stylist stay dark). Sign-out
  // lives in the bottom nav so the top is free for each page's own header.
  return (
    <div className="min-h-svh bg-neutral-950 text-neutral-100">
      <main className="min-h-svh w-full">{children}</main>
      <BottomNav />
    </div>
  );
}
