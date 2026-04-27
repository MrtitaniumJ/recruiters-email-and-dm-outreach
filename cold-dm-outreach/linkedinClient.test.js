const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const linkedinClient = require('./linkedinClient');

// Monkey patch global.setTimeout
const originalSetTimeout = global.setTimeout;

describe('linkedinClient', () => {

    describe('constants', () => {
        test('should have correct base URLs', () => {
            assert.strictEqual(linkedinClient.LINKEDIN_BASE_URL, 'https://www.linkedin.com');
            assert.strictEqual(linkedinClient.CONNECTIONS_URL, 'https://www.linkedin.com/mynetwork/invite-connect/connections/');
        });
    });

    describe('sleep', () => {
        test('should resolve after specified time', async () => {
            global.setTimeout = (cb) => cb(); // resolve immediately
            let resolved = false;
            await linkedinClient.sleep(10).then(() => { resolved = true; });
            assert.strictEqual(resolved, true);
            global.setTimeout = originalSetTimeout;
        });
    });

    describe('randomBetween', () => {
        test('should return a number between min and max inclusive', () => {
            for (let i = 0; i < 50; i++) {
                const val = linkedinClient.randomBetween(5, 10);
                assert.ok(val >= 5 && val <= 10);
                assert.ok(Number.isInteger(val));
            }
        });
    });

    describe('ensureLinkedInSession', () => {
        test.beforeEach(() => {
            global.setTimeout = (cb) => cb();
        });

        test.afterEach(() => {
            global.setTimeout = originalSetTimeout;
        });

        test('should set cookie, navigate, and verify session', async () => {
            const page = {
                cookies: [],
                urls: [],
                setCookie: async (cookie) => {
                    page.cookies.push(cookie);
                    return Promise.resolve();
                },
                goto: async (url, options) => {
                    page.urls.push({url, options});
                    return Promise.resolve();
                },
                evaluate: async () => {
                    return { loginDetected: false, url: 'ok', title: 'ok' };
                }
            };

            const state = await linkedinClient.ensureLinkedInSession(page, 'test_li_at');

            assert.strictEqual(state.loginDetected, false);
            assert.strictEqual(page.cookies.length, 1);
            assert.strictEqual(page.cookies[0].name, 'li_at');
            assert.strictEqual(page.cookies[0].value, 'test_li_at');
            assert.strictEqual(page.urls.length, 1);
            assert.strictEqual(page.urls[0].url, linkedinClient.CONNECTIONS_URL);
        });

        test('should throw an error if session verification fails', async () => {
            const page = {
                setCookie: async () => Promise.resolve(),
                goto: async () => Promise.resolve(),
                evaluate: async () => {
                    return { loginDetected: true };
                }
            };

            await assert.rejects(
                linkedinClient.ensureLinkedInSession(page, 'test_li_at'),
                { message: /LinkedIn session is not authenticated/ }
            );
        });
    });

    describe('returnToConnections', () => {
        test.beforeEach(() => {
            global.setTimeout = (cb) => cb();
        });

        test.afterEach(() => {
            global.setTimeout = originalSetTimeout;
        });

        test('should navigate to connections URL and wait', async () => {
            const page = {
                urls: [],
                goto: async (url, options) => {
                    page.urls.push({url, options});
                    return Promise.resolve();
                }
            };

            await linkedinClient.returnToConnections(page);

            assert.strictEqual(page.urls.length, 1);
            assert.strictEqual(page.urls[0].url, linkedinClient.CONNECTIONS_URL);
        });
    });

    describe('extractTotalConnectionCount', () => {
        test('should return null if no match found', async () => {
            const page = {
                evaluate: async () => null
            };
            const count = await linkedinClient.extractTotalConnectionCount(page);
            assert.strictEqual(count, null);
        });

        test('should return the parsed number if match found', async () => {
            const page = {
                evaluate: async () => 1234
            };
            const count = await linkedinClient.extractTotalConnectionCount(page);
            assert.strictEqual(count, 1234);
        });
    });

    describe('extractVisibleConnections', () => {
        test('should return array of connections', async () => {
            const mockConnections = [
                { fullName: 'Alice', profileUrl: 'http://link1' },
                { fullName: 'Bob', profileUrl: 'http://link2' }
            ];
            const page = {
                evaluate: async () => mockConnections
            };
            const result = await linkedinClient.extractVisibleConnections(page);
            assert.deepStrictEqual(result, mockConnections);
        });
    });
});
