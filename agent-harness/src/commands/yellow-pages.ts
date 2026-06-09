/**
 * Yellow Pages commands - manage Yellow Pages scraping tasks and results.
 * Uses YellowPagesTaskEntity, YellowPagesResultEntity, YellowPagesPlatformEntity.
 */

import { Command } from 'commander';
import { CliDatabase } from '../adapter/cli-database';
import { YellowPagesTaskEntity } from '@/entity/YellowPagesTask.entity';
import { YellowPagesResultEntity } from '@/entity/YellowPagesResult.entity';
import { YellowPagesPlatformEntity } from '@/entity/YellowPagesPlatform.entity';
import { formatPaginated, formatItem, formatOutput, formatError } from '../output/formatter';
import type { TableConfig } from '../common/types';

const YP_TASK_LIST_CONFIG: TableConfig = {
  columns: [
    { key: 'id', header: 'ID', width: 6 },
    { key: 'platform', header: 'Platform', width: 12 },
    { key: 'location', header: 'Location', width: 20 },
    { key: 'keywords', header: 'Keywords', width: 25 },
    { key: 'status', header: 'Status', width: 10 },
    { key: 'createdAt', header: 'Created', width: 20 },
  ],
};

const YP_RESULT_LIST_CONFIG: TableConfig = {
  columns: [
    { key: 'id', header: 'ID', width: 6 },
    { key: 'business_name', header: 'Name', width: 25 },
    { key: 'phone', header: 'Phone', width: 16 },
    { key: 'address_street', header: 'Address', width: 25 },
    { key: 'website', header: 'Website', width: 25 },
    { key: 'email', header: 'Email', width: 25 },
  ],
};

const YP_STATISTICS_FIELDS = [
  { key: 'totalTasks', label: 'Total Tasks' },
  { key: 'completedTasks', label: 'Completed' },
  { key: 'pendingTasks', label: 'Pending' },
  { key: 'failedTasks', label: 'Failed' },
  { key: 'inProgressTasks', label: 'In Progress' },
  { key: 'totalResults', label: 'Total Results' },
  { key: 'platformsAvailable', label: 'Platforms Available' },
];

export function registerYellowPagesCommands(parent: Command): void {
  const yp = parent.command('yellow-pages').description('Manage Yellow Pages scraping tasks');

  // ── yellow-pages list ──────────────────────────────────────────────────
  yp
    .command('list')
    .description('List Yellow Pages tasks')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-s, --size <number>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(YellowPagesTaskEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [items, total] = await repo
          .createQueryBuilder('yp_task')
          .orderBy('yp_task.id', 'DESC')
          .skip(skip)
          .take(size)
          .getManyAndCount();

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          'yellow-pages:list',
          YP_TASK_LIST_CONFIG,
        );
      } catch (error) {
        formatError(error, opts.json, 'yellow-pages:list');
      }
    });

  // ── yellow-pages results <taskId> ──────────────────────────────────────
  yp
    .command('results <taskId>')
    .description('Get results for a Yellow Pages task')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-s, --size <number>', 'Page size', '20')
    .option('--json', 'Output as JSON')
    .action(async (taskId, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(YellowPagesResultEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [items, total] = await repo
          .createQueryBuilder('yp_result')
          .where('yp_result.task_id = :taskId', { taskId: parseInt(taskId) })
          .orderBy('yp_result.id', 'DESC')
          .skip(skip)
          .take(size)
          .getManyAndCount();

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          'yellow-pages:results',
          YP_RESULT_LIST_CONFIG,
        );
      } catch (error) {
        formatError(error, opts.json, 'yellow-pages:results');
      }
    });

  // ── yellow-pages platforms ─────────────────────────────────────────────
  yp
    .command('platforms')
    .description('List supported Yellow Pages platforms')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(YellowPagesPlatformEntity);

        const items = await repo.find({
          order: { id: 'ASC' } as Record<string, string>,
        });

        formatOutput(items, opts.json, 'yellow-pages:platforms', {
          columns: [
            { key: 'id', header: 'ID', width: 6 },
            { key: 'name', header: 'Name', width: 20 },
            { key: 'display_name', header: 'Display Name', width: 20 },
            { key: 'country', header: 'Country', width: 10 },
            { key: 'language', header: 'Language', width: 10 },
            { key: 'is_active', header: 'Active', width: 8 },
          ],
        });
      } catch (error) {
        formatError(error, opts.json, 'yellow-pages:platforms');
      }
    });

  // ── yellow-pages statistics ────────────────────────────────────────────
  yp
    .command('statistics')
    .description('Get Yellow Pages aggregate statistics')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const taskRepo = CliDatabase.getRepository(YellowPagesTaskEntity);
        const resultRepo = CliDatabase.getRepository(YellowPagesResultEntity);
        const platformRepo = CliDatabase.getRepository(YellowPagesPlatformEntity);

        const totalTasks = await taskRepo.count();
        const completedTasks = await taskRepo.count({
          where: { status: 2 } as Record<string, unknown>,
        });
        const pendingTasks = await taskRepo.count({
          where: { status: 0 } as Record<string, unknown>,
        });
        const failedTasks = await taskRepo.count({
          where: { status: 3 } as Record<string, unknown>,
        });
        const inProgressTasks = await taskRepo.count({
          where: { status: 1 } as Record<string, unknown>,
        });
        const totalResults = await resultRepo.count();
        const platformsAvailable = await platformRepo.count();

        const stats: Record<string, unknown> = {
          totalTasks,
          completedTasks,
          pendingTasks,
          failedTasks,
          inProgressTasks,
          totalResults,
          platformsAvailable,
        };

        formatItem(stats, opts.json, 'yellow-pages:statistics', YP_STATISTICS_FIELDS);
      } catch (error) {
        formatError(error, opts.json, 'yellow-pages:statistics');
      }
    });
}
