const { test, describe } = require('node:test');
const assert = require('node:assert');
const { mergeUniqueValues, normalizeText } = require('./resumeProfile');

describe('normalizeText', () => {
    test('should trim whitespace', () => {
        assert.strictEqual(normalizeText('  hello  '), 'hello');
    });

    test('should normalize internal whitespace', () => {
        assert.strictEqual(normalizeText('hello    world'), 'hello world');
    });

    test('should handle null or undefined', () => {
        assert.strictEqual(normalizeText(null), '');
        assert.strictEqual(normalizeText(undefined), '');
    });

    test('should handle non-string inputs', () => {
        assert.strictEqual(normalizeText(123), '123');
    });
});

describe('mergeUniqueValues', () => {
    test('should merge multiple arrays and dedupe', () => {
        const result = mergeUniqueValues(['a', 'b'], ['b', 'c']);
        assert.deepStrictEqual(result, ['a', 'b', 'c']);
    });

    test('should be case-insensitive when deduping but preserve first case', () => {
        const result = mergeUniqueValues(['Apple', 'banana'], ['APPLE', 'BANANA', 'cherry']);
        assert.deepStrictEqual(result, ['Apple', 'banana', 'cherry']);
    });

    test('should dedupe within a single array', () => {
        const result = mergeUniqueValues(['a', 'a', 'b', 'A']);
        assert.deepStrictEqual(result, ['a', 'b']);
    });

    test('should normalize text during merging', () => {
        const result = mergeUniqueValues(['  react  ', 'node.js'], ['REACT', '  node.js  ']);
        assert.deepStrictEqual(result, ['react', 'node.js']);
    });

    test('should ignore non-array inputs', () => {
        const result = mergeUniqueValues(['a'], 'not an array', { key: 'value' }, ['b']);
        assert.deepStrictEqual(result, ['a', 'b']);
    });

    test('should filter out empty, null, or undefined elements after normalization', () => {
        const result = mergeUniqueValues(['a', '', null, undefined, '  ', 'b']);
        assert.deepStrictEqual(result, ['a', 'b']);
    });

    test('should return empty array if no valid arrays provided', () => {
        assert.deepStrictEqual(mergeUniqueValues(), []);
        assert.deepStrictEqual(mergeUniqueValues(null, 123, 'string'), []);
    });
});
