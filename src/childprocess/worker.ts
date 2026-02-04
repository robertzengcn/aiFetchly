/**
 * Type definitions for Worker Process
 * Extends NodeJS.Process to include parentPort for IPC communication
 */

export interface ParentPort {
    postMessage: (message: string) => void;
    on: (event: string, handler: (e: { data: string }) => void) => void;
}

/**
 * Extended worker process type with parentPort support
 * This type is used in child processes that communicate with the main process via worker_threads
 */
export interface WorkerProcess extends NodeJS.Process {
    parentPort?: ParentPort;
}

/**
 * Type guard to check if a process is a WorkerProcess with parentPort
 */
export function isWorkerProcess(proc: NodeJS.Process): proc is WorkerProcess {
    return 'parentPort' in proc && proc.parentPort !== undefined;
}
