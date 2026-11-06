'use client';

import { useEffect } from 'react';
import { markNotesSeenAction } from '../home-actions';

/** Marks the line on Home about the person's instructor notes as seen, once it has shown. */
export default function NotesSeen() {
  useEffect(() => {
    void markNotesSeenAction();
  }, []);
  return null;
}
