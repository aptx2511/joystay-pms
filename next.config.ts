import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma"],
  async rewrites() {
    return [
      {
        source: "/ical/:roomId.ics",
        destination: "/api/ical/export/:roomId",
      },
    ];
  },
};

export default nextConfig;
