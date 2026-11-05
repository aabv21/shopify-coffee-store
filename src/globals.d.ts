import type { DateTime as LuxonDateTime } from 'luxon';

// The Code-node sandbox injects Luxon's DateTime as a global; `tests/setup.ts` provides it in tests.
declare global {
  var DateTime: typeof LuxonDateTime;
  type DateTime = LuxonDateTime;
}
