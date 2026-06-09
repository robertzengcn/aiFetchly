/**
 * Dashboard commands - aggregate statistics and activity trends.
 * Queries tasks, search_task, emailsearch_task, contact_info, and proxy tables.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { CliDatabase } from '../adapter/cli-database';
import { TaskEntity } from '@/entity/Task.entity';
import { SearchTaskEntity } from '@/entity/SearchTask.entity';
import { EmailSearchTaskEntity } from '@/entity/EmailSearchTask.entity';
import { ContactInfoEntity } from '@/entity/ContactInfo.entity';
import { ProxyEntity } from '@/entity/Proxy.entity';
import { formatOutput, formatError } from '../output/formatter';
import type { TableConfig } from '../common/types';

const TRENDS_TABLE_CONFIG: TableConfig = {
  columns: [
    { key: 'period', header: 'Period', width: 20 },
    { key: 'totalTasks', header: 'Total Tasks', width: 14 },
    { key: 'searchTasks', header: 'Search Tasks', width: 14 },
    { key: 'emailExtractions', header: 'Email Extractions', width: 18 },
  ],
};

export function registerDashboardCommands(parent: Command): void {
  const dashboard = parent
    .command('dashboard')
    .description('Dashboard statistics and trends');

  dashboard
    .command('summary')
    .description('Summary statistics across all task types')
    .option('--start-date <date>', 'Start date filter (YYYY-MM-DD)')
    .option('--end-date <date>', 'End date filter (YYYY-MM-DD)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();

        const startDate = opts.startDate
          ? new Date(opts.startDate)
          : undefined;
        const endDate = opts.endDate ? new Date(opts.endDate) : undefined;

        if (startDate && isNaN(startDate.getTime())) {
          throw new Error(
            `Invalid start-date format: ${opts.startDate}. Use YYYY-MM-DD.`,
          );
        }
        if (endDate && isNaN(endDate.getTime())) {
          throw new Error(
            `Invalid end-date format: ${opts.endDate}. Use YYYY-MM-DD.`,
          );
        }

        const taskRepo = CliDatabase.getRepository(TaskEntity);
        const searchTaskRepo = CliDatabase.getRepository(SearchTaskEntity);
        const emailSearchTaskRepo = CliDatabase.getRepository(
          EmailSearchTaskEntity,
        );
        const contactRepo = CliDatabase.getRepository(ContactInfoEntity);
        const proxyRepo = CliDatabase.getRepository(ProxyEntity);

        const [
          totalTasks,
          searchTasks,
          emailExtractions,
          contacts,
          proxies,
        ] = await Promise.all([
          countWithDateFilter(taskRepo, 'created_at', startDate, endDate),
          countWithDateFilter(searchTaskRepo, 'createdAt', startDate, endDate),
          countWithDateFilter(
            emailSearchTaskRepo,
            'createdAt',
            startDate,
            endDate,
          ),
          countWithDateFilter(
            contactRepo,
            'extractionDate',
            startDate,
            endDate,
          ),
          countWithDateFilter(proxyRepo, 'createdAt', startDate, endDate),
        ]);

        const data = {
          period: {
            startDate: startDate?.toISOString() ?? null,
            endDate: endDate?.toISOString() ?? null,
          },
          counts: {
            totalTasks,
            searchTasks,
            emailExtractions,
            contacts,
            proxies,
          },
        };

        if (opts.json) {
          formatOutput(data, true, 'dashboard:summary');
        } else {
          console.log(chalk.bold('Dashboard Summary'));
          if (startDate || endDate) {
            console.log(
              chalk.gray(
                `Period: ${startDate ? startDate.toISOString().split('T')[0] : '...'} - ${endDate ? endDate.toISOString().split('T')[0] : '...'}`,
              ),
            );
          }
          console.log(
            chalk.cyan('  Total Tasks:        ') + String(totalTasks),
          );
          console.log(
            chalk.cyan('  Search Tasks:       ') + String(searchTasks),
          );
          console.log(
            chalk.cyan('  Email Extractions:  ') + String(emailExtractions),
          );
          console.log(
            chalk.cyan('  Contacts:           ') + String(contacts),
          );
          console.log(
            chalk.cyan('  Proxies:            ') + String(proxies),
          );
        }
      } catch (error) {
        formatError(error, opts.json, 'dashboard:summary');
      }
    });

  dashboard
    .command('trends')
    .description('Activity trends grouped by time period')
    .option('--start-date <date>', 'Start date filter (YYYY-MM-DD)')
    .option('--end-date <date>', 'End date filter (YYYY-MM-DD)')
    .option(
      '-g, --group-by <period>',
      'Group by period (day, week, month)',
      'day',
    )
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();

        const groupBy = (opts.groupBy || 'day').toLowerCase();
        if (!['day', 'week', 'month'].includes(groupBy)) {
          throw new Error(
            `Invalid group-by: ${groupBy}. Must be day, week, or month.`,
          );
        }

        const startDate = opts.startDate
          ? new Date(opts.startDate)
          : getDefaultStartDate(groupBy);
        const endDate = opts.endDate ? new Date(opts.endDate) : new Date();

        if (isNaN(startDate.getTime())) {
          throw new Error(
            `Invalid start-date format: ${opts.startDate}. Use YYYY-MM-DD.`,
          );
        }
        if (isNaN(endDate.getTime())) {
          throw new Error(
            `Invalid end-date format: ${opts.endDate}. Use YYYY-MM-DD.`,
          );
        }

        const taskRepo = CliDatabase.getRepository(TaskEntity);
        const searchTaskRepo = CliDatabase.getRepository(SearchTaskEntity);
        const emailSearchTaskRepo = CliDatabase.getRepository(
          EmailSearchTaskEntity,
        );

        const sqliteDateFormat = getSqliteDateFormat(groupBy);

        const [
          taskTrends,
          searchTaskTrends,
          emailExtractionTrends,
        ] = await Promise.all([
          queryTrends(taskRepo, 'created_at', sqliteDateFormat, startDate, endDate),
          queryTrends(searchTaskRepo, 'createdAt', sqliteDateFormat, startDate, endDate),
          queryTrends(emailSearchTaskRepo, 'createdAt', sqliteDateFormat, startDate, endDate),
        ]);

        const taskMap = new Map(
          (taskTrends as Array<Record<string, unknown>>).map(
            (r) => [String(r.period), Number(r.count)] as [string, number],
          ),
        );
        const searchMap = new Map(
          (searchTaskTrends as Array<Record<string, unknown>>).map(
            (r) => [String(r.period), Number(r.count)] as [string, number],
          ),
        );
        const emailMap = new Map(
          (emailExtractionTrends as Array<Record<string, unknown>>).map(
            (r) => [String(r.period), Number(r.count)] as [string, number],
          ),
        );

        const allPeriods = new Set([
          ...taskMap.keys(),
          ...searchMap.keys(),
          ...emailMap.keys(),
        ]);
        const sortedPeriods = [...allPeriods].sort();

        const items = sortedPeriods.map((period) => ({
          period,
          totalTasks: taskMap.get(period) ?? 0,
          searchTasks: searchMap.get(period) ?? 0,
          emailExtractions: emailMap.get(period) ?? 0,
        }));

        const data = {
          groupBy,
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          items,
        };

        formatOutput(
          data,
          opts.json,
          'dashboard:trends',
          TRENDS_TABLE_CONFIG,
        );
      } catch (error) {
        formatError(error, opts.json, 'dashboard:trends');
      }
    });
}

/**
 * Count rows in a repository with an optional date range filter.
 */
async function countWithDateFilter(
  repo: ReturnType<typeof CliDatabase.getRepository>,
  dateColumn: string,
  startDate?: Date,
  endDate?: Date,
): Promise<number> {
  const qb = repo.createQueryBuilder('t');
  if (startDate) {
    qb.andWhere(`t.${dateColumn} >= :startDate`, {
      startDate: startDate.toISOString(),
    });
  }
  if (endDate) {
    qb.andWhere(`t.${dateColumn} <= :endDate`, {
      endDate: endDate.toISOString(),
    });
  }
  return qb.getCount();
}

/**
 * Query grouped counts using SQLite date functions.
 */
async function queryTrends(
  repo: ReturnType<typeof CliDatabase.getRepository>,
  dateColumn: string,
  dateFormat: string,
  startDate: Date,
  endDate: Date,
): Promise<unknown[]> {
  return repo
    .createQueryBuilder('t')
    .select(`strftime('${dateFormat}', t.${dateColumn})`, 'period')
    .addSelect('COUNT(*)', 'count')
    .where(`t.${dateColumn} >= :startDate`, {
      startDate: startDate.toISOString(),
    })
    .andWhere(`t.${dateColumn} <= :endDate`, {
      endDate: endDate.toISOString(),
    })
    .groupBy('period')
    .orderBy('period', 'ASC')
    .getRawMany();
}

/** Map group-by option to SQLite strftime format. */
function getSqliteDateFormat(groupBy: string): string {
  switch (groupBy) {
    case 'day':
      return '%Y-%m-%d';
    case 'week':
      return '%Y-W%W';
    case 'month':
      return '%Y-%m';
    default:
      return '%Y-%m-%d';
  }
}

/** Get a sensible default start date based on the grouping period. */
function getDefaultStartDate(groupBy: string): Date {
  const now = new Date();
  switch (groupBy) {
    case 'day':
      now.setDate(now.getDate() - 30);
      return now;
    case 'week':
      now.setDate(now.getDate() - 90);
      return now;
    case 'month':
      now.setFullYear(now.getFullYear() - 1);
      return now;
    default:
      now.setDate(now.getDate() - 30);
      return now;
  }
}
