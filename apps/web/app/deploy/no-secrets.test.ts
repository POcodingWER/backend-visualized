import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEPLOY_STEPS } from './steps';

// 배포 및 회고 페이지에 비밀값이 새지 않았는지: 이 폴더의 파일 전체를 훑는다
const folder = import.meta.dirname;
const sources = readdirSync(folder)
  .filter((file) => /\.(ts|tsx|css)$/.test(file) && !file.endsWith('.test.ts'))
  .map((file) => ({ file, text: readFileSync(join(folder, file), 'utf8') }));

const FORBIDDEN: [string, RegExp][] = [
  ['개인키', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS Access Key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub 토큰', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['긴 hex (openssl rand -hex, 40자 SHA 포함)', /\b[0-9a-f]{40,}\b/],
  ['긴 base64 (openssl rand -base64)', /[A-Za-z0-9+/]{48,}={0,2}/],
  ['메일 주소', /[\w.+-]+@users\.noreply\.github\.com/],
  ['DB URL 안의 비밀번호', /mysql:\/\/[^:\s]+:(?!<)[^@\s]+@/],
];
// 비밀값이 들어가는 줄은 반드시 <가림> 또는 $(openssl …)이어야 한다
const SECRET_KEYS = /^(MYSQL_ROOT_PASSWORD|MYSQL_PASSWORD|JWT_ACCESS_SECRET|ADMIN_API_KEY)=(.*)$/gm;

test('배포 페이지 파일에 비밀값 모양의 문자열이 없다', () => {
  for (const { file, text } of sources) {
    for (const [name, pattern] of FORBIDDEN) {
      assert.doesNotMatch(text, pattern, `${file}: ${name}`);
    }
  }
});

test('production.env 예시의 비밀 키는 값이 가려져 있다', () => {
  const code = DEPLOY_STEPS.flatMap((step) => step.commands.map((block) => block.code)).join('\n');
  const lines = [...code.matchAll(SECRET_KEYS)];
  assert.ok(lines.length >= 4, '검사할 줄을 못 찾음');
  for (const [, key, value] of lines) {
    assert.match(value!, /^(<[^>]+>|\$\(openssl rand [^)]+\))$/, `${key} 값이 드러남`);
  }
});
