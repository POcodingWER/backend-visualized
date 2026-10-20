import type { ReactNode } from 'react';
import flow from '../flow.module.css';
import styles from '../ui.module.css';

/** 요청 흐름 한 단계: 누가(브라우저 → API) 무엇을 하는지. 갈림길은 branches에 */
export interface FlowStep {
  who: string;
  what: ReactNode;
  branches?: ReactNode[];
}

/** 데모를 한 번 돌린 뒤 DB(또는 Redis)에 남은 모습. columns는 schema.prisma의 실제 컬럼 이름 */
export interface SampleTable {
  /** 짧게: 좁은 화면에서 가로 스크롤 표 안에 있어도 잘리지 않도록. 긴 설명은 note에 */
  caption: string;
  note?: ReactNode;
  columns: string[];
  rows: ReactNode[][];
}

export interface DevFlowContent {
  terms: { analogy: ReactNode; term: ReactNode }[];
  steps: FlowStep[];
  samplesTitle?: string;
  samples: SampleTable[];
  /** 프론트 관점, 한계·운영에선, 개발자 도구로 보면 같은 짧은 묶음 */
  notes: { title: string; items: ReactNode[] }[];
  /** 흐름 순서대로 */
  links: { label: string; href: string; note?: ReactNode }[];
}

/** "개발자용 자세히" 맨 위: 비유 ↔ 용어 → 요청 흐름 → DB에 남는 모습 → 짧은 메모들 → 코드 링크 */
export function DevFlow({ content }: { content: DevFlowContent }) {
  const { terms, steps, samplesTitle = 'DB에는 이렇게 남아요', samples, notes, links } = content;
  return (
    <section className={styles.devFlow} aria-labelledby="dev-flow-title">
      <h2 id="dev-flow-title" className={styles.devFlowTitle}>
        흐름 따라가기
      </h2>

      <section>
        <h3>비유 ↔ 용어</h3>
        <dl className={styles.devTerms}>
          {terms.map(({ analogy, term }, index) => (
            <div key={index}>
              <dt>{analogy}</dt>
              <dd>{term}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3>요청 흐름</h3>
        <ol className={styles.devSteps}>
          {steps.map(({ who, what, branches }, index) => (
            <li key={index}>
              <span className={styles.devWho}>{who}</span> {what}
              {branches && (
                <ul>
                  {branches.map((branch, branchIndex) => (
                    <li key={branchIndex}>{branch}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3>{samplesTitle}</h3>
        {samples.map((sample, index) => (
          <div key={index} className={styles.devSample}>
            {/* 좁은 화면에선 표만 가로로 스크롤. 키보드로도 스크롤할 수 있게 tabIndex */}
            <div
              className={flow.tableScroll}
              role="region"
              aria-label={sample.caption}
              tabIndex={0}
            >
              <table className={flow.dbTable}>
                <caption>{sample.caption}</caption>
                <thead>
                  <tr>
                    {sample.columns.map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sample.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sample.note && <p className={styles.source}>{sample.note}</p>}
          </div>
        ))}
      </section>

      {notes.map((note) => (
        <section key={note.title}>
          <h3>{note.title}</h3>
          <ul className={styles.devNotes}>
            {note.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <h3>코드·문서</h3>
        <ol className={styles.devLinks}>
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
              {link.note && <span> · {link.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
