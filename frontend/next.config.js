/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // Optimize barrel file imports for better bundle size and faster builds
    optimizePackageImports: ['lucide-react', 'motion/react'],
  },
};

module.exports = nextConfig;
