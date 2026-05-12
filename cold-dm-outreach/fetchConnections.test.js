const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
    parseBoolean,
    parseConnectedOnDate,
    detectCompanyName,
    parseFetchMode
} = require('./fetchConnections');

describe('parseBoolean', () => {
    test('should return true for truthy string values', () => {
        assert.strictEqual(parseBoolean('true', false), true);
        assert.strictEqual(parseBoolean('1', false), true);
        assert.strictEqual(parseBoolean('yes', false), true);
        assert.strictEqual(parseBoolean('y', false), true);
        assert.strictEqual(parseBoolean('  TrUe  ', false), true);
    });

    test('should return false for falsy string values', () => {
        assert.strictEqual(parseBoolean('false', true), false);
        assert.strictEqual(parseBoolean('0', true), false);
        assert.strictEqual(parseBoolean('no', true), false);
        assert.strictEqual(parseBoolean('n', true), false);
        assert.strictEqual(parseBoolean('  FaLsE  ', true), false);
    });

    test('should return fallback for undefined', () => {
        assert.strictEqual(parseBoolean(undefined, true), true);
        assert.strictEqual(parseBoolean(undefined, false), false);
    });

    test('should return fallback for unrecognized values', () => {
        assert.strictEqual(parseBoolean('maybe', true), true);
        assert.strictEqual(parseBoolean('2', false), false);
        assert.strictEqual(parseBoolean(null, true), true);
    });
});

describe('parseConnectedOnDate', () => {
    test('should parse "connected on [Date]" format correctly', () => {
        assert.strictEqual(parseConnectedOnDate('connected on 2023-10-15'), '2023-10-15');
        assert.strictEqual(parseConnectedOnDate('Connected On October 15, 2023'), '2023-10-15');
    });

    test('should parse normal date strings', () => {
        assert.strictEqual(parseConnectedOnDate('2024-01-01'), '2024-01-01');
        assert.strictEqual(parseConnectedOnDate('Jan 1, 2024'), '2024-01-01');
    });

    test('should handle invalid or empty inputs', () => {
        assert.strictEqual(parseConnectedOnDate(''), '');
        assert.strictEqual(parseConnectedOnDate(null), '');
        assert.strictEqual(parseConnectedOnDate(undefined), '');
        assert.strictEqual(parseConnectedOnDate('not a date'), '');
    });
});

describe('detectCompanyName', () => {
    test('should extract company from "@ Company"', () => {
        assert.strictEqual(detectCompanyName({ headline: 'Software Engineer @ TechCorp' }), 'TechCorp');
        assert.strictEqual(detectCompanyName({ headline: 'CEO @ Startup Inc.' }), 'Startup Inc.');
    });

    test('should extract company from "at Company"', () => {
        assert.strictEqual(detectCompanyName({ headline: 'Developer at BigCompany' }), 'BigCompany');
        assert.strictEqual(detectCompanyName({ headline: 'Manager AT SomeBiz' }), 'SomeBiz');
    });

    test('should extract company from "- Company"', () => {
        assert.strictEqual(detectCompanyName({ headline: 'Designer - CreativeStudio' }), 'CreativeStudio');
    });

    test('should combine headline and additionalDetails', () => {
        assert.strictEqual(
            detectCompanyName({ headline: 'Engineer', additionalDetails: 'at SpecialCorp' }),
            'SpecialCorp'
        );
    });

    test('should clean company guess (remove trailing commas, etc)', () => {
         assert.strictEqual(detectCompanyName({ headline: 'Engineer at SpecialCorp, Inc.' }), 'SpecialCorp');
         assert.strictEqual(detectCompanyName({ headline: 'Engineer at SpecialCorp | Something Else' }), 'SpecialCorp');
    });

    test('should return empty string if no pattern matches', () => {
        assert.strictEqual(detectCompanyName({ headline: 'Just a regular person' }), '');
        assert.strictEqual(detectCompanyName({}), '');
    });
});

describe('parseFetchMode', () => {
    test('should return "full" if input is full', () => {
        assert.strictEqual(parseFetchMode('full'), 'full');
        assert.strictEqual(parseFetchMode('  FULL  '), 'full');
    });

    test('should default to "latest" for other inputs', () => {
        assert.strictEqual(parseFetchMode('latest'), 'latest');
        assert.strictEqual(parseFetchMode('something else'), 'latest');
        assert.strictEqual(parseFetchMode(''), 'latest');
        assert.strictEqual(parseFetchMode(undefined), 'latest');
        assert.strictEqual(parseFetchMode(null), 'latest');
    });
});
