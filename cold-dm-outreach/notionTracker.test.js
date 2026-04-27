const { test, describe, after, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readFileIfExists } = require('./notionTracker');

describe('readFileIfExists', () => {
    let tempDir;

    before(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notiontracker-test-'));
    });

    after(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('should return trimmed content if file exists', () => {
        const filePath = path.join(tempDir, 'test1.txt');
        fs.writeFileSync(filePath, '  hello world  \n');

        const content = readFileIfExists(filePath);
        assert.strictEqual(content, 'hello world');
    });

    test('should return empty string if file does not exist', () => {
        const filePath = path.join(tempDir, 'does-not-exist.txt');

        const content = readFileIfExists(filePath);
        assert.strictEqual(content, '');
    });

    test('should return empty string if path is a directory', () => {
        const content = readFileIfExists(tempDir);
        assert.strictEqual(content, '');
    });
});
