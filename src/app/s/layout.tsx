import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Joystay — Your stay",
  description: "Guest registration, door codes and help for your Joystay stay.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function StayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
