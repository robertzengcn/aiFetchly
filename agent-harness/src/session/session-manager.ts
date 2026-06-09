/**
 * Session manager - persists CLI session state to disk.
 * Sessions are stored as JSON files at ~/.aifetchly/sessions/<uuid>.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { SessionState } from '../common/types';

const SESSIONS_DIR = path.join(os.homedir(), '.aifetchly', 'sessions');
const MAX_HISTORY = 100;

export class SessionManager {
  private currentSession: SessionState | null = null;

  /** Create a new session */
  create(dbPath: string): SessionState {
    this.ensureDir();
    const session: SessionState = {
      id: uuidv4(),
      dbPath,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      commandHistory: [],
      context: {
        outputFormat: 'table',
        defaultPageSize: 20,
      },
    };
    this.currentSession = session;
    this.save();
    return session;
  }

  /** Load an existing session by ID */
  load(sessionId: string): SessionState {
    const filePath = this.getFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    this.currentSession = JSON.parse(raw) as SessionState;
    return this.currentSession;
  }

  /** Save current session to disk */
  save(): void {
    if (!this.currentSession) return;
    this.ensureDir();
    this.currentSession.lastActivity = new Date().toISOString();
    const filePath = this.getFilePath(this.currentSession.id);
    fs.writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2), 'utf-8');
  }

  /** Get the current session */
  getCurrent(): SessionState | null {
    return this.currentSession;
  }

  /** Update session context */
  updateContext(partial: Partial<SessionState['context']>): void {
    if (!this.currentSession) return;
    this.currentSession.context = {
      ...this.currentSession.context,
      ...partial,
    };
    this.save();
  }

  /** Add a command to history */
  addToHistory(command: string): void {
    if (!this.currentSession) return;
    this.currentSession.commandHistory.push(command);
    if (this.currentSession.commandHistory.length > MAX_HISTORY) {
      this.currentSession.commandHistory =
        this.currentSession.commandHistory.slice(-MAX_HISTORY);
    }
    this.save();
  }

  /** List all sessions */
  listSessions(): Array<{ id: string; createdAt: string; dbPath: string }> {
    this.ensureDir();
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8');
      const session = JSON.parse(raw) as SessionState;
      return { id: session.id, createdAt: session.createdAt, dbPath: session.dbPath };
    });
  }

  /** Destroy a session */
  destroy(sessionId: string): void {
    const filePath = this.getFilePath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }
  }

  private getFilePath(sessionId: string): string {
    return path.join(SESSIONS_DIR, `${sessionId}.json`);
  }

  private ensureDir(): void {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }
}
