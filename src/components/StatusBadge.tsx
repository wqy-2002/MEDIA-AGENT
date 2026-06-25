import type { TaskStatus } from '@/types';
import { STATUS_LABELS, statusColor } from '@/utils/labels';

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusColor(status)}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
