const { test, describe, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createNotionTracker, readLegacyNotionSetup } = require('./notionTracker');

describe('readLegacyNotionSetup', () => {
    test('should extract token from index.js and db_id from db_id.txt', () => {
        const mockProjectRoot = '/mock/root';

        mock.method(fs, 'readFileSync', (filePath) => {
            if (filePath.includes('index.js')) {
                return "const NOTION_TOKEN = 'secret_token_123';\n";
            }
            if (filePath.includes('db_id.txt')) {
                return "seed_db_456\n";
            }
            throw new Error('File not found');
        });

        const result = readLegacyNotionSetup(mockProjectRoot);

        assert.strictEqual(result.token, 'secret_token_123');
        assert.strictEqual(result.seedDatabaseId, 'seed_db_456');

        fs.readFileSync.mock.restore();
    });

    test('should return empty strings if files do not exist or token missing', () => {
        const mockProjectRoot = '/mock/root/empty';

        mock.method(fs, 'readFileSync', () => {
            throw new Error('File not found');
        });

        const result = readLegacyNotionSetup(mockProjectRoot);

        assert.strictEqual(result.token, '');
        assert.strictEqual(result.seedDatabaseId, '');

        fs.readFileSync.mock.restore();
    });
});

describe('createNotionTracker', () => {
    test('should configure enabled state based on token', () => {
        const mockProjectRoot = '/mock/root';
        const mockBaseDir = '/mock/root/cold-dm-outreach';

        mock.method(fs, 'readFileSync', () => {
            throw new Error('File not found');
        });

        const trackerWithEnvToken = createNotionTracker({
            projectRoot: mockProjectRoot,
            baseDir: mockBaseDir,
            env: { NOTION_TOKEN: 'env_token' }
        });

        assert.strictEqual(trackerWithEnvToken.enabled, true);
        assert.strictEqual(trackerWithEnvToken.token, 'env_token');

        const trackerWithoutToken = createNotionTracker({
            projectRoot: mockProjectRoot,
            baseDir: mockBaseDir,
            env: {}
        });

        assert.strictEqual(trackerWithoutToken.enabled, false);
        assert.strictEqual(trackerWithoutToken.token, '');

        fs.readFileSync.mock.restore();
    });
});

describe('NotionTracker Core Logic', () => {
    let tracker;

    test.beforeEach(() => {
        mock.method(fs, 'readFileSync', () => { throw new Error('Not found'); });
        tracker = createNotionTracker({
            projectRoot: '', baseDir: '', env: { NOTION_TOKEN: 'token' }
        });
    });

    test.afterEach(() => {
        fs.readFileSync.mock.restore();
    });

    test('determineOutreachStatus should return existing status if protected', () => {
        const connection = {};
        const existingRecord = { outreachStatus: 'Followed Up' };
        const sentLogs = new Set();

        const status = tracker.determineOutreachStatus(connection, existingRecord, sentLogs);
        assert.strictEqual(status, 'Followed Up');
    });

    test('determineOutreachStatus should return Messaged/Already Messaged based on sent logs', () => {
        const connection = { fullName: 'John Doe' };
        const existingRecordMessaged = { outreachStatus: 'Messaged' };
        const existingRecordNotMessaged = { outreachStatus: 'Pending' };
        const sentLogs = new Set(['John Doe']);

        assert.strictEqual(tracker.determineOutreachStatus(connection, existingRecordMessaged, sentLogs), 'Messaged');
        assert.strictEqual(tracker.determineOutreachStatus(connection, existingRecordNotMessaged, sentLogs), 'Already Messaged');
    });

    test('determineOutreachStatus should return Review for Not Relevant connections', () => {
        const connection = { fullName: 'Jane Doe', relevanceLabel: 'Not Relevant' };
        const sentLogs = new Set();

        assert.strictEqual(tracker.determineOutreachStatus(connection, null, sentLogs), 'Review');
    });

    test('determineOutreachStatus should return Pending by default', () => {
        const connection = { fullName: 'Bob', relevanceLabel: 'Strong Match' };
        const sentLogs = new Set();

        assert.strictEqual(tracker.determineOutreachStatus(connection, null, sentLogs), 'Pending');
    });

    test('shouldUpdateExistingRecord should return true if no existing record', () => {
        assert.strictEqual(tracker.shouldUpdateExistingRecord(null, {}, 'Pending'), true);
    });

    test('shouldUpdateExistingRecord should return true if properties changed', () => {
        const existingRecord = {
            name: 'Old Name',
            firstName: 'Old',
            outreachStatus: 'Pending'
        };
        const connection = {
            fullName: 'New Name',
            firstName: 'New'
        };

        assert.strictEqual(tracker.shouldUpdateExistingRecord(existingRecord, connection, 'Pending'), true);
    });

    test('shouldUpdateExistingRecord should return false if no properties changed', () => {
        const existingRecord = {
            name: 'Same Name',
            firstName: 'Same',
            profileUrl: 'url',
            messageUrl: 'murl',
            companyName: 'comp',
            contactType: 'rec',
            templateVariant: 'var',
            headline: 'head',
            additionalDetails: 'det',
            connectedOnRaw: 'raw',
            connectedOnDate: 'date',
            relevance: 'rel',
            matchScore: 10,
            matchReason: 'rsn',
            careersUrl: 'curl',
            jobMatchStatus: 'stat',
            jobMatchKeywords: 'kw',
            jobMatchNotes: 'note',
            lastJobCheckAt: 'lat',
            outreachStatus: 'Pending'
        };
        const connection = {
            fullName: 'Same Name',
            firstName: 'Same',
            profileUrl: 'url',
            messageUrl: 'murl',
            companyName: 'comp',
            contactType: 'rec',
            templateVariant: 'var',
            headline: 'head',
            additionalDetails: 'det',
            connectedOnRaw: 'raw',
            connectedOnDate: 'date',
            relevanceLabel: 'rel',
            matchScore: 10,
            matchReason: 'rsn',
            careersUrl: 'curl',
            jobMatchStatus: 'stat',
            jobMatchKeywords: ['kw'], // joined with ,
            jobMatchNotes: 'note',
            lastJobCheckAt: 'lat'
        };

        assert.strictEqual(tracker.shouldUpdateExistingRecord(existingRecord, connection, 'Pending'), false);
    });
});
