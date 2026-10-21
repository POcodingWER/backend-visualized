// 필요한 로고만 하나씩 가져온다 → 번들에는 이 아이콘들만 들어간다 (simple-icons 전체 X)
import {
  siCaddy,
  siDocker,
  siEthereum,
  siEthers,
  siGithub,
  siGithubactions,
  siMysql,
  siNestjs,
  siNextdotjs,
  siNodedotjs,
  siNuxt,
  siPnpm,
  siPrisma,
  siReact,
  siReactquery,
  siRedis,
  siSentry,
  siSolidity,
  siStorybook,
  siTurborepo,
  siTypescript,
  siVite,
  siVuedotjs,
  siWeb3dotjs,
} from 'simple-icons';
import type { ChipIcon } from '../components/atoms/TechChip';

/** 기술 스택 칩 이름 → 로고. 이름은 landing-content.ts AUTHOR.stack과 글자 그대로 같아야 한다 */
export const TECH_ICONS: Record<string, ChipIcon> = {
  React: siReact,
  TypeScript: siTypescript,
  Vite: siVite,
  'React Query': siReactquery,
  'Nuxt.js': siNuxt,
  'Vue.js': siVuedotjs,
  'Next.js': siNextdotjs,
  'PNPM workspace': siPnpm,
  Turborepo: siTurborepo,
  Sentry: siSentry,
  Storybook: siStorybook,
  'Node.js 스크립트': siNodedotjs,
  'NestJS 11': siNestjs,
  'Prisma 6': siPrisma,
  'MySQL 8': siMysql,
  'Redis 7': siRedis,
  Docker: siDocker,
  Caddy: siCaddy,
  'GitHub Actions': siGithubactions,
  // GHCR = GitHub 컨테이너 저장소라 GitHub 로고
  GHCR: siGithub,
  Solidity: siSolidity,
  Ethereum: siEthereum,
  'Web3.js': siWeb3dotjs,
  'ethers.js': siEthers,
};

/**
 * 로고 없이 글자만 두는 칩. AWS 로고는 상표 문제로 simple-icons에 없고(직접 그려 넣지 않는다),
 * style-dictionary는 로고가 없다.
 */
export const TEXT_ONLY_TECH = [
  'AWS Lambda@Edge',
  'S3',
  'CloudFront',
  'style-dictionary',
  'EC2',
  'SSM',
  'IAM OIDC',
  'S3 백업',
];
