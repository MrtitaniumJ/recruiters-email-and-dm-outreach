const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
    classifyContactType,
    computeRelevance,
    computeScore,
    priorityFor,
    annotateClassification,
    cleanCompanyGuess,
    PRIORITY_ORDER
} = require('./outreachClassifier');

describe('outreachClassifier', () => {
    describe('classifyContactType', () => {
        test('should classify strong negative as generic', () => {
            const connection = { headline: 'Student at University' };
            assert.strictEqual(classifyContactType(connection), 'generic');
        });

        test('should classify talent acquisition', () => {
            const connection = { headline: 'Talent Acquisition Manager' };
            assert.strictEqual(classifyContactType(connection), 'talent_acquisition');
        });

        test('should classify recruiter', () => {
            const connection = { headline: 'Technical Recruiter' };
            assert.strictEqual(classifyContactType(connection), 'recruiter');
        });

        test('should classify hr', () => {
            const connection = { headline: 'HR Business Partner' };
            assert.strictEqual(classifyContactType(connection), 'hr');
        });

        test('should classify hiring manager', () => {
            const connection = { headline: 'Engineering Manager' };
            assert.strictEqual(classifyContactType(connection), 'hiring_manager');
        });

        test('should classify engineer', () => {
            const connection = { headline: 'Software Engineer' };
            assert.strictEqual(classifyContactType(connection), 'engineer');
        });

        test('should classify manager', () => {
            const connection = { headline: 'Product Manager' };
            assert.strictEqual(classifyContactType(connection), 'manager');
        });

        test('should classify empty text as generic', () => {
            const connection = { headline: null, additionalDetails: null };
            assert.strictEqual(classifyContactType(connection), 'generic');
        });

        test('should classify unmatched text as generic', () => {
            const connection = { headline: 'Sales Representative' };
            assert.strictEqual(classifyContactType(connection), 'generic');
        });
    });

    describe('computeRelevance', () => {
        test('should map recruiters to Strong Match', () => {
            assert.strictEqual(computeRelevance('recruiter'), 'Strong Match');
            assert.strictEqual(computeRelevance('talent_acquisition'), 'Strong Match');
            assert.strictEqual(computeRelevance('hr'), 'Strong Match');
            assert.strictEqual(computeRelevance('hiring_manager'), 'Strong Match');
        });

        test('should map engineers and managers to Possible Match', () => {
            assert.strictEqual(computeRelevance('engineer'), 'Possible Match');
            assert.strictEqual(computeRelevance('manager'), 'Possible Match');
        });

        test('should map everything else to Not Relevant', () => {
            assert.strictEqual(computeRelevance('generic'), 'Not Relevant');
            assert.strictEqual(computeRelevance('unknown'), 'Not Relevant');
        });
    });

    describe('computeScore', () => {
        test('should compute correct score for strong matches', () => {
            // "Head of Engineering" is hiring manager (strong)
            const connection = { headline: 'Head of Engineering' };
            // 1 strong match: (1 * 3) + 0 - 0 = 3
            assert.strictEqual(computeScore(connection), 3);
        });

        test('should compute correct score for soft matches', () => {
            // "Software Engineer" is engineer (soft)
            const connection = { headline: 'Software Engineer' };
            // 1 soft match: (0 * 3) + 1 - 0 = 1
            assert.strictEqual(computeScore(connection), 1);
        });

        test('should compute correct score with negative matches', () => {
            // "Student" is negative
            const connection = { headline: 'Student Software Engineer' };
            // 1 soft match (Software Engineer), 1 negative match (Student): (0 * 3) + 1 - (1 * 2) = -1
            assert.strictEqual(computeScore(connection), -1);
        });

        test('should handle multiple matches of different types', () => {
            // "Engineering Manager and Software Developer"
            // Strong patterns: "engineering manager" -> 1 match
            // Soft patterns: "manager", "software developer", "developer" -> 3 matches
            const connection = { headline: 'Engineering Manager and Software Developer' };
            // 1 strong match * 3 + 3 soft matches - 0 = 6
            assert.strictEqual(computeScore(connection), 6);
        });
    });

    describe('priorityFor', () => {
        test('should return correct priority from PRIORITY_ORDER', () => {
            assert.strictEqual(priorityFor('recruiter'), 100);
            assert.strictEqual(priorityFor('hiring_manager'), 90);
            assert.strictEqual(priorityFor('generic'), 10);
        });

        test('should return 0 for unknown types', () => {
            assert.strictEqual(priorityFor('unknown'), 0);
        });
    });

    describe('annotateClassification', () => {
        test('should add classification properties to connection object', () => {
            const connection = { headline: 'Software Engineer', name: 'John Doe' };
            const annotated = annotateClassification(connection);

            assert.strictEqual(annotated.name, 'John Doe');
            assert.strictEqual(annotated.headline, 'Software Engineer');
            assert.strictEqual(annotated.contactType, 'engineer');
            assert.strictEqual(annotated.templateVariant, 'engineer');
            assert.strictEqual(annotated.relevanceLabel, 'Possible Match');
            assert.strictEqual(typeof annotated.matchScore, 'number');
            assert.strictEqual(annotated.priority, PRIORITY_ORDER.engineer);
        });
    });

    describe('cleanCompanyGuess', () => {
        test('should clean company string correctly', () => {
            // Note: outreachClassifier.js uses .replace(/\s{2,}/g, ' ').trim()
            assert.strictEqual(cleanCompanyGuess('Company • Division'), 'Company Division');
            assert.strictEqual(cleanCompanyGuess('Acme Corp | Tech'), 'Acme Corp Tech');
            assert.strictEqual(cleanCompanyGuess('StartUp (YC W21)'), 'StartUp YC W21');
        });

        test('should handle null, undefined, empty', () => {
            assert.strictEqual(cleanCompanyGuess(null), '');
            assert.strictEqual(cleanCompanyGuess(undefined), '');
            assert.strictEqual(cleanCompanyGuess(''), '');
        });
    });
});
