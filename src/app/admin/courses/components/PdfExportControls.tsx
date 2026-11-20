'use client';

import { useTranslations } from 'next-intl';
import { useOptimistic } from 'react';
import AdminSearchableSelectField from '../../components/ui/AdminSearchableSelectField';
import ActionNotice from '../../components/ui/ActionNotice';
import Switch from '../../components/ui/Switch';
import { useActionNotice } from '../../components/ui/useActionNotice';
import { setGroupPdfExportAction } from '../groups/actions';
import { setVersionPdfExportAction } from '../versions/actions';

/** Whether learners may save a curriculum version's lessons as a PDF (off until switched on). */
export function VersionPdfExportSwitch({ courseId, versionId, on }: { courseId: string; versionId: string; on: boolean }) {
  const t = useTranslations('courses.lessons');
  const { notice, isPending, run } = useActionNotice();
  const [shown, setShown] = useOptimistic(on);
  return (
    <>
      <ActionNotice notice={notice} />
      <Switch
        on={shown}
        label={t('pdfExport')}
        disabled={isPending}
        testId="version-pdf-export"
        onChange={() =>
          run(() => {
            setShown(!shown);
            return setVersionPdfExportAction(courseId, versionId, !shown);
          })
        }
      />
    </>
  );
}

type GroupAnswer = 'inherit' | 'on' | 'off';

/** A group's own answer to PDF export: the same as its curriculum version, or on or off for this group. */
export function GroupPdfExportSelect({
  groupId,
  value,
  inherited,
}: {
  groupId: string;
  value: GroupAnswer;
  /** What the group's curriculum version says, shown with "Same as lessons". */
  inherited: boolean;
}) {
  const t = useTranslations('groups.detail.settings');
  const { notice, isPending, run } = useActionNotice();
  const [shown, setShown] = useOptimistic(value);
  return (
    <>
      <ActionNotice notice={notice} />
      <AdminSearchableSelectField
        id="group-pdf-export"
        label={t('pdfExport')}
        hideLabel
        compact
        style={{ minWidth: 190 }}
        searchable={false}
        value={shown}
        disabled={isPending}
        options={[
          { value: 'inherit', label: inherited ? t('pdfInheritOn') : t('pdfInheritOff') },
          { value: 'on', label: t('pdfOn') },
          { value: 'off', label: t('pdfOff') },
        ]}
        onValueChange={(next) =>
          run(() => {
            setShown(next as GroupAnswer);
            return setGroupPdfExportAction(groupId, next as GroupAnswer);
          })
        }
      />
    </>
  );
}
