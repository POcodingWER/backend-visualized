import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chapterOf, contactTarget } from './analytics';

test('연락처 링크만 골라낸다', () => {
  assert.equal(contactTarget('/resume.pdf'), 'resume_pdf');
  assert.equal(contactTarget('https://pocodingwer.github.io/about/'), 'resume_web');
  assert.equal(contactTarget('https://pocodingwer.github.io'), 'blog');
  assert.equal(contactTarget('https://chuckplay.dev/about/'), 'resume_web');
  assert.equal(contactTarget('https://chuckplay.dev/aws/2025/12/02/cloudfront_cache/'), 'blog');
  assert.equal(contactTarget('https://pocodingwer.github.io/posts/redis'), 'blog');
  assert.equal(contactTarget('https://github.com/POcodingWER'), 'github');
  assert.equal(contactTarget('https://github.com/POcodingWER/backend-visualized'), 'github');
  assert.equal(contactTarget('mailto:someone@example.com'), 'email');
  assert.equal(contactTarget('https://www.instagram.com/someone'), 'instagram');
});

test('장 이동·다른 사이트 링크는 세지 않는다', () => {
  assert.equal(contactTarget('/ticketing'), null);
  assert.equal(contactTarget('#step-1'), null);
  assert.equal(contactTarget('https://github.com/vercel/next.js'), null);
  assert.equal(contactTarget('https://playmcp.kakao.com'), null);
});

test('경로로 장 번호를 찾는다', () => {
  assert.equal(chapterOf('/ticketing'), 1);
  assert.equal(chapterOf('/scale-out'), 7);
  assert.equal(chapterOf('/about'), null);
  assert.equal(chapterOf('/'), null);
});
