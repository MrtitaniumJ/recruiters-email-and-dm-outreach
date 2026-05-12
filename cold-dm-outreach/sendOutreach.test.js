const { test, describe, mock } = require('node:test');
const assert = require('node:assert');

const {
    isEligibleForInitial,
    isEligibleForFollowUp,
    buildQueue,
    sortByPriority,
    daysSince,
    nextStageFor,
    candidateFromRecord,
    buildConfig
} = require('./sendOutreach');

describe('daysSince', () => {
    test('should return Infinity for null/undefined/empty string', () => {
        assert.strictEqual(daysSince(null), Infinity);
        assert.strictEqual(daysSince(undefined), Infinity);
        assert.strictEqual(daysSince(''), Infinity);
    });

    test('should return Infinity for invalid dates', () => {
        assert.strictEqual(daysSince('not-a-date'), Infinity);
    });

    test('should calculate days correctly', () => {
        // Mock Date.now()
        const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
        const nowMs = Date.now();
        const twoDaysAgo = new Date(nowMs - TWO_DAYS_MS).toISOString();

        const result = daysSince(twoDaysAgo);
        assert.ok(result >= 1.9 && result <= 2.1, `Expected roughly 2, got ${result}`);
    });
});

describe('nextStageFor', () => {
    test('should return 1 when current stage is undefined', () => {
        assert.strictEqual(nextStageFor({}), 1);
    });

    test('should return 1 when current stage is 0', () => {
        assert.strictEqual(nextStageFor({ followUpStage: 0 }), 1);
    });

    test('should return 2 when current stage is 1', () => {
        assert.strictEqual(nextStageFor({ followUpStage: 1 }), 2);
    });

    test('should cap at 2 when current stage is 2', () => {
        assert.strictEqual(nextStageFor({ followUpStage: 2 }), 2);
    });
});


describe('isEligibleForInitial', () => {
    const allowed = ['recruiter', 'manager'];

    test('should return false if already replied', () => {
        assert.strictEqual(isEligibleForInitial({ replied: true, messageUrl: 'url', contactType: 'recruiter' }, allowed), false);
    });

    test('should return false if no URLs are available', () => {
        assert.strictEqual(isEligibleForInitial({ contactType: 'recruiter' }, allowed), false);
    });

    test('should return false if contactType is not allowed', () => {
        assert.strictEqual(isEligibleForInitial({ messageUrl: 'url', contactType: 'engineer' }, allowed), false);
    });

    test('should return false if status indicates already contacted/skipped', () => {
        const skipStatuses = ['Messaged', 'Followed Up', 'Replied', 'Skipped', 'Do Not Message', 'Already Messaged'];
        for (const status of skipStatuses) {
            assert.strictEqual(
                isEligibleForInitial({ messageUrl: 'url', contactType: 'recruiter', outreachStatus: status }, allowed),
                false
            );
        }
    });

    test('should return true for eligible records', () => {
        assert.strictEqual(isEligibleForInitial({ messageUrl: 'url', contactType: 'recruiter' }, allowed), true);
        assert.strictEqual(isEligibleForInitial({ profileUrl: 'url', contactType: 'manager', outreachStatus: 'Pending' }, allowed), true);
    });
});

describe('isEligibleForFollowUp', () => {
    const allowed = ['recruiter', 'manager'];
    const config = { followUpGapDays: 5, secondFollowUpGapDays: 7 };

    test('should return false if already replied', () => {
        assert.strictEqual(isEligibleForFollowUp({ replied: true, messageUrl: 'url', contactType: 'recruiter', outreachStatus: 'Messaged' }, allowed, config), false);
    });

    test('should return false if no URLs are available', () => {
        assert.strictEqual(isEligibleForFollowUp({ contactType: 'recruiter', outreachStatus: 'Messaged' }, allowed, config), false);
    });

    test('should return false if contactType is not allowed', () => {
        assert.strictEqual(isEligibleForFollowUp({ messageUrl: 'url', contactType: 'engineer', outreachStatus: 'Messaged' }, allowed, config), false);
    });

    test('should return false for unsupported status', () => {
        assert.strictEqual(isEligibleForFollowUp({ messageUrl: 'url', contactType: 'recruiter', outreachStatus: 'Pending' }, allowed, config), false);
        assert.strictEqual(isEligibleForFollowUp({ messageUrl: 'url', contactType: 'recruiter', outreachStatus: 'Skipped' }, allowed, config), false);
    });

    test('should handle Messaged -> stage 1 follow-up', () => {
        const sixDaysAgo = new Date(Date.now() - (6 * 24 * 60 * 60 * 1000)).toISOString();
        const fourDaysAgo = new Date(Date.now() - (4 * 24 * 60 * 60 * 1000)).toISOString();

        // Gap is met (6 days >= 5)
        assert.strictEqual(
            isEligibleForFollowUp({ messageUrl: 'url', contactType: 'recruiter', outreachStatus: 'Messaged', lastMessagedAt: sixDaysAgo }, allowed, config),
            true
        );
        // Gap is not met (4 days < 5)
        assert.strictEqual(
            isEligibleForFollowUp({ messageUrl: 'url', contactType: 'recruiter', outreachStatus: 'Messaged', lastMessagedAt: fourDaysAgo }, allowed, config),
            false
        );
    });

    test('should handle Followed Up -> stage 2 follow-up', () => {
        const eightDaysAgo = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)).toISOString();
        const sixDaysAgo = new Date(Date.now() - (6 * 24 * 60 * 60 * 1000)).toISOString();

        // Gap is met (8 days >= 7)
        assert.strictEqual(
            isEligibleForFollowUp({ messageUrl: 'url', contactType: 'recruiter', outreachStatus: 'Followed Up', followUpStage: 1, lastFollowUpAt: eightDaysAgo }, allowed, config),
            true
        );
        // Gap is not met (6 days < 7)
        assert.strictEqual(
            isEligibleForFollowUp({ messageUrl: 'url', contactType: 'recruiter', outreachStatus: 'Followed Up', followUpStage: 1, lastFollowUpAt: sixDaysAgo }, allowed, config),
            false
        );

        // Uses lastMessagedAt if lastFollowUpAt is missing
        assert.strictEqual(
            isEligibleForFollowUp({ messageUrl: 'url', contactType: 'recruiter', outreachStatus: 'Followed Up', followUpStage: 1, lastMessagedAt: eightDaysAgo }, allowed, config),
            true
        );
    });
});

describe('sortByPriority', () => {
    test('should sort by contact type priority', () => {
        // Mocking priorityFor values implicitly through contactType values based on the outreachClassifier logic:
        // recruiter/hiring_manager > generic
        // Assuming recruiter > generic
        const records = [
            { name: 'B', contactType: 'generic', matchScore: 10 },
            { name: 'A', contactType: 'recruiter', matchScore: 10 }
        ];

        records.sort(sortByPriority);

        assert.strictEqual(records[0].name, 'A');
        assert.strictEqual(records[1].name, 'B');
    });

    test('should sort by match score if priority is equal', () => {
        const records = [
            { name: 'B', contactType: 'recruiter', matchScore: 10 },
            { name: 'A', contactType: 'recruiter', matchScore: 20 }
        ];

        records.sort(sortByPriority);

        assert.strictEqual(records[0].name, 'A');
        assert.strictEqual(records[1].name, 'B');
    });

    test('should sort alphabetically by name if priority and score are equal', () => {
        const records = [
            { name: 'Charlie', contactType: 'recruiter', matchScore: 10 },
            { name: 'Alice', contactType: 'recruiter', matchScore: 10 },
            { name: 'Bob', contactType: 'recruiter', matchScore: 10 }
        ];

        records.sort(sortByPriority);

        assert.strictEqual(records[0].name, 'Alice');
        assert.strictEqual(records[1].name, 'Bob');
        assert.strictEqual(records[2].name, 'Charlie');
    });

    test('should handle missing names or scores gracefully', () => {
        const records = [
            { contactType: 'recruiter' }, // no score, no name
            { name: 'Alice', contactType: 'recruiter', matchScore: 0 }
        ];

        records.sort(sortByPriority);

        assert.strictEqual(records[0].name, undefined); // missing name acts as empty string, empty comes first? No, A comes before ''. Wait, empty string '' vs 'Alice'. 'Alice'.localeCompare('') -> 1 (Alice is greater). So '' comes first.
        assert.strictEqual(records[1].name, 'Alice');
    });
});
