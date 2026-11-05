"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  TrendingUp,
  ClipboardCheck,
  RefreshCw,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/",           label: "Dashboard",  icon: LayoutDashboard },
  { href: "/bookings",   label: "Bookings",   icon: CalendarDays    },
  { href: "/revenue",    label: "Doanh thu",  icon: TrendingUp      },
  { href: "/attendance", label: "Chấm công",  icon: ClipboardCheck  },
  { href: "/settings",   label: "Sync",       icon: RefreshCw       },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-slate-900 border-t border-slate-700"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                active ? "text-amber-400" : "text-slate-400 active:text-slate-200"
              }`}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 1.75} />
              <span className="text-[9px] font-medium leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
