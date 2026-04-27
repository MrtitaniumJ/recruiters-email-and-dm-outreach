const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readLegacyNotionSetup } = require('./notionTracker');

describe('notionTracker - readLegacyNotionSetup', () => {
    const projectRoot = path.join(__dirname, 'test_project_root');

    afterEach(() => {
        // Cleanup test directory
        if (fs.existsSync(projectRoot)) {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }
    });

    test('should extract token from index.js and db id from db_id.txt', () => {
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'index.js'), "const NOTION_TOKEN = 'test_token_123';");
        fs.writeFileSync(path.join(projectRoot, 'db_id.txt'), 'test_db_id_456');

        const result = readLegacyNotionSetup(projectRoot);

        assert.deepStrictEqual(result, {
            token: 'test_token_123',
            seedDatabaseId: 'test_db_id_456'
        });
    });

    test('should handle missing index.js gracefully', () => {
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'db_id.txt'), 'test_db_id_456');

        const result = readLegacyNotionSetup(projectRoot);

        assert.deepStrictEqual(result, {
            token: '',
            seedDatabaseId: 'test_db_id_456'
        });
    });

    test('should handle index.js without token match', () => {
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'index.js'), "const NOTION_TOKEN = '';"); // Or just some other code
        fs.writeFileSync(path.join(projectRoot, 'db_id.txt'), 'test_db_id_456');

        const result = readLegacyNotionSetup(projectRoot);

        assert.deepStrictEqual(result, {
            token: '',
            seedDatabaseId: 'test_db_id_456'
        });
    });

    test('should handle missing db_id.txt gracefully', () => {
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'index.js'), "const NOTION_TOKEN = 'test_token_123';");

        const result = readLegacyNotionSetup(projectRoot);

        assert.deepStrictEqual(result, {
            token: 'test_token_123',
            seedDatabaseId: ''
        });
    });

    test('should handle both files missing gracefully', () => {
        fs.mkdirSync(projectRoot, { recursive: true });

        const result = readLegacyNotionSetup(projectRoot);

        assert.deepStrictEqual(result, {
            token: '',
            seedDatabaseId: ''
        });
    });
});
