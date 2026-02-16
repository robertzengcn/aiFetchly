/**
 * Tests for PageStateCapture
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { capturePageState } from '@/childprocess/utils/PageStateCapture';
import { Page, Accessibility } from 'puppeteer';

// Mock Page - use unknown to avoid complex Puppeteer generic type issues
const createMockPage = () => {
    return {
        url: vi.fn(),
        title: vi.fn(),
        content: vi.fn(),
        screenshot: vi.fn(),
        accessibility: {
            snapshot: vi.fn()
        } as unknown as Accessibility
    } as unknown as Page;
};

describe('PageStateCapture', () => {
    let mockPage: Page;

    beforeEach(() => {
        mockPage = createMockPage();
        vi.mocked(mockPage.url).mockReturnValue('https://example.com');
        vi.mocked(mockPage.title).mockResolvedValue('Test Page');
        vi.mocked(mockPage.content).mockResolvedValue('<html><body>Test Content</body></html>');
    });

    it('should capture basic page state', async () => {
        const result = await capturePageState(
            mockPage,
            'search_input',
            'google',
            'Test error',
            ['.selector1', '.selector2']
        );

        expect(result.operation).toBe('search_input');
        expect(result.searchEngine).toBe('google');
        expect(result.currentUrl).toBe('https://example.com');
        expect(result.pageTitle).toBe('Test Page');
        expect(result.errorMessage).toBe('Test error');
        expect(result.attemptedSelectors).toEqual(['.selector1', '.selector2']);
        expect(result.htmlSample).toBeDefined();
        expect(result.requestId).toBeDefined();
    });

    it('should generate unique request IDs', async () => {
        const result1 = await capturePageState(
            mockPage,
            'op1',
            'google',
            'error',
            ['.sel']
        );

        const result2 = await capturePageState(
            mockPage,
            'op2',
            'google',
            'error',
            ['.sel']
        );

        expect(result1.requestId).not.toBe(result2.requestId);
    });

    it('should include screenshot when requested', async () => {
        vi.mocked(mockPage.screenshot).mockResolvedValue(
            Buffer.from('fake-screenshot-data').toString('base64') as never
        );

        const result = await capturePageState(
            mockPage,
            'search_input',
            'google',
            'error',
            ['.sel'],
            { includeScreenshot: true }
        );

        expect(mockPage.screenshot).toHaveBeenCalledWith({
            type: 'png',
            encoding: 'base64',
            fullPage: false
        });
        expect(result.screenshot).toBeDefined();
    });

    it('should handle screenshot failure gracefully', async () => {
        vi.mocked(mockPage.screenshot).mockRejectedValue(
            new Error('Screenshot failed')
        );

        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
            // Intentionally empty - we just want to suppress console output
        });

        const result = await capturePageState(
            mockPage,
            'search_input',
            'google',
            'error',
            ['.sel'],
            { includeScreenshot: true }
        );

        expect(result.screenshot).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Failed to capture screenshot:',
            expect.any(Error)
        );

        consoleWarnSpy.mockRestore();
    });

    it('should include accessibility tree when requested', async () => {
        const mockSnapshot = {
            role: 'WebArea',
            name: 'Test Page',
            children: [
                {
                    role: 'button',
                    name: 'Click me'
                }
            ]
        };
        vi.mocked(mockPage.accessibility.snapshot).mockResolvedValue(
            mockSnapshot as never
        );

        const result = await capturePageState(
            mockPage,
            'search_input',
            'google',
            'error',
            ['.sel'],
            { includeAccessibilityTree: true }
        );

        expect(result.accessibilityTree).toBeDefined();
        expect(result.accessibilityTree).toContain('WebArea');
        expect(mockPage.accessibility.snapshot).toHaveBeenCalled();
    });

    it('should handle accessibility tree failure gracefully', async () => {
        vi.mocked(mockPage.accessibility.snapshot).mockRejectedValue(
            new Error('Accessibility snapshot failed')
        );

        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
            // Intentionally empty - we just want to suppress console output
        });

        const result = await capturePageState(
            mockPage,
            'search_input',
            'google',
            'error',
            ['.sel'],
            { includeAccessibilityTree: true }
        );

        expect(result.accessibilityTree).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Failed to get accessibility tree:',
            expect.any(Error)
        );

        consoleWarnSpy.mockRestore();
    });

    it('should truncate HTML to max length', async () => {
        const longHtml = '<html>' + '<div>'.repeat(10000) + '</html>';
        vi.mocked(mockPage.content).mockResolvedValue(longHtml);

        const result = await capturePageState(
            mockPage,
            'search_input',
            'google',
            'error',
            ['.sel'],
            { maxHtmlLength: 1000 }
        );

        expect(result.htmlSample.length).toBeLessThanOrEqual(1000);
    });

    it('should clean HTML by removing scripts and styles', async () => {
        const htmlWithScripts = `
            <html>
                <head>
                    <script>alert('test');</script>
                    <style>.test { color: red; }</style>
                </head>
                <body>Content</body>
            </html>
        `;
        vi.mocked(mockPage.content).mockResolvedValue(htmlWithScripts);

        const result = await capturePageState(
            mockPage,
            'search_input',
            'google',
            'error',
            ['.sel']
        );

        expect(result.htmlSample).not.toContain('<script>');
        expect(result.htmlSample).not.toContain('<style>');
        expect(result.htmlSample).toContain('Content');
    });

    it('should extract main content from HTML', async () => {
        const htmlWithMain = `
            <html>
                <head><title>Test</title></head>
                <body>
                    <div class="sidebar">Sidebar</div>
                    <main id="main">Main Content</main>
                    <footer>Footer</footer>
                </body>
            </html>
        `;
        vi.mocked(mockPage.content).mockResolvedValue(htmlWithMain);

        const result = await capturePageState(
            mockPage,
            'search_input',
            'google',
            'error',
            ['.sel'],
            { maxHtmlLength: 100 }
        );

        expect(result.htmlSample).toContain('Main Content');
        // Should prefer main content over sidebar/footer
        expect(result.htmlSample.length).toBeLessThanOrEqual(100);
    });
});
