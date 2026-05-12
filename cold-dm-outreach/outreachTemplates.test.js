const { test, describe } = require('node:test');
const assert = require('node:assert');
const { SHORT_TEMPLATES, resolveTemplate, buildMessage } = require('./outreachTemplates');

describe('outreachTemplates', () => {

    describe('resolveTemplate', () => {
        test('should resolve the correct template for a valid contactType and stage 0', () => {
            const template = resolveTemplate('recruiter', 0);
            assert.strictEqual(template, SHORT_TEMPLATES.recruiter.initial);
        });

        test('should resolve the correct template for stage 1', () => {
            const template = resolveTemplate('recruiter', 1);
            assert.strictEqual(template, SHORT_TEMPLATES.recruiter.follow_up_1);
        });

        test('should resolve the correct template for stage 2', () => {
            const template = resolveTemplate('recruiter', 2);
            assert.strictEqual(template, SHORT_TEMPLATES.recruiter.follow_up_2);
        });

        test('should fall back to generic template if contactType is invalid', () => {
            const template = resolveTemplate('unknown_type', 0);
            assert.strictEqual(template, SHORT_TEMPLATES.generic.initial);
        });

        test('should fall back to generic template if contactType is missing', () => {
            const template = resolveTemplate(undefined, 0);
            assert.strictEqual(template, SHORT_TEMPLATES.generic.initial);
        });

        test('should use override if a valid string is provided', () => {
            const overrides = { recruiter: { initial: 'Custom override message' } };
            const template = resolveTemplate('recruiter', 0, overrides);
            assert.strictEqual(template, 'Custom override message');
        });

        test('should ignore override if it is whitespace only', () => {
            const overrides = { recruiter: { initial: '   ' } };
            const template = resolveTemplate('recruiter', 0, overrides);
            assert.strictEqual(template, SHORT_TEMPLATES.recruiter.initial);
        });

        test('should ignore override if it is not a string', () => {
            const overrides = { recruiter: { initial: 123 } };
            const template = resolveTemplate('recruiter', 0, overrides);
            assert.strictEqual(template, SHORT_TEMPLATES.recruiter.initial);
        });
    });

    describe('buildMessage', () => {
        test('should correctly build a message replacing placeholders', () => {
            const overrides = { generic: { initial: "Hi {first}, you are at {company}." } };
            const connection = { contactType: 'generic', firstName: 'Alice', companyName: 'Wonderland Inc' };
            const message = buildMessage({ connection, stage: 0, overrides });
            assert.strictEqual(message, 'Hi Alice, you are at Wonderland Inc.');
        });

        test('should extract first name from fullName if firstName is missing', () => {
            const overrides = { generic: { initial: "Hi {first}" } };
            const connection = { fullName: 'Bob Builder' };
            const message = buildMessage({ connection, stage: 0, overrides });
            assert.strictEqual(message, 'Hi Bob');
        });

        test('should fallback to "there" if no name is provided', () => {
            const overrides = { generic: { initial: "Hi {first}" } };
            const connection = {};
            const message = buildMessage({ connection, stage: 0, overrides });
            assert.strictEqual(message, 'Hi there');
        });

        test('should fallback to "your company" if companyName is missing', () => {
            const overrides = { generic: { initial: "At {company}" } };
            const connection = {};
            const message = buildMessage({ connection, stage: 0, overrides });
            assert.strictEqual(message, 'At your company');
        });

        test('should replace {name} synonym just like {first}', () => {
            const overrides = { generic: { initial: "Hello {name}" } };
            const connection = { firstName: 'Charlie' };
            const message = buildMessage({ connection, stage: 0, overrides });
            assert.strictEqual(message, 'Hello Charlie');
        });

        test('should handle newlines properly and trim trailing whitespace', () => {
             const overrides = { generic: { initial: "Line 1\\nLine 2\\n\\n\\nLine 3 \n" } };
             const connection = {};
             const message = buildMessage({ connection, stage: 0, overrides });
             assert.strictEqual(message, "Line 1\nLine 2\n\nLine 3");
        });

        test('should use generic contactType if not provided in connection', () => {
             const connection = { firstName: 'Dave', companyName: 'DaveCorp' };
             const message = buildMessage({ connection, stage: 0 });
             const expected = SHORT_TEMPLATES.generic.initial
                 .replace(/{first}/g, 'Dave')
                 .replace(/{company}/g, 'DaveCorp');
             assert.strictEqual(message, expected);
        });
    });

});
