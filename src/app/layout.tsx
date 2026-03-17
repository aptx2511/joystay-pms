import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "Joystay PMS",
  description: "Property Management System for Joystay Boutique Homestay",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
        </div>
      </body>
    </html>
  );
}
