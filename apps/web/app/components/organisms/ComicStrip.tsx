import type { ReactNode } from 'react';
import styles from '../ui.module.css';

/** 장 첫머리의 4컷 만화. 각 컷 그림은 viewBox 0 0 240 180 기준 SVG 내용. 데스크톱 4칸, 모바일 2×2. */
export function ComicStrip({
  label,
  panels,
}: {
  label: string;
  panels: { art: ReactNode; caption: ReactNode }[];
}) {
  return (
    <figure className={styles.comic} aria-label={label}>
      <ol>
        {panels.map((panel, index) => (
          <li key={index}>
            <svg viewBox="0 0 240 180" aria-hidden="true" fill="none">
              {panel.art}
            </svg>
            <p>
              <span className={styles.comicIndex}>{index + 1}</span>
              {panel.caption}
            </p>
          </li>
        ))}
      </ol>
    </figure>
  );
}
