/**
 * Tests for logger utility
 */
import { describe, it, expect, vi, beforeEach, type SpyInstance } from 'vitest';
import { createLogger } from '@/childprocess/utils/logger';

describe('Logger', () => {
    let consoleLogSpy: SpyInstance;
    let consoleWarnSpy: SpyInstance;
    let consoleErrorSpy: SpyInstance;

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {
            // Intentionally empty - we just want to suppress console output
        });
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
            // Intentionally empty - we just want to suppress console output
        });
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
            // Intentionally empty - we just want to suppress console output
        });
    });

    it('should create a logger with a prefix', () => {
        const logger = createLogger('TestPrefix');
        expect(logger).toBeDefined();
    });

    it('should log info messages', () => {
        const logger = createLogger('Test');
        logger.info('Test message');

        expect(consoleLogSpy).toHaveBeenCalled();
        const callArgs = consoleLogSpy.mock.calls[0][0] as string;
        expect(callArgs).toContain('[INFO]');
        expect(callArgs).toContain('[Test]');
        expect(callArgs).toContain('Test message');
    });

    it('should log warn messages', () => {
        const logger = createLogger('Test');
        logger.warn('Warning message');

        expect(consoleWarnSpy).toHaveBeenCalled();
        const callArgs = consoleWarnSpy.mock.calls[0][0] as string;
        expect(callArgs).toContain('[WARN]');
        expect(callArgs).toContain('[Test]');
        expect(callArgs).toContain('Warning message');
    });

    it('should log error messages', () => {
        const logger = createLogger('Test');
        logger.error('Error message');

        expect(consoleErrorSpy).toHaveBeenCalled();
        const callArgs = consoleErrorSpy.mock.calls[0][0] as string;
        expect(callArgs).toContain('[ERROR]');
        expect(callArgs).toContain('[Test]');
        expect(callArgs).toContain('Error message');
    });

    it('should log debug messages', () => {
        const logger = createLogger('Test');
        logger.debug('Debug message');

        expect(consoleLogSpy).toHaveBeenCalled();
        const callArgs = consoleLogSpy.mock.calls[0][0] as string;
        expect(callArgs).toContain('[DEBUG]');
        expect(callArgs).toContain('[Test]');
        expect(callArgs).toContain('Debug message');
    });

    it('should include timestamp in logs', () => {
        const logger = createLogger('Test');
        logger.info('Test message');

        const callArgs = consoleLogSpy.mock.calls[0][0] as string;
        // ISO timestamp format: YYYY-MM-DDTHH:mm:ss.sssZ
        expect(callArgs).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    it('should pass additional arguments to console', () => {
        const logger = createLogger('Test');
        const extraObj = { key: 'value' };
        logger.info('Test message', extraObj, 'extra string');

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('[INFO]'),
            extraObj,
            'extra string'
        );
    });
});
