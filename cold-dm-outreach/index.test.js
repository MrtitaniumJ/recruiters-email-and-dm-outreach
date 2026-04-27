const { test, describe, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readJsonFile } = require('./index');

describe('readJsonFile', () => {
    const testFilePath = path.join(__dirname, 'test-readJsonFile.json');

    afterEach(() => {
        if (fs.existsSync(testFilePath)) {
            fs.unlinkSync(testFilePath);
        }
    });

    test('should return fallback if file does not exist', () => {
        const fallback = { isFallback: true };
        const result = readJsonFile('non-existent-file.json', fallback);
        assert.deepStrictEqual(result, fallback);
    });

    test('should return parsed JSON if file exists and is valid', () => {
        const data = { key: 'value' };
        fs.writeFileSync(testFilePath, JSON.stringify(data));

        const fallback = { isFallback: true };
        const result = readJsonFile(testFilePath, fallback);
        assert.deepStrictEqual(result, data);
    });

    test('should return fallback if file exists but is empty', () => {
        fs.writeFileSync(testFilePath, '   ');

        const fallback = { isFallback: true };
        const result = readJsonFile(testFilePath, fallback);
        assert.deepStrictEqual(result, fallback);
    });

    test('should return fallback if JSON parsing fails', () => {
        fs.writeFileSync(testFilePath, 'invalid json');

        const fallback = { isFallback: true };
        const result = readJsonFile(testFilePath, fallback);
        assert.deepStrictEqual(result, fallback);
    });
});
