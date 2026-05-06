import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // PDV CSV de 1 mes ronda 1.5MB. Margem para periodos maiores.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
