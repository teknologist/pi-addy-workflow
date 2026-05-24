import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerAddyWorkflowMonitor } from './workflow-monitor/composition.ts';

export default function addyWorkflowMonitor(pi: ExtensionAPI) {
  registerAddyWorkflowMonitor(pi);
}
