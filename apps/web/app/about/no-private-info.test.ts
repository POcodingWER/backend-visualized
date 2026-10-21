import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AUTHOR } from '../landing-content';

// About me에 쓰는 글(이 폴더 + AUTHOR가 사는 landing-content.ts)에 회사 메일·회사 이름이 새지 않았는지
const folder = import.meta.dirname;
const sources = [
  ...readdirSync(folder)
    .filter((file) => /\.(ts|tsx|css)$/.test(file) && !file.endsWith('.test.ts'))
    .map((file) => join(folder, file)),
  join(folder, '..', 'landing-content.ts'),
].map((path) => ({ path, text: readFileSync(path, 'utf8') }));

// 공개해도 되는 메일은 이력서·블로그에 이미 나와 있는 개인 메일 하나뿐
const PUBLIC_EMAIL = 'cjftns01@gmail.com';

test('회사 메일·회사 이름이 없다', () => {
  for (const { path, text } of sources) {
    assert.doesNotMatch(text, /hyper[\s-]?tech|하이퍼\s?테크/i, `${path}: 회사 이름`);
    for (const [email] of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) {
      assert.equal(email, PUBLIC_EMAIL, `${path}: 공개하지 않은 메일 ${email}`);
    }
  }
});

test('연락처는 공개된 것만 (개인 메일 · GitHub · 블로그 · Instagram)', () => {
  const hosts = AUTHOR.links.map((link) =>
    link.href.startsWith('mailto:') ? link.href : new URL(link.href).host,
  );
  for (const host of hosts) {
    assert.ok(
      [
        `mailto:${PUBLIC_EMAIL}`,
        'github.com',
        'pocodingwer.github.io',
        'www.instagram.com',
        'instagram.com',
      ].includes(host),
      `모르는 연락처: ${host}`,
    );
  }
});
