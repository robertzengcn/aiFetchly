/**
 * Email marketing commands - manage campaigns, templates, tasks, and send logs.
 * Queries emailmarketing_task, email_template, and emailmarketing_send_log tables.
 */

import { Command } from 'commander';
import { CliDatabase } from '../adapter/cli-database';
import { EmailMarketingTaskEntity } from '@/entity/EmailMarketingTask.entity';
import { EmailTemplateEntity } from '@/entity/EmailTemplate.entity';
import { EmailMarketingSendLogEntity } from '@/entity/EmailMarketingSendLog.entity';
import { formatPaginated, formatError } from '../output/formatter';
import type { TableConfig } from '../common/types';

const CAMPAIGN_LIST_CONFIG: TableConfig = {
  columns: [
    { key: 'id', header: 'ID', width: 6 },
    { key: 'task_name', header: 'Name', width: 30 },
    { key: 'status', header: 'Status', width: 10 },
    { key: 'totalSent', header: 'Total Sent', width: 12 },
    { key: 'createdAt', header: 'Created', width: 20 },
  ],
};

const TEMPLATE_LIST_CONFIG: TableConfig = {
  columns: [
    { key: 'id', header: 'ID', width: 6 },
    { key: 'title', header: 'Name', width: 30 },
    { key: 'content', header: 'Subject', width: 30 },
    { key: 'createdAt', header: 'Created', width: 20 },
  ],
};

const TASK_LIST_CONFIG: TableConfig = {
  columns: [
    { key: 'id', header: 'ID', width: 6 },
    { key: 'task_name', header: 'Name', width: 30 },
    { key: 'task_desc', header: 'Description', width: 30 },
    { key: 'status', header: 'Status', width: 10 },
    { key: 'createdAt', header: 'Created', width: 20 },
  ],
};

const SEND_LOG_CONFIG: TableConfig = {
  columns: [
    { key: 'id', header: 'ID', width: 6 },
    { key: 'receiver', header: 'Receiver', width: 30 },
    { key: 'title', header: 'Subject', width: 30 },
    { key: 'status', header: 'Status', width: 10 },
    { key: 'createdAt', header: 'Created', width: 20 },
  ],
};

export function registerEmailMarketingCommands(parent: Command): void {
  const emailMarketing = parent
    .command('email-marketing')
    .description('Manage email marketing campaigns and templates');

  emailMarketing
    .command('list-campaigns')
    .description('List email marketing campaigns')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-s, --size <number>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const taskRepo = CliDatabase.getRepository(EmailMarketingTaskEntity);
        const sendLogRepo = CliDatabase.getRepository(EmailMarketingSendLogEntity);

        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [tasks, total] = await taskRepo.findAndCount({
          order: { id: 'DESC' } as Record<string, string>,
          skip,
          take: size,
        });

        const items = await Promise.all(
          tasks.map(async (task: Record<string, unknown>) => {
            const totalSent = await sendLogRepo.count({
              where: { task_id: task.id } as Record<string, unknown>,
            });
            return {
              ...task,
              totalSent,
            };
          }),
        );

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          'email-marketing:list-campaigns',
          CAMPAIGN_LIST_CONFIG,
        );
      } catch (error) {
        formatError(error, opts.json, 'email-marketing:list-campaigns');
      }
    });

  emailMarketing
    .command('get-templates')
    .description('List email templates')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-s, --size <number>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(EmailTemplateEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [items, total] = await repo.findAndCount({
          order: { id: 'DESC' } as Record<string, string>,
          skip,
          take: size,
        });

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          'email-marketing:get-templates',
          TEMPLATE_LIST_CONFIG,
        );
      } catch (error) {
        formatError(error, opts.json, 'email-marketing:get-templates');
      }
    });

  emailMarketing
    .command('list-tasks')
    .description('List email marketing tasks')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-s, --size <number>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(EmailMarketingTaskEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [items, total] = await repo.findAndCount({
          order: { id: 'DESC' } as Record<string, string>,
          skip,
          take: size,
        });

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          'email-marketing:list-tasks',
          TASK_LIST_CONFIG,
        );
      } catch (error) {
        formatError(error, opts.json, 'email-marketing:list-tasks');
      }
    });

  emailMarketing
    .command('send-log <taskId>')
    .description('Get send log for an email marketing task')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-s, --size <number>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (taskId, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(EmailMarketingSendLogEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [items, total] = await repo.findAndCount({
          where: { task_id: parseInt(taskId) } as Record<string, unknown>,
          order: { id: 'DESC' } as Record<string, string>,
          skip,
          take: size,
        });

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          'email-marketing:send-log',
          SEND_LOG_CONFIG,
        );
      } catch (error) {
        formatError(error, opts.json, 'email-marketing:send-log');
      }
    });
}
