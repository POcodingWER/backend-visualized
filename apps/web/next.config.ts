import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@bv/sdk'],
  // lint은 루트 ESLint flat config로 별도 실행 (pnpm lint)
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
