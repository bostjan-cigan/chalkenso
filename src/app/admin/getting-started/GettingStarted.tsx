import { ui } from '@/extensions/ui';
import { getCurrentUserSession, isOrgAdmin } from '@/lib/admin-auth';
import HowItWorksContent from '../how-it-works/HowItWorksContent';
import { howItWorksAction } from '../how-it-works/data';
import { loadGettingStarted } from './data';
import GettingStartedHelper from './GettingStartedHelper';

/**
 * Getting started in the corner of an app page (see `data.ts`), streamed on its own so it never holds
 * the page up. `home`: the note pointing at it may show (until it's opened once).
 */
export default async function GettingStarted({ home }: { home: boolean }) {
  const [state, session] = await Promise.all([loadGettingStarted(), getCurrentUserSession()]);
  const viewer = session?.user;
  if (!state || state.hidden || !viewer?.organization) return null;
  const organization = viewer.organization;
  // How it works' sheet only while it's a step left to do.
  const how = state.steps.some((step) => step.id === 'how' && !step.done)
    ? {
        action: await howItWorksAction({ ...viewer, organization }),
        content: <HowItWorksContent organizationId={organization.id} admin={isOrgAdmin(viewer)} />,
      }
    : null;
  const CallButton = ui.GettingStartedCallButton;
  return (
    <GettingStartedHelper
      steps={state.steps}
      call={state.call}
      callButton={state.call && CallButton ? <CallButton viewer={viewer} /> : null}
      how={how}
      hint={home && !state.opened}
    />
  );
}
