const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildMessageFromTemplate } = require('./campaignAutomation');

const mockConfig = {
    templates: {
        recruiter: "Hi {name},\n\nI noticed your work in recruiting at {company}. I'm a Full Stack Developer working with React, Next.js, Node.js, and TypeScript, and I'm currently exploring software engineering opportunities.\n\n{company_signal}\nI'd love to share my background and learn if there are any roles on your team that could be a fit.\n\nBest,\nJatin",
        talent_acquisition: "Hi {name},\n\nI came across your talent acquisition work at {company}. I'm a Full Stack Developer with hands-on experience in React, Next.js, Node.js, TypeScript, and PostgreSQL, and I'm actively exploring new SDE opportunities.\n\n{company_signal}\nIf you're hiring for engineering roles, I'd really appreciate the chance to connect.\n\nBest,\nJatin",
        hr: "Hi {name},\n\nI hope you're doing well. I saw that you're part of the HR / people team at {company}. I'm a Full Stack Developer with experience building production systems using React, Next.js, Node.js, TypeScript, and PostgreSQL.\n\n{company_signal}\nIf there are any software engineering openings, I'd be grateful to be considered.\n\nBest,\nJatin",
        hiring_manager: "Hi {name},\n\nI noticed your background at {company} and wanted to reach out directly. I'm a Full Stack Developer with experience shipping production features across React, Next.js, Node.js, TypeScript, and PostgreSQL.\n\n{company_signal}\nIf your team is hiring for software engineering roles, I'd love the chance to introduce myself.\n\nBest,\nJatin",
        generic: "Hi {name},\n\nI'm Jatin, a Full Stack Developer currently exploring software engineering opportunities. I came across your profile at {company} and wanted to reach out.\n\n{company_signal}\nIf there are any relevant roles or someone on your team I should speak with, I'd really appreciate it.\n\nBest,\nJatin"
    }
};

describe('buildMessageFromTemplate', () => {
    test('should build message for recruiter with open roles signal', () => {
        const connection = {
            firstName: 'Alice',
            fullName: 'Alice Smith',
            companyName: 'TechCorp',
            templateVariant: 'recruiter',
            jobMatchStatus: 'Open Roles Found',
            jobMatchKeywords: ['react', 'node'],
            contactType: 'recruiter'
        };

        const result = buildMessageFromTemplate(connection, mockConfig);

        assert.ok(result.includes('Hi Alice,'));
        assert.ok(result.includes('recruiting at TechCorp'));
        assert.ok(result.includes('roles related to react, node'));
    });

    test('should build message with company name signal when no open roles', () => {
        const connection = {
            firstName: 'Bob',
            fullName: 'Bob Johnson',
            companyName: 'InnoCorp',
            templateVariant: 'hiring_manager',
            jobMatchStatus: 'No Open Roles',
            jobMatchKeywords: [],
            contactType: 'hiring_manager'
        };

        const result = buildMessageFromTemplate(connection, mockConfig);

        assert.ok(result.includes('Hi Bob,'));
        assert.ok(result.includes('background at InnoCorp'));
        assert.ok(result.includes('software engineering roles at InnoCorp'));
    });

    test('should fall back to generic template if variant is unknown', () => {
        const connection = {
            firstName: 'Charlie',
            fullName: 'Charlie Davis',
            companyName: 'DataSys',
            templateVariant: 'unknown_variant',
            jobMatchStatus: 'No Open Roles',
            jobMatchKeywords: [],
            contactType: 'unknown'
        };

        const result = buildMessageFromTemplate(connection, mockConfig);

        assert.ok(result.includes("I'm Jatin"));
        assert.ok(result.includes('profile at DataSys'));
    });

    test('should fall back to generic template if variant is missing', () => {
        const connection = {
            firstName: 'Diana',
            fullName: 'Diana Prince',
            companyName: 'WonderWorks',
            jobMatchStatus: 'No Open Roles',
            jobMatchKeywords: [],
            contactType: 'unknown'
        };

        const result = buildMessageFromTemplate(connection, mockConfig);

        assert.ok(result.includes("I'm Jatin"));
        assert.ok(result.includes('profile at WonderWorks'));
    });

    test('should handle missing companyName with fallback', () => {
        const connection = {
            firstName: 'Eve',
            fullName: 'Eve Adams',
            templateVariant: 'hr',
            jobMatchStatus: 'No Open Roles',
            jobMatchKeywords: [],
            contactType: 'hr'
        };

        const result = buildMessageFromTemplate(connection, mockConfig);

        assert.ok(result.includes('team at your company'));
        assert.ok(result.includes('engineering openings,')); // Generic signal when no company
    });

    test('should fallback to first name from fullName if firstName is missing', () => {
        const connection = {
            fullName: 'Frank Sinatra',
            companyName: 'MusicInc',
            templateVariant: 'generic',
            jobMatchStatus: 'No Open Roles',
            jobMatchKeywords: [],
            contactType: 'other'
        };

        const result = buildMessageFromTemplate(connection, mockConfig);

        assert.ok(result.includes('Hi Frank,'));
    });
});
