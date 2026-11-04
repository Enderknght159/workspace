import { Badge } from './ui.js';
import {
  eventStateLabel,
  eventTone,
  jobStateLabel,
  jobTone,
} from '../lib/labels.js';

export function EventStatus({ state }: { state: string }) {
  return (
    <Badge tone={eventTone(state)} dot>
      {eventStateLabel(state)}
    </Badge>
  );
}

export function JobStatus({ state }: { state: string }) {
  return (
    <Badge tone={jobTone(state)} dot>
      {jobStateLabel(state)}
    </Badge>
  );
}
