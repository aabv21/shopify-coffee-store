import type { WorkflowJson } from './workflow-types.ts';

// Pinned data and instance bookkeeping from an export; dropping them keeps a re-export diff-free.
const VOLATILE_FIELDS = [
  'pinData',
  'versionId',
  'activeVersionId',
  'versionCounter',
  'triggerCount',
  'createdAt',
  'updatedAt',
  'shared',
  'staticData',
  'isArchived',
  'active',
  'parentFolderId',
] as const;

export function normalizeWorkflow(wf: WorkflowJson): WorkflowJson {
  const clone: Record<string, unknown> = structuredClone(wf);
  for (const field of VOLATILE_FIELDS) Reflect.deleteProperty(clone, field);
  const meta = clone.meta;
  if (meta !== null && typeof meta === 'object') Reflect.deleteProperty(meta, 'instanceId');
  return clone as WorkflowJson;
}
