import type { CurriculumVersionStatus } from '@prisma/client';
import type { Locale } from '@/i18n/config';
import type { CrmViewer } from '@/lib/crm-access';
import type { CsvCell } from '@/lib/csv';

/**
 * "Export everything" (Settings → Export): one .zip with what a person can open in their
 * organisation. Shared by both editions (src/lib/export); an edition adds its own parts through
 * `serverExtensions.exportParts`.
 */

export type ExportCourse = { id: string; title: string; slug: string };

/** A course version or a group's own copy the person can read, and where its notes go in the export. */
export type ExportVersion = {
  id: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  label: string;
  version: number;
  status: CurriculumVersionStatus;
  createdAt: Date;
  publishedAt: Date | null;
  publisherName: string | null;
  /** A group's own copy: its group. */
  group: { id: string; name: string } | null;
  /** A group's copy: the core version it was copied from. */
  baseVersion: { id: string; label: string } | null;
  /** A group's copy whose group finished. */
  archivedAt: Date | null;
  /** Its folder in the export (`<Organisation>/Curriculums/…` or `…/Groups/…`), unique. */
  folder: string;
};

export type ExportGroup = {
  id: string;
  courseId: string;
  name: string;
  slug: string;
  description: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  feedbackDriven: boolean;
  /** The version its learners read (its own copy for a feedback-driven group). */
  versionId: string | null;
};

/** What one export holds: the organisation and, in it, what the person can open. */
export type ExportScope = {
  organization: { id: string; name: string; slug: string };
  /** Who asked for it. */
  person: { id: string; name: string };
  viewer: CrmViewer;
  /** Owners and admins: the whole organisation, its team too ("It has everything"). */
  admin: boolean;
  /** Owners, admins and full members: every course and group. */
  everything: boolean;
  /** Whole courses the person can open (READ on the course), by title. */
  courses: ExportCourse[];
  /** Every course version and group copy the person can read, course by course. */
  versions: ExportVersion[];
  /** The groups the person can open. */
  groups: ExportGroup[];
  /** Every course any of the above belongs to, by id (courses reached only through a group too). */
  courseTitles: Map<string, string>;
  /** The organisation's folder in the export: the one the Obsidian plugin gives it in a vault. */
  vaultFolder: string;
};

/** Writes files into the export; paths are inside its top folder. Each returns the path it got. */
export type ExportFiles = {
  text(path: string, content: string): Promise<string>;
  /** A CSV file (a byte order mark, then the header and the rows), written as the rows come. Returns the row count. */
  csv(path: string, header: string[], rows: AsyncIterable<CsvCell[]> | Iterable<CsvCell[]>): Promise<number>;
  /** Bytes, all at once or as they arrive; `compress: false` for images and other compressed files. */
  binary(path: string, source: Uint8Array | AsyncIterable<Uint8Array>, options?: { compress?: boolean }): Promise<string>;
};

export type ExportContext = {
  scope: ExportScope;
  files: ExportFiles;
  /** README.txt: what a file or folder holds (in the order they are described). */
  describe(path: string, text: string): void;
  /** README.txt: something that was left out, and why. */
  leftOut(text: string): void;
  /** Whether there's time for more optional work (images, older texts) before the time limit. */
  hasTime(): boolean;
  locale: Locale;
  /** When the export started: every file is stamped with it. */
  now: Date;
  /** A day (2026-10-18) and a moment (2026-10-18 14:03), in UTC, as every file writes them. */
  day(date: Date | string | null | undefined): string | null;
  time(date: Date | string | null | undefined): string | null;
};

/** One part of the export that an edition adds. */
export type ExportPart = {
  /** What it holds, for the list on Settings → Export (in the reader's language). */
  contents(): Promise<Array<{ label: string; count: number }>>;
  /** Writes its files and describes them. */
  write(context: ExportContext): Promise<void>;
};
