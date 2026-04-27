const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readJsonFile } = require('./jobApplicationAutomation');

describe('readJsonFile', () => {
    const testDir = path.join(__dirname, 'test-tmp');
    const validJsonPath = path.join(testDir, 'valid.json');
    const invalidJsonPath = path.join(testDir, 'invalid.json');
    const missingJsonPath = path.join(testDir, 'missing.json');

    beforeEach(() => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        fs.writeFileSync(validJsonPath, JSON.stringify({ success: true, key: "value" }));
        fs.writeFileSync(invalidJsonPath, '{ invalid: json ]');
    });

    afterEach(() => {
        if (fs.existsSync(validJsonPath)) fs.unlinkSync(validJsonPath);
        if (fs.existsSync(invalidJsonPath)) fs.unlinkSync(invalidJsonPath);
        if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
    });

    test('should return parsed JSON for a valid file', () => {
        const result = readJsonFile(validJsonPath, { fallback: true });
        assert.deepStrictEqual(result, { success: true, key: "value" });
    });

    test('should return fallback if file does not exist', () => {
        const result = readJsonFile(missingJsonPath, { isFallback: true });
        assert.deepStrictEqual(result, { isFallback: true });
    });

    test('should return fallback if file contains invalid JSON', () => {
        const result = readJsonFile(invalidJsonPath, { fallbackOnInvalid: true });
        assert.deepStrictEqual(result, { fallbackOnInvalid: true });
    });

    test('should return fallback if file is empty', () => {
        const emptyPath = path.join(testDir, 'empty.json');
        fs.writeFileSync(emptyPath, '   \n  ');
        const result = readJsonFile(emptyPath, { emptyFallback: true });
        assert.deepStrictEqual(result, { emptyFallback: true });
        if (fs.existsSync(emptyPath)) fs.unlinkSync(emptyPath);
    });
});
