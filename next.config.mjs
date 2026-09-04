/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@xenova/transformers", "pdf-parse", "mammoth", "postgres"],
  },
};

export default nextConfig;
