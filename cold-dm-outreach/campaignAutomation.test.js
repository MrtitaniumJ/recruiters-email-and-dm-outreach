const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readJsonFile } = require('./campaignAutomation');

describe('readJsonFile', () => {
    let tempDir;

    before(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-automation-test-'));
    });

    after(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('should return fallback if file does not exist', () => {
        const fallback = { fallback: true };
        const result = readJsonFile(path.join(tempDir, 'non-existent.json'), fallback);
        assert.deepStrictEqual(result, fallback);
    });

    test('should return parsed JSON if valid file exists', () => {
        const filePath = path.join(tempDir, 'valid.json');
        const data = { key: 'value' };
        fs.writeFileSync(filePath, JSON.stringify(data));

        const fallback = { fallback: true };
        const result = readJsonFile(filePath, fallback);
        assert.deepStrictEqual(result, data);
    });

    test('should return fallback if file contains invalid JSON', () => {
        const filePath = path.join(tempDir, 'invalid.json');
        fs.writeFileSync(filePath, '{ invalid: json }');

        const fallback = { fallback: true };
        const result = readJsonFile(filePath, fallback);
        assert.deepStrictEqual(result, fallback);
    });

    test('should return fallback if file is empty string', () => {
        const filePath = path.join(tempDir, 'empty.json');
        fs.writeFileSync(filePath, '');

        const fallback = { fallback: true };
        const result = readJsonFile(filePath, fallback);
        assert.deepStrictEqual(result, fallback);
    });

    test('should trim whitespace before parsing', () => {
        const filePath = path.join(tempDir, 'whitespace.json');
        const data = { key: 'value' };
        fs.writeFileSync(filePath, '  \n  ' + JSON.stringify(data) + '  \n  ');

        const fallback = { fallback: true };
        const result = readJsonFile(filePath, fallback);
        assert.deepStrictEqual(result, data);
    });

});
