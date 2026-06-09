/**
 * CLI-specific error classes.
 */

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export class DatabaseError extends CliError {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class DatabaseNotFoundError extends DatabaseError {
  constructor(path: string) {
    super(`Database not found at: ${path}. Ensure aiFetchly has been run at least once or use --db to specify the path.`);
    this.name = 'DatabaseNotFoundError';
  }
}

export class ReadOnlyError extends CliError {
  constructor(operation: string) {
    super(`Operation '${operation}' is not allowed in read-only mode. Remove --read-only flag to enable writes.`);
    this.name = 'ReadOnlyError';
  }
}

export class ValidationError extends CliError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
