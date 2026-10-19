import type { NextConfig } from 'next';

// Vercel 빌드에서 API 주소가 빠지면 브라우저가 http://localhost:4000 으로 요청해 조용히 실패한다 → 빌드를 멈춘다
if (process.env.VERCEL === '1') {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('NEXT_PUBLIC_API_URL이 필요합니다 (예: https://api.example.com)');
  if (process.env.VERCEL_ENV === 'production' && !apiUrl.startsWith('https://'))
    throw new Error(`NEXT_PUBLIC_API_URL은 https여야 합니다: ${apiUrl}`);
}

const nextConfig: NextConfig = {
  transpilePackages: ['@bv/sdk'],
  // lint은 루트 ESLint flat config로 별도 실행 (pnpm lint)
  eslint: { ignoreDuringBuilds: true },
  // 장 이름을 바꾸기 전 주소
  async redirects() {
    return [
      { source: '/coupon', destination: '/ticketing', permanent: true },
      { source: '/auth', destination: '/wristband', permanent: true },
    ];
  },
};

export default nextConfig;
