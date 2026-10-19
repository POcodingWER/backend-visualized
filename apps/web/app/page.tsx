import Dashboard from './Dashboard';
import TrackerDemo from './Tracker';

export default function Home() {
  return (
    <main style={{ padding: '4rem 2rem', maxWidth: 720, margin: '0 auto' }}>
      <h1>backend-visualized</h1>
      <p>백엔드 작동 원리를 재현·측정·시각화하는 플레이그라운드 (mini GA backbone)</p>
      <p>Stage 1 — SDK → API → MySQL → 대시보드 end-to-end slice</p>
      <TrackerDemo />
      <Dashboard />
    </main>
  );
}
