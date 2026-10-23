'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { FiExternalLink } from 'react-icons/fi';
import { learnerLinkUrl } from '@/lib/access-links';
import AdminButton from '@/app/admin/components/ui/AdminButton';
import { getInstructorLinkAction } from '../instructor-link-actions';
import { useOrigin } from './use-origin';

/**
 * "Open the course" at the top of a group's page, for whoever teaches it: the pages its learners
 * read, through the person's own instructor link (where they leave instructor notes), in a new tab.
 * Without a link yet, the first click makes it (the tab opens at once, so the browser doesn't block
 * it, and goes to the course when the link is ready). People → Instructor links still holds it all.
 */
export default function OpenGroupCourseButton({
  groupId,
  initialToken,
  learnerLinkTemplate = null,
}: {
  groupId: string;
  /** The person's instructor link for the group, if they have one. */
  initialToken: string | null;
  /** The organisation's own learner link address (`{token}`), or null for this installation's. */
  learnerLinkTemplate?: string | null;
}) {
  const t = useTranslations('groups.detail');
  const origin = useOrigin();
  const [token, setToken] = useState(initialToken);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (token) {
    return (
      <AdminButton href={learnerLinkUrl(token, { template: learnerLinkTemplate, origin })} target="_blank" rel="noreferrer" title={t('openCourseHint')} data-testid="open-group-course">
        <FiExternalLink aria-hidden size={15} />
        {t('openCourse')}
      </AdminButton>
    );
  }
  return (
    <>
      <AdminButton
        type="button"
        disabled={pending}
        title={t('openCourseHint')}
        data-testid="open-group-course"
        onClick={() => {
          setError(null);
          const tab = window.open('about:blank', '_blank');
          startTransition(async () => {
            const result = await getInstructorLinkAction(groupId);
            if (!result.ok) {
              tab?.close();
              setError(result.message);
              return;
            }
            setToken(result.link.token);
            const url = learnerLinkUrl(result.link.token, { template: learnerLinkTemplate, origin: window.location.origin });
            if (tab) {
              tab.opener = null;
              tab.location.href = url;
            } else window.location.href = url;
          });
        }}
      >
        <FiExternalLink aria-hidden size={15} />
        {pending ? t('openingCourse') : t('openCourse')}
      </AdminButton>
      {/* Why it couldn't (another person's view while logged in as them, say): one short line. */}
      {error ? (
        <span role="alert" style={{ fontSize: '0.85rem', color: 'var(--red-pen)' }}>
          {error}
        </span>
      ) : null}
    </>
  );
}
