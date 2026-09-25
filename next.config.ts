import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfjs-dist', 'sharp', '@napi-rs/canvas'],
  outputFileTracingIncludes: {
    '/api/resume/parse': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
