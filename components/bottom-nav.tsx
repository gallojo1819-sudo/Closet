"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Shirt, Plus, Sparkles, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/closet", label: "Closet", icon: Shirt },
  { href: "/add", label: "Add", icon: Plus },
  { href: "/stylist", label: "Stylist", icon: Sparkles },
];

const itemClass =
  "flex flex-col items-center gap-1 py-3 text-[11px] tracking-wide transition-colors focus-visible:outline-none focus-visible:text-neutral-100 motion-reduce:transition-none";

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur">
      <ul className="mx-auto flex max-w-md items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  itemClass,
                  active
                    ? "text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300",
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={signOut}
            className={cn(itemClass, "w-full text-neutral-500 hover:text-neutral-300")}
          >
            <LogOut className="size-5" aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
