const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readFileIfExists } = require('./notionTracker');

describe('readFileIfExists', () => {
    test('should return trimmed file contents if file exists', () => {
        const testFilePath = path.join(__dirname, 'temp_test_file.txt');
        fs.writeFileSync(testFilePath, '   file content \n\n');

        const content = readFileIfExists(testFilePath);
        assert.strictEqual(content, 'file content');

        fs.unlinkSync(testFilePath);
    });

    test('should return empty string if file does not exist', () => {
        const testFilePath = path.join(__dirname, 'non_existent_file.txt');

        const content = readFileIfExists(testFilePath);
        assert.strictEqual(content, '');
    });

    test('should return empty string if error occurs reading directory', () => {
        const content = readFileIfExists(__dirname); // __dirname is a directory, not a file
        assert.strictEqual(content, '');
    });
});
