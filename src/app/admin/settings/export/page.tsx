import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { serverExtensions } from '@/extensions/server';
import { requireMember } from '@/lib/admin-auth';
import { accessScope, commentScopeWhere, taskScopeWhere } from '@/lib/crm-access';
import { canExport, loadExportScope, type ExportViewer } from '@/lib/export/scope';
import { prisma } from '@/lib/prisma';
import { cn } from '@/utils/cn';
import AdminNotice from '../../components/ui/AdminNotice';
import InfoTip from '../ui/InfoTip';
import { SettingsGroup, SettingsRow } from '../ui/SettingsList';
import SettingsFrame from '../SettingsFrame';
import adminStyles from '../../admin.module.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('account.export'))('metaTitle') };
}
export const dynamic = 'force-dynamic';

/** The file itself: a plain link, so the browser downloads it (and comes back here if it is refused). */
const DOWNLOAD = '/admin/api/export';

/**
 * Settings → Export: "One button to export everything". Owners and admins export the whole
 * organisation; members what they can open (src/lib/export/scope.ts). The list says what the .zip
 * holds, counted with the same checks the export uses.
 */
export default async function ExportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireMember();
  if (!canExport(user)) {
    redirect('/admin');
  }
  const viewer = user as ExportViewer;
  const [t, format, params, scope] = await Promise.all([
    getTranslations('account.export'),
    getFormatter(),
    searchParams,
    loadExportScope(viewer),
  ]);
  const organizationId = scope.organization.id;
  const versionIds = scope.versions.map((version) => version.id);
  const [lessons, publications, feedback, tasks, team, parts] = await Promise.all([
    prisma.lesson.count({ where: { curriculumVersionId: { in: versionIds }, course: { organizationId } } }),
    prisma.lessonPublication.count({ where: { lesson: { curriculumVersionId: { in: versionIds }, course: { organizationId } } } }),
    prisma.curriculumComment.count({
      where: { AND: [commentScopeWhere(accessScope(scope.viewer, 'comments')), { curriculumVersion: { course: { organizationId } } }] },
    }),
    prisma.task.count({ where: { AND: [taskScopeWhere(accessScope(scope.viewer, 'tasks')), { organizationId }] } }),
    scope.admin ? prisma.organizationMember.count({ where: { organizationId } }) : Promise.resolve(null),
    serverExtensions.exportParts(scope),
  ]);
  const partContents = (await Promise.all(parts.map((part) => part.contents()))).flat();

  const rows = [
    { key: 'lessons', label: t('page.contents.lessons'), count: lessons },
    { key: 'versions', label: t('page.contents.versions'), count: scope.versions.filter((version) => !version.group).length },
    { key: 'groupCopies', label: t('page.contents.groupCopies'), count: scope.versions.filter((version) => version.group).length },
    { key: 'publications', label: t('page.contents.publications'), count: publications },
    { key: 'groups', label: t('page.contents.groups'), count: scope.groups.length },
    { key: 'feedback', label: t('page.contents.feedback'), count: feedback },
    { key: 'tasks', label: t('page.contents.tasks'), count: tasks },
    ...partContents.map((row, index) => ({ key: `part-${index}`, ...row })),
    ...(team === null ? [] : [{ key: 'team', label: t('page.contents.team'), count: team }]),
  ];
  const nothing = rows.every((row) => row.count === 0);

  return (
    <SettingsFrame active="export" title={t('title')} description={t('description')}>
      {params.error === 'limit' ? <AdminNotice>{t('page.limit')}</AdminNotice> : null}
      {user.impersonator ? <AdminNotice>{t('page.impersonating')}</AdminNotice> : null}

      <SettingsGroup
        title={t('page.title')}
        info={
          <InfoTip label={t('page.title')}>
            <p>{t('page.intro')}</p>
            <p>{t('page.obsidian.text', { folder: scope.vaultFolder })}</p>
            <p>{t('page.never.text')}</p>
          </InfoTip>
        }
        footer={scope.admin ? undefined : <span data-testid="export-own">{t('page.own', { organization: scope.organization.name })}</span>}
        testId="export-everything"
      >
        <div data-testid="export-contents">
          {rows.map((row) => (
            <SettingsRow key={row.key} label={row.label}>
              {format.number(row.count)}
            </SettingsRow>
          ))}
        </div>
        {nothing ? (
          <SettingsRow label={t('page.nothing')} />
        ) : user.impersonator ? null : (
          <SettingsRow label={<span style={{ fontWeight: 400, fontSize: '0.84rem', opacity: 0.7 }}>{t('page.hint')}</span>}>
            <a href={DOWNLOAD} className={cn(adminStyles.button, adminStyles.buttonPrimary)} data-button="" data-testid="export-download">
              {t('page.download')}
            </a>
          </SettingsRow>
        )}
      </SettingsGroup>
    </SettingsFrame>
  );
}
