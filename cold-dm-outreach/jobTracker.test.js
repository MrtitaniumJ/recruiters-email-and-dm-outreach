const { test, describe } = require('node:test');
const assert = require('node:assert');
const { createJobTracker } = require('./jobTracker');

describe('JobTracker.determineStatus', () => {
    const tracker = createJobTracker({
        projectRoot: __dirname,
        baseDir: __dirname,
        env: { JOB_NOTION_DISABLED: '1' }
    });

    test('should return existing status if it is a PROTECTED_STATUSES', () => {
        ['Applied', 'Already Applied', 'Skipped'].forEach(status => {
            const result = tracker.determineStatus({}, { status });
            assert.strictEqual(result, status);
        });
    });

    test('should return job.application.status if present', () => {
        const result = tracker.determineStatus({ application: { status: 'Applied' } }, null);
        assert.strictEqual(result, 'Applied');
    });

    test('should return "Skipped" if job is not relevant', () => {
        const result = tracker.determineStatus({ isRelevant: false }, null);
        assert.strictEqual(result, 'Skipped');
    });

    test('should return existing status or "Review" if job is not new', () => {
        const result1 = tracker.determineStatus({ isRelevant: true, isNew: false }, { status: 'Applying' });
        assert.strictEqual(result1, 'Applying');

        const result2 = tracker.determineStatus({ isRelevant: true, isNew: false }, null);
        assert.strictEqual(result2, 'Review');
    });

    test('should return "Applying" if job should attempt apply', () => {
        const result = tracker.determineStatus({ isRelevant: true, isNew: true, shouldAttemptApply: true }, null);
        assert.strictEqual(result, 'Applying');
    });

    test('should return "Unsupported" if ATS is unsupported', () => {
        const result = tracker.determineStatus({
            isRelevant: true,
            isNew: true,
            applySupport: { reason: 'Unsupported ATS' }
        }, null);
        assert.strictEqual(result, 'Unsupported');
    });

    test('should return "Review" as fallback', () => {
        const result = tracker.determineStatus({ isRelevant: true, isNew: true }, null);
        assert.strictEqual(result, 'Review');
    });
});

describe('JobTracker.shouldUpdateExistingRecord', () => {
    const tracker = createJobTracker({
        projectRoot: __dirname,
        baseDir: __dirname,
        env: { JOB_NOTION_DISABLED: '1' }
    });

    const baseJob = {
        title: 'Software Engineer',
        company: 'Tech Corp',
        runDateIso: '2023-01-01',
        note: 'Some note'
    };

    const baseRecord = {
        title: 'Software Engineer',
        company: 'Tech Corp',
        status: 'Review',
        lastSeenAt: '2023-01-01',
        notes: 'Some note'
    };

    test('should return true if existingRecord is missing', () => {
        assert.strictEqual(tracker.shouldUpdateExistingRecord(null, baseJob, 'Review'), true);
    });

    test('should return false if all fields match', () => {
        assert.strictEqual(tracker.shouldUpdateExistingRecord(baseRecord, baseJob, 'Review'), false);
    });

    test('should return true if title differs', () => {
        assert.strictEqual(tracker.shouldUpdateExistingRecord(baseRecord, { ...baseJob, title: 'Senior Engineer' }, 'Review'), true);
    });

    test('should return true if company differs', () => {
        assert.strictEqual(tracker.shouldUpdateExistingRecord(baseRecord, { ...baseJob, company: 'Another Corp' }, 'Review'), true);
    });

    test('should return true if status differs', () => {
        assert.strictEqual(tracker.shouldUpdateExistingRecord(baseRecord, baseJob, 'Applying'), true);
    });

    test('should return true if lastSeenAt differs', () => {
        assert.strictEqual(tracker.shouldUpdateExistingRecord(baseRecord, { ...baseJob, runDateIso: '2023-01-02' }, 'Review'), true);
    });

    test('should return true if notes differ', () => {
        assert.strictEqual(tracker.shouldUpdateExistingRecord(baseRecord, { ...baseJob, note: 'New note' }, 'Review'), true);
    });

    test('should handle job.application.note precedence', () => {
        assert.strictEqual(tracker.shouldUpdateExistingRecord(
            baseRecord,
            { ...baseJob, application: { note: 'App note' } },
            'Review'
        ), true);

        assert.strictEqual(tracker.shouldUpdateExistingRecord(
            { ...baseRecord, notes: 'App note' },
            { ...baseJob, application: { note: 'App note' } },
            'Review'
        ), false);
    });
});

describe('createJobTracker', () => {
    test('should properly instantiate with JOB_NOTION_DISABLED set to true', () => {
        const tracker = createJobTracker({
            projectRoot: __dirname,
            baseDir: __dirname,
            env: { JOB_NOTION_DISABLED: 'true' }
        });

        assert.strictEqual(tracker.enabled, false);
        assert.strictEqual(tracker.token, '');
    });

    test('should properly instantiate with JOB_NOTION_DISABLED set to 1', () => {
        const tracker = createJobTracker({
            projectRoot: __dirname,
            baseDir: __dirname,
            env: { JOB_NOTION_DISABLED: '1' }
        });

        assert.strictEqual(tracker.enabled, false);
        assert.strictEqual(tracker.token, '');
    });

    test('should properly instantiate with a token if JOB_NOTION_DISABLED is false', () => {
        const tracker = createJobTracker({
            projectRoot: __dirname,
            baseDir: __dirname,
            env: { NOTION_TOKEN: 'test_token' }
        });

        assert.strictEqual(tracker.enabled, true);
        assert.strictEqual(tracker.token, 'test_token');
    });
});
