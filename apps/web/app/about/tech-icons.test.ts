import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTHOR } from '../landing-content';
import { TECH_ICONS, TEXT_ONLY_TECH } from './tech-icons';

// 스택에 칩을 새로 넣으면 로고를 붙일지, 글자만 둘지 여기서 꼭 정하게 한다
test('기술 스택 칩마다 로고가 있거나 "글자만" 목록에 있다', () => {
  const labels = AUTHOR.stack.flatMap((group) => group.items);
  for (const label of labels) {
    const decided = label in TECH_ICONS || TEXT_ONLY_TECH.includes(label);
    assert.ok(decided, `${label}: TECH_ICONS 또는 TEXT_ONLY_TECH에 넣어 주세요`);
  }
  // 스택에서 빠진 이름이 목록에 남아 있지 않게
  for (const label of [...Object.keys(TECH_ICONS), ...TEXT_ONLY_TECH])
    assert.ok(labels.includes(label), `${label}: 스택에 없는 이름`);
});

test('로고 path는 비어 있지 않은 SVG 경로', () => {
  for (const [label, icon] of Object.entries(TECH_ICONS))
    assert.match(icon.path, /^M/, `${label} 로고 path가 이상함`);
});
