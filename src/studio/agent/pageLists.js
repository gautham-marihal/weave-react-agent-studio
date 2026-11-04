// The first business hours offered on the Channels part, and the parts of the Test and Release pages. Used by
// AgentLayout.jsx and detailed/parts/channelsPart.jsx.

const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
// Hours change nothing on their own: a phone transfer or a rule follows them.
export const SCHEDULES_START = {
  label: 'Start with Monday to Friday, 9 to 5',
  make: (c) => ({
    ...c,
    schedules: {
      business_hours: {
        description: 'Office hours',
        timezone: localZone(),
        weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }],
      },
    },
  }),
};
export const TEST_PARTS = [
  { id: 'try', label: 'Try it' },
  { id: 'callers', label: 'Simulated callers' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'checks', label: 'Readiness checks' },
];
export const RELEASE_PARTS = [
  { id: 'versions', label: 'Versions' },
  { id: 'deploy', label: 'Deploy' },
];
