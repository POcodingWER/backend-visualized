import type { ReactNode } from 'react';
import styles from '../ui.module.css';

export type ResultNumber = {
  value: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  tone?: 'fail' | 'good';
};

/** 실측 숫자 묶음. 출처를 반드시 함께 보여준다. */
export function ResultNumbers({ items, source }: { items: ResultNumber[]; source: ReactNode }) {
  return (
    <figure className={styles.numbers}>
      <dl>
        {items.map((item, index) => (
          <div key={index}>
            <dd className={item.tone ? styles[item.tone] : undefined}>{item.value}</dd>
            <dt>{item.label}</dt>
            {item.detail && <dd className={styles.numberDetail}>{item.detail}</dd>}
          </div>
        ))}
      </dl>
      <figcaption>{source}</figcaption>
    </figure>
  );
}
