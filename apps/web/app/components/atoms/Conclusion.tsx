import type { CSSProperties, ReactNode } from 'react';
import styles from '../ui.module.css';

/** 실험 끝에 붙는 한 줄 결론. good이면 "해결됐다" 색(초록 줄) */
export function Conclusion({
  isGood = false,
  style,
  children,
}: {
  isGood?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <p
      className={isGood ? `${styles.conclusion} ${styles.conclusionGood}` : styles.conclusion}
      style={style}
    >
      {children}
    </p>
  );
}
