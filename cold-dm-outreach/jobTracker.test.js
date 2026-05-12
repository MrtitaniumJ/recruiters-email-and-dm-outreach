const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readFileIfExists } = require('./jobTracker');

describe('readFileIfExists', () => {
    it('should return the trimmed content of the file if it exists', () => {
        const filePath = path.join(__dirname, 'test-file.txt');
        fs.writeFileSync(filePath, '  hello world  \n');

        try {
            const result = readFileIfExists(filePath);
            assert.strictEqual(result, 'hello world');
        } finally {
            // Cleanup
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
    });

    it('should return an empty string if the file does not exist', () => {
        const filePath = path.join(__dirname, 'non-existent-file.txt');

        const result = readFileIfExists(filePath);

        assert.strictEqual(result, '');
    });
});
