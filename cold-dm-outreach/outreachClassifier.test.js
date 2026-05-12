const { test, describe } = require('node:test');
const assert = require('node:assert');
const { textOf } = require('./outreachClassifier');

describe('textOf', () => {
    test('should return combined trimmed text when both headline and additionalDetails exist', () => {
        const connection = {
            headline: 'Software Engineer',
            additionalDetails: 'React, Node.js'
        };
        assert.strictEqual(textOf(connection), 'Software Engineer React, Node.js');
    });

    test('should handle missing additionalDetails', () => {
        const connection = {
            headline: 'Frontend Developer'
        };
        assert.strictEqual(textOf(connection), 'Frontend Developer');
    });

    test('should handle missing headline', () => {
        const connection = {
            additionalDetails: 'Some details'
        };
        assert.strictEqual(textOf(connection), 'Some details');
    });

    test('should handle missing both fields', () => {
        const connection = {};
        assert.strictEqual(textOf(connection), '');
    });

    test('should normalize multiple inner whitespaces', () => {
        const connection = {
            headline: '   Senior   Engineer   ',
            additionalDetails: '  at   Company   '
        };
        assert.strictEqual(textOf(connection), 'Senior Engineer at Company');
    });

    test('should handle null properties gracefully', () => {
        const connection = {
            headline: null,
            additionalDetails: null
        };
        assert.strictEqual(textOf(connection), '');
    });
});
