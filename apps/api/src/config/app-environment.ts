import { existsSync } from 'node:fs';
import { describeEnvironment, EnvironmentError, loadEnvironment } from './environment';

// 개발: apps/api/.env 를 읽는다 (이미 설정된 변수는 덮어쓰지 않음). 운영(Docker)에선 실제 환경 변수만 사용.
if (process.env.NODE_ENV !== 'production' && existsSync('.env')) process.loadEnvFile('.env');

function loadOrExit() {
  try {
    return loadEnvironment(process.env);
  } catch (error) {
    if (error instanceof EnvironmentError) {
      console.error(`\n[config] ${error.message}\n\n자세한 내용: docs/deploy.md 의 환경 변수 표\n`);
      process.exit(1);
    }
    throw error;
  }
}

/** 프로세스 시작 시 한 번 검증된 설정. 잘못되면 여기서 바로 종료한다 */
export const appEnvironment = loadOrExit();

export function logEnvironmentSummary(log: (line: string) => void = console.log) {
  log(`[config] ${describeEnvironment(appEnvironment)}`);
  for (const warning of appEnvironment.warnings) log(`[config] 주의: ${warning}`);
}
