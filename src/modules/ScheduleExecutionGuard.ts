export interface ExecutionLease {
  release(): void;
}

/**
 * Coordinates in-process exclusion across both `ScheduleManager` (CronJob /
 * Run Now / dependency chains) and `BackgroundScheduler` (queue / interval poller)
 * so the same schedule — or two schedules targeting the same task — cannot run
 * concurrently in the same process.
 */
export class ScheduleExecutionGuard {
  private static instance: ScheduleExecutionGuard | null = null;
  private runningSchedules = new Map<number, symbol>();
  private runningTasks = new Map<string, symbol>();

  private constructor() {}

  static getInstance(): ScheduleExecutionGuard {
    if (!ScheduleExecutionGuard.instance) {
      ScheduleExecutionGuard.instance = new ScheduleExecutionGuard();
    }
    return ScheduleExecutionGuard.instance;
  }

  private buildTaskKey(taskType: string, taskId: number): string {
    return `${taskType}:${taskId}`;
  }

  tryAcquireSchedule(scheduleId: number): ExecutionLease | null {
    if (this.runningSchedules.has(scheduleId)) {
      return null;
    }
    const token = Symbol(`schedule-${scheduleId}`);
    this.runningSchedules.set(scheduleId, token);
    let released = false;
    return {
      release: (): void => {
        if (released) return;
        released = true;
        if (this.runningSchedules.get(scheduleId) === token) {
          this.runningSchedules.delete(scheduleId);
        }
      },
    };
  }

  tryAcquireTask(taskType: string, taskId: number): ExecutionLease | null {
    const key = this.buildTaskKey(taskType, taskId);
    if (this.runningTasks.has(key)) {
      return null;
    }
    const token = Symbol(`task-${key}`);
    this.runningTasks.set(key, token);
    let released = false;
    return {
      release: (): void => {
        if (released) return;
        released = true;
        if (this.runningTasks.get(key) === token) {
          this.runningTasks.delete(key);
        }
      },
    };
  }

  isScheduleRunning(scheduleId: number): boolean {
    return this.runningSchedules.has(scheduleId);
  }

  isTaskRunning(taskType: string, taskId: number): boolean {
    return this.runningTasks.has(this.buildTaskKey(taskType, taskId));
  }

  clear(): void {
    this.runningSchedules.clear();
    this.runningTasks.clear();
  }
}
