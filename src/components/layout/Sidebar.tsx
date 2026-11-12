"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  Building2,
  RefreshCw,
  TrendingUp,
  ClipboardCheck,
  Sparkles,
  BedDouble,
  Tag,
  Wallet,
  BarChart3,
  Lock,
  LogIn,
  LogOut,
} from "lucide-react";
import { logout, PUBLIC_NAV, useAuth } from "@/lib/hooks/useAuth";

const NAV_ITEMS = [
  { href: "/",           label: "Dashboard",   icon: LayoutDashboard },
  { href: "/bookings",   label: "Bookings",    icon: CalendarDays    },
  { href: "/revenue",    label: "Doanh thu",   icon: TrendingUp      },
  { href: "/thu-chi",    label: "Thu chi",     icon: Wallet          },
  { href: "/gia-phong-trong", label: "Giá & trống", icon: Tag      },
  { href: "/gia-kenh",   label: "Giá các kênh", icon: BarChart3      },
  { href: "/luu-tru",    label: "Lưu trú",     icon: BedDouble       },
  { href: "/housekeeping", label: "Dọn phòng", icon: Sparkles        },
  { href: "/attendance", label: "Chấm công",   icon: ClipboardCheck  },
  { href: "/settings",   label: "iCal / Sync", icon: RefreshCw       },
];

export default function Sidebar() {
  const pathname = usePathname();
  const auth = useAuth();
  if (pathname === "/login") return null;
  if (pathname?.startsWith("/t/") || pathname === "/s" || pathname?.startsWith("/s/")) return null; // trang lao công: không hiện menu quản trị

  return (
    <aside className="hidden md:flex w-60 min-h-screen bg-slate-900 text-slate-100 flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <Building2 className="text-amber-400" size={22} />
          <span className="font-bold text-lg tracking-tight">Joystay</span>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">Property Management</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-amber-500 text-slate-900"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <Icon size={18} />
              {label}
              {auth && !auth.authed && !PUBLIC_NAV.has(href) && <Lock size={13} className="ml-auto text-slate-500" />}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-3">
        {auth?.authed ? (
          <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white"><LogOut size={16} /> Đăng xuất</button>
        ) : auth ? (
          <Link href="/login" className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-amber-400 hover:bg-slate-800"><LogIn size={16} /> Đăng nhập quản trị</Link>
        ) : null}
      </div>

      {/* Room legend */}
      <div className="px-4 pb-4 pt-2 border-t border-slate-700">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Booking Sources</p>
        <div className="space-y-1.5">
          {[
            { label: "Airbnb",       dot: "bg-rose-500"    },
            { label: "Direct",       dot: "bg-blue-500"    },
            { label: "Offline/Zalo", dot: "bg-emerald-500" },
          ].map(({ label, dot }) => (
            <div key={label} className="flex items-center gap-2 text-xs text-slate-400">
              <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
              {label}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
