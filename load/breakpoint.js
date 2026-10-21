// 운영 서버 한 대가 어디서 무너지는지 보는 단계별 부하 테스트 (breakpoint test).
//   k6 run -e API_URL=https://<API_HOST> --summary-export=/tmp/k6-summary.json --out csv=/tmp/k6.csv load/breakpoint.js
// <API_HOST>는 실제 API 주소로 바꿔서 실행한다 (저장소에는 실제 IP를 적지 않는다).
//
// 무엇을 부르나: 읽기만 한다 → 테스트가 끝나도 DB에 남는 데이터가 없다.
//   GET /health        DB에 SELECT 1 (IP별 한도 없음)
//   GET /events/stats  이벤트 표 전체 COUNT + GROUP BY (IP별 한도 없음, 가장 무거운 읽기)
// IP별 한도(429)가 걸린 엔드포인트는 일부러 뺐다. 한 대(내 맥)에서 보내면 한도에 먼저 막혀 서버 한계를 못 보기 때문.
//
// 단계: 10 → 50 → 100 → 200 → 400 → 800명(VU)까지 올린다. 한 VU는 쉬지 않고(0.05초 간격) 요청한다.
// 실패율이 50%를 30초 넘게 넘으면 "무너졌다"고 보고 스스로 멈춘다 (더 때려도 알 것이 없음).
import http from 'k6/http';
import { check, sleep } from 'k6';

const API = __ENV.API_URL;
if (!API || API.includes('<'))
  throw new Error('-e API_URL=https://<API_HOST> 를 실제 주소로 넣어 주세요');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 50 },
        { duration: '1m30s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '1m30s', target: 100 },
        { duration: '30s', target: 200 },
        { duration: '1m30s', target: 200 },
        { duration: '30s', target: 400 },
        { duration: '1m30s', target: 400 },
        { duration: '30s', target: 800 },
        { duration: '1m30s', target: 800 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  // 10초 넘게 답이 없으면 실패로 센다
  httpReqTimeout: '10s',
  thresholds: {
    // 무너짐 판정: 실패율 50%가 30초 넘게 이어지면 중단
    http_req_failed: [{ threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '30s' }],
    // 기록용 (넘어도 멈추지 않음)
    'http_req_duration{name:health}': ['p(95)<1000'],
    'http_req_duration{name:stats}': ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const health = http.get(`${API}/health`, { tags: { name: 'health' }, timeout: '10s' });
  check(health, { 'health 200': (response) => response.status === 200 });
  // 요청 셋 중 하나는 무거운 통계 읽기
  if (Math.random() < 0.3) {
    const stats = http.get(`${API}/events/stats`, { tags: { name: 'stats' }, timeout: '10s' });
    check(stats, { 'stats 200': (response) => response.status === 200 });
  }
  sleep(0.05);
}
