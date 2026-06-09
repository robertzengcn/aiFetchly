/**
 * Command registry - registers all CLI command groups.
 */

import { Command } from 'commander';
import { registerTaskCommands } from './task';
import { registerSearchCommands } from './search';
import { registerContactCommands } from './contact';
import { registerEmailExtractionCommands } from './email-extraction';
import { registerEmailMarketingCommands } from './email-marketing';
import { registerScheduleCommands } from './schedule';
import { registerProxyCommands } from './proxy';
import { registerSocialAccountCommands } from './social-account';
import { registerYellowPagesCommands } from './yellow-pages';
import { registerMapsCommands } from './maps';
import { registerKnowledgeCommands } from './knowledge';
import { registerDashboardCommands } from './dashboard';
import { registerSystemCommands } from './system';

export function registerAllCommands(program: Command): void {
  registerTaskCommands(program);
  registerSearchCommands(program);
  registerContactCommands(program);
  registerEmailExtractionCommands(program);
  registerEmailMarketingCommands(program);
  registerScheduleCommands(program);
  registerProxyCommands(program);
  registerSocialAccountCommands(program);
  registerYellowPagesCommands(program);
  registerMapsCommands(program);
  registerKnowledgeCommands(program);
  registerDashboardCommands(program);
  registerSystemCommands(program);
}
