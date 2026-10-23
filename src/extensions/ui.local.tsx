import LocalHowItWorksParts from '@/app/admin/how-it-works/LocalHowItWorksParts';
import type { UiExtensions } from './types';

/** The local edition adds nothing to the app's pages but its own part of How Chalkenso works. */
export const localUi: UiExtensions = {
  RootHead: null,
  AdminBanner: null,
  adminNav: [],
  platformNav: [],
  GroupPanels: null,
  LessonPanels: null,
  waitingDrafts: null,
  TaskAi: null,
  ProfilePanels: null,
  settingsTabs: [],
  AiSettingsPanels: null,
  AiTopUp: null,
  HowItWorksParts: LocalHowItWorksParts,
  SettingsGeneralPanels: null,
  courseTabs: [],
  SignupNote: null,
  GettingStartedCallButton: null,
};
