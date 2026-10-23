'use client';

import { useState } from 'react';
import { TbCheck, TbCopy } from 'react-icons/tb';
import styles from './obsidian-connect.module.css';

/** A short value in a sentence (an address) with its own Copy, saying so for a moment. */
export default function CopyText({ text, copy, copied }: { text: string; copy: string; copied: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className={styles.copy}>
      <code>{text}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}
        {done ? copied : copy}
      </button>
    </span>
  );
}
