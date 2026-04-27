const { test, describe } = require('node:test');
const assert = require('node:assert');
const { anyMatch } = require('./outreachClassifier');

describe('anyMatch', () => {
    test('should return true if any pattern matches the text', () => {
        const patterns = [/apple/i, /banana/i];
        assert.strictEqual(anyMatch('I have an apple', patterns), true);
    });

    test('should return false if no pattern matches the text', () => {
        const patterns = [/apple/i, /banana/i];
        assert.strictEqual(anyMatch('I have an orange', patterns), false);
    });

    test('should return false if patterns array is empty', () => {
        assert.strictEqual(anyMatch('I have an apple', []), false);
    });

    test('should be case sensitive or insensitive based on regex flags', () => {
        const patternsCaseSensitive = [/apple/];
        assert.strictEqual(anyMatch('I have an Apple', patternsCaseSensitive), false);

        const patternsCaseInsensitive = [/apple/i];
        assert.strictEqual(anyMatch('I have an Apple', patternsCaseInsensitive), true);
    });

    test('should return false for empty text if patterns require content', () => {
        const patterns = [/apple/i, /banana/i];
        assert.strictEqual(anyMatch('', patterns), false);
    });

    test('should match start and end boundaries if specified', () => {
        const patterns = [/^apple$/, /^banana$/];
        assert.strictEqual(anyMatch('apple', patterns), true);
        assert.strictEqual(anyMatch('apple pie', patterns), false);
    });
});
