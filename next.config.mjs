/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@xenova/transformers", "unpdf", "mammoth", "postgres"],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // @xenova/transformers now also runs client-side (voice input, in a
      // Web Worker) as well as server-side (embeddings). Its own
      // package.json "browser" field already maps out fs/path/url/sharp/
      // onnxruntime-node — this covers a few Node built-ins that show up
      // transitively (through onnxruntime-web/protobufjs) that aren't
      // caught by that field, so the browser bundle doesn't fail trying
      // to resolve them. Its WASM runtime and model weights are fetched
      // from a CDN/Hugging Face at runtime, not bundled here, so nothing
      // else is needed for that part.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        buffer: false,
      };
    }
    return config;
  },
};

export default nextConfig;
