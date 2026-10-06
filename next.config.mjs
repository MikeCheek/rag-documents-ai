/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@xenova/transformers", "unpdf", "mammoth", "postgres"],
  },
};

export default nextConfig;
