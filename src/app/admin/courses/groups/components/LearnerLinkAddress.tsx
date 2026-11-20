import { learnerLinkUrl } from '@/lib/access-links';
import styles from './MemberLinkModal.module.css';

/**
 * A learner (or preview) link as the app shows it: the organisation's own address when it has one,
 * and under it this installation's, where the same link opens too.
 */
export default function LearnerLinkAddress({
  token,
  template,
  origin,
  testId,
}: {
  token: string;
  /** The organisation's own learner link address (`{token}`), or null for this installation's. */
  template: string | null;
  origin: string;
  testId?: string;
}) {
  const shown = learnerLinkUrl(token, { template, origin });
  const here = learnerLinkUrl(token, { origin });
  return (
    <>
      <p className={styles.inlineAccessUrl} data-testid={testId}>
        {shown}
      </p>
      {shown !== here ? (
        <p className={`${styles.inlineAccessUrl} ${styles.inlineAccessUrlAlso}`} data-testid="learner-link-here">
          {here}
        </p>
      ) : null}
    </>
  );
}
