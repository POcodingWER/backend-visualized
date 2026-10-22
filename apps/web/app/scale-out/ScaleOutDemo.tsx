'use client';

import { useState } from 'react';
import { withCode } from '../../lib/inline-code';
import { Button } from '../components/atoms/Button';
import { Conclusion } from '../components/atoms/Conclusion';
import { DevDetails } from '../components/molecules/DevDetails';
import { DevFlow } from '../components/molecules/DevFlow';
import { ResultNumbers } from '../components/molecules/ResultNumbers';
import ui from '../components/ui.module.css';
import { askWhoAnswered, type Answer } from './api';
import { SCALE_OUT_DEV_FLOW } from './dev-flow';
import styles from './scale-out.module.css';

const REQUEST_COUNT = 10;

export default function ScaleOutDemo() {
  return (
    <>
      <BottleneckSection />
      <WhoAnsweredSection />
      <SideEffectsSection />
      <section className={ui.wide}>
        <h2 className={ui.sectionTitle}>숫자로 본 결과</h2>
        <p className={ui.lead}>
          늘린 뒤 같은 조건으로 다시 재 봤어요. 처리량은 거의 그대로였고, 대신 줄 서서 기다리는
          시간이 줄고 시간 초과가 사라졌어요. 이번엔 API 하나가 아니라 서버 CPU 전체가 꽉 찼어요.
          API 둘이 각각 반 코어 남짓을 쓰고, 나머지는 문지기(Caddy)와 데이터베이스가 나눠 썼거든요.
        </p>
        <ResultNumbers
          items={[
            {
              value: '1.9초',
              tone: 'good',
              label: '손님 800명일 때 느린 쪽 5%가 기다린 시간 (p95)',
              detail: 'API 1개일 땐 7~10초였어요. 12분 전체 p95도 2.64초 → 1.4초.',
            },
            {
              value: '0%',
              tone: 'good',
              label: '시간 초과로 실패한 요청',
              detail: '1개일 땐 0.89%였어요. 이번엔 395,841건이 전부 200.',
            },
            {
              value: '초당 약 640건',
              label: '처리량 (손님 100명부터 더 안 늘어난 지점)',
              detail: '1개일 때 약 620건과 거의 같아요. 나눠 쓸 CPU가 이미 바닥이었어요.',
            },
            {
              value: '약 180%',
              tone: 'fail',
              label: '서버 CPU 전체 (컨테이너 합, 코어 2개 = 200%)',
              detail:
                'API 둘이 각각 50~65%, Caddy 35~50%, MySQL 25~40%. API 1개일 때는 API 혼자 100~120%였어요.',
            },
          ]}
          source="운영 서버 실측 — API 1개는 2026-10-21, 2개는 2026-10-22. 같은 k6 스크립트로 손님(가상 사용자)을 10명에서 800명까지 12분 동안 늘리며 GET /health, /events/stats 호출. CPU는 그동안 서버에서 약 36초마다 찍은 docker stats의 정점 구간이에요. 500 오류는 두 번 다 0번이었어요."
        />
      </section>
      <section className={ui.wide}>
        <DevDetails description="수평 확장, 로드 밸런싱(least_conn), 헬스 체크, 분산 cron 잠금(SET NX PX), 마이그레이션 한 번만">
          <DevFlow content={SCALE_OUT_DEV_FLOW} />
        </DevDetails>
      </section>
    </>
  );
}

/* ---------- 왜 늘렸나 ---------- */

function BottleneckSection() {
  return (
    <section className={ui.column}>
      <h2 className={ui.sectionTitle}>계산대는 둘인데 하나만 쓰고 있었어요</h2>
      <p className={ui.lead}>
        운영 서버에 손님을 800명까지 몰아 봤더니, 초당 620건 근처에서 처리량이 멈추고 기다리는
        시간만 길어졌어요. 서버 CPU는 코어가 2개인데, API는 Node.js 프로세스 하나라 코어 하나만 꽉
        채우고 있었어요. 메모리와 데이터베이스는 여유가 있었어요.
      </p>
      <p className={ui.lead}>
        그래서 서버를 바꾸지 않고, 같은 API를 하나 더 켜서 문지기(Caddy)가 손님을 둘로 나눠 보내게
        했어요.
      </p>
    </section>
  );
}

/* ---------- 지금 누가 받았나: 실제 운영 서버에 10번 묻기 ---------- */

function WhoAnsweredSection() {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const run = async () => {
    setIsRunning(true);
    setAnswers(await askWhoAnswered(REQUEST_COUNT));
    setIsRunning(false);
  };

  const counts = new Map<string, number>();
  for (const answer of answers) {
    const key = answer.instance ?? '실패';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const instances = [...counts.keys()].filter((key) => key !== '실패').sort();
  const failed = counts.get('실패') ?? 0;

  return (
    <section className={ui.wide}>
      <div className={ui.column}>
        <h2 className={ui.sectionTitle}>지금 누가 계산하고 있을까요?</h2>
        <p className={ui.lead}>
          버튼을 누르면 운영 서버에 &quot;괜찮아?&quot;(<code>GET /health</code>)를 {REQUEST_COUNT}
          번 동시에 물어요. 응답마다 붙어 오는 이름표(<code>x-instance-id</code>)로 어느 계산대가
          받았는지 세요.
        </p>
        <Button size="big" onClick={() => void run()} disabled={isRunning}>
          {isRunning ? '물어보는 중…' : `${REQUEST_COUNT}번 물어보기`}
        </Button>
      </div>

      <ol className={styles.answers} aria-label="요청 순서대로 받은 계산대">
        {Array.from({ length: REQUEST_COUNT }, (_, index) => {
          const answer = answers[index];
          const className = !answer
            ? styles.answerEmpty
            : answer.instance === null
              ? styles.answerFailed
              : instances.indexOf(answer.instance) === 0
                ? styles.answerFirst
                : styles.answerSecond;
          return (
            <li key={index} className={className}>
              <span>{index + 1}</span>
              <code>{answer ? (answer.instance ?? '실패') : '?'}</code>
            </li>
          );
        })}
      </ol>
      {answers.length > 0 && (
        <>
          <dl className={styles.tally}>
            {instances.map((instance) => (
              <div key={instance}>
                <dt>
                  <code>{instance}</code>
                </dt>
                <dd>{counts.get(instance)}번</dd>
              </div>
            ))}
            {failed > 0 && (
              <div>
                <dt>실패</dt>
                <dd className={ui.fail}>{failed}번</dd>
              </div>
            )}
          </dl>
          <Conclusion isGood={instances.length > 1}>
            {instances.length > 1
              ? `계산대 ${instances.length}개가 나눠 받았어요. 동시에 물으면 일이 덜 밀린 쪽으로 가요.`
              : '이번엔 한 계산대가 다 받았어요. 요청이 금방 끝나면 한쪽이 연달아 받을 수 있어요. 다시 눌러 보세요.'}
          </Conclusion>
        </>
      )}
    </section>
  );
}

/* ---------- 둘로 늘리면 꼬이는 것 ---------- */

const SIDE_EFFECTS = [
  {
    title: '"하나만"을 서버마다 셌어요',
    before:
      '처음엔 무거운 실험은 "서버 전체에서 한 번에 하나"만 돌게 API 메모리에 표시했어요. 실제로는 메모리가 계산대마다 따로라, 두 계산대에서 실험 두 개가 같은 데모 데이터로 동시에 돌 수 있었어요.',
    after:
      '그래서 그 표시를 Redis로 옮겼어요. 어느 계산대에서 오든 같은 열쇠 하나를 다퉈요. 초당 요청 수 같은 넉넉한 한도는 계산대마다 따로 세는 채로 뒀어요(한도가 사실상 2배).',
  },
  {
    title: '정해진 시간 작업이 두 번 돌아요',
    before:
      '처음엔 5분마다 도는 집계 작업(3장)을 그대로 뒀어요. 실제로는 계산대마다 시계가 있어서 같은 집계를 두 번 했어요. 결과는 같지만 DB 일만 두 배였어요.',
    after:
      '그래서 5분 칸마다 Redis 열쇠(`SET NX PX`)를 먼저 잡은 쪽만 집계해요. 결제 정리 작업(5장)은 "아직 처리 중인 것만 실패로" 조건을 건 `UPDATE`라 두 번 돌아도 한 번만 바뀌어서 그대로 뒀어요.',
  },
  {
    title: 'DB 구조 바꾸기는 한 번만',
    before:
      '처음엔 켜질 때마다 DB 구조 변경(마이그레이션)을 하던 그대로였어요. 실제로는 두 계산대가 동시에 켜지면서 같은 변경을 서로 하려고 줄을 섰어요.',
    after:
      '그래서 1번 계산대만 변경하고 2번은 건너뛰어요(`RUN_MIGRATIONS=false`). 컬럼 추가만 먼저 하는 규칙(expand → contract) 덕분에 2번이 먼저 떠도 괜찮아요.',
  },
  {
    title: '"방금 들어옴" 알림이 가끔 빠져요',
    before:
      '처음엔 세 군데만 고치면 되는 줄 알았어요. 실제로는 3장의 실시간 알림도 계산대 안에서만 돌았어요. 화면은 1번 계산대에 연결돼 있는데 이벤트 묶음이 2번으로 가면, 2번만 알고 화면에는 알림이 안 왔어요.',
    after:
      '그래서 알림을 Redis 채널(`bv:events:ingested`)로 보내고, 계산대 둘 다 그 채널을 듣다가 자기에게 붙은 화면으로 흘려줘요. 듣는 연결은 다른 명령을 못 써서 Redis 연결을 하나 더 열었어요.',
  },
];

function SideEffectsSection() {
  return (
    <section className={ui.wide}>
      <div className={ui.column}>
        <h2 className={ui.sectionTitle}>둘로 늘리면 꼬이는 것</h2>
        <p className={ui.lead}>
          같은 프로그램을 두 개 켜면, &quot;나 혼자 돈다&quot;고 믿고 짠 코드가 문제가 돼요. 처음엔
          세 군데인 줄 알았는데, 다시 보니 네 군데였어요.
        </p>
      </div>
      <div className={`${ui.fixes} ${ui.fixesTwo}`}>
        {SIDE_EFFECTS.map((item) => (
          <article key={item.title} className={ui.fix}>
            <h3>{item.title}</h3>
            <p>{withCode(item.before)}</p>
            <p className={ui.tradeoff}>{withCode(item.after)}</p>
          </article>
        ))}
      </div>
      <div className={ui.column}>
        <p className={`${ui.hint} ${styles.note}`}>
          이 서버는 코어가 2개라 API를 더 켜도 나눌 CPU가 없어요. 다음은 Caddy와 데이터베이스를 다른
          서버로 빼거나, 서버 자체를 여러 대로 늘리는 쪽이에요 (로드 밸런서 + EC2 여러 대).
        </p>
      </div>
    </section>
  );
}
