import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    // Avoid workspace root mis-detection that can cause
    // "Next.js package not found" panics on dev.
    root: process.cwd(),
  },
  async redirects() {
    return [
      {
        source: "/barangay/comments",
        destination: "/barangay/feedback",
        permanent: false,
      },
      {
        source: "/city/comments",
        destination: "/city/feedback",
        permanent: false,
      },
      {
        source: "/about",
        destination: "/about-us",
        permanent: false,
      },
      {
        source: "/aboutus",
        destination: "/about-us",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
