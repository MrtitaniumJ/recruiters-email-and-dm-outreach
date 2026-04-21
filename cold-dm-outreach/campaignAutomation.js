const fs = require('fs');
const path = require('path');

const CAMPAIGN_CONFIG_PATH = path.join(__dirname, 'campaign.config.json');
const DIGEST_MARKDOWN_PATH = path.join(__dirname, 'latest_run_digest.md');
const DIGEST_JSON_PATH = path.join(__dirname, 'latest_run_digest.json');

const DEFAULT_ROLE_KEYWORDS = [
    'software engineer',
    'software developer',
    'frontend',
    'front-end',
    'backend',
    'back-end',
    'full stack',
    'full-stack',
    'react',
    'next.js',
    'node',
    'typescript'
];

const DEFAULT_TEMPLATES = {
    recruiter: "Hi {name},\n\nI noticed your work in recruiting at {company}. I'm a Full Stack Developer working with React, Next.js, Node.js, and TypeScript, and I'm currently exploring software engineering opportunities.\n\n{company_signal}\nI'd love to share my background and learn if there are any roles on your team that could be a fit.\n\nBest,\nJatin",
    talent_acquisition: "Hi {name},\n\nI came across your talent acquisition work at {company}. I'm a Full Stack Developer with hands-on experience in React, Next.js, Node.js, TypeScript, and PostgreSQL, and I'm actively exploring new SDE opportunities.\n\n{company_signal}\nIf you're hiring for engineering roles, I'd really appreciate the chance to connect.\n\nBest,\nJatin",
    hr: "Hi {name},\n\nI hope you're doing well. I saw that you're part of the HR / people team at {company}. I'm a Full Stack Developer with experience building production systems using React, Next.js, Node.js, TypeScript, and PostgreSQL.\n\n{company_signal}\nIf there are any software engineering openings, I'd be grateful to be considered.\n\nBest,\nJatin",
    hiring_manager: "Hi {name},\n\nI noticed your background at {company} and wanted to reach out directly. I'm a Full Stack Developer with experience shipping production features across React, Next.js, Node.js, TypeScript, and PostgreSQL.\n\n{company_signal}\nIf your team is hiring for software engineering roles, I'd love the chance to introduce myself.\n\nBest,\nJatin",
    generic: "Hi {name},\n\nI'm Jatin, a Full Stack Developer currently exploring software engineering opportunities. I came across your profile at {company} and wanted to reach out.\n\n{company_signal}\nIf there are any relevant roles or someone on your team I should speak with, I'd really appreciate it.\n\nBest,\nJatin"
};

function truncate(text, maxLength = 1000) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 3)}...`;
}

function readJsonFile(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8').trim();
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function writeJsonFile(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeCompanyName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function loadCampaignConfig() {
    const fallback = {
        jobMatcher: {
            enabled: true,
            requestTimeoutMs: 15000,
            defaultKeywords: DEFAULT_ROLE_KEYWORDS,
            companies: []
        },
        digest: {
            writeMarkdown: true,
            writeJson: true,
            createNotionPage: true
        },
        templates: DEFAULT_TEMPLATES
    };

    const loaded = readJsonFile(CAMPAIGN_CONFIG_PATH, fallback);
    return {
        ...fallback,
        ...loaded,
        jobMatcher: {
            ...fallback.jobMatcher,
            ...(loaded.jobMatcher || {}),
            defaultKeywords: Array.isArray(loaded?.jobMatcher?.defaultKeywords) && loaded.jobMatcher.defaultKeywords.length > 0
                ? loaded.jobMatcher.defaultKeywords
                : fallback.jobMatcher.defaultKeywords,
            companies: Array.isArray(loaded?.jobMatcher?.companies) ? loaded.jobMatcher.companies : fallback.jobMatcher.companies
        },
        digest: {
            ...fallback.digest,
            ...(loaded.digest || {})
        },
        templates: {
            ...fallback.templates,
            ...(loaded.templates || {})
        }
    };
}

function detectCompanyName(connection) {
    const headline = `${connection.headline || ''} ${connection.additionalDetails || ''}`.replace(/\s+/g, ' ').trim();
    const patterns = [
        /@([A-Za-z0-9&().,'\- ]{2,80})/,
        /\bat\s+([A-Za-z0-9&().,'\- ]{2,80})/i,
        /-\s*([A-Za-z0-9&().,'\- ]{2,80})/
    ];

    for (const pattern of patterns) {
        const match = headline.match(pattern);
        if (!match) {
            continue;
        }

        let company = match[1]
            .split('|')[0]
            .split('||')[0]
            .split(',')[0]
            .trim();

        company = company.replace(/\s{2,}/g, ' ').trim();
        if (company && company.length >= 2) {
            return company;
        }
    }

    return '';
}

function classifyContactType(connection) {
    const text = `${connection.headline || ''} ${connection.additionalDetails || ''}`.toLowerCase();

    if (/recruit(er|ment|ing)|talent acquisition|talent partner|talent scout|talent sourcer|\bta\b/.test(text)) {
        return 'talent_acquisition';
    }

    if (/human resources|\bhr\b|people ops|people operations|people consultant|people partner|people & culture/.test(text)) {
        return 'hr';
    }

    if (/hiring manager|engineering manager|head of engineering|director|vp engineering|cto|founder/.test(text)) {
        return 'hiring_manager';
    }

    if (/recruit/.test(text)) {
        return 'recruiter';
    }

    return 'generic';
}

function buildCompanyConfigIndex(config) {
    const companyIndex = new Map();
    for (const companyConfig of config.jobMatcher.companies || []) {
        if (!companyConfig?.company || !companyConfig?.careersUrl) {
            continue;
        }

        companyIndex.set(normalizeCompanyName(companyConfig.company), companyConfig);
    }

    return companyIndex;
}

async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
            }
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function runJobMatcher(connections, config) {
    const companyIndex = buildCompanyConfigIndex(config);
    const companiesToCheck = new Map();

    for (const connection of connections) {
        const companyKey = normalizeCompanyName(connection.companyName);
        if (!companyKey || !companyIndex.has(companyKey) || companiesToCheck.has(companyKey)) {
            continue;
        }

        companiesToCheck.set(companyKey, companyIndex.get(companyKey));
    }

    const results = new Map();
    if (!config.jobMatcher.enabled || companiesToCheck.size === 0) {
        return results;
    }

    console.log(`🔎 Job matcher: checking ${companiesToCheck.size} configured company career pages...`);

    // ⚡ Bolt: Execute career page checks concurrently to minimize total network latency.
    await Promise.all(Array.from(companiesToCheck.entries()).map(async ([companyKey, companyConfig]) => {
        const keywords = Array.isArray(companyConfig.keywords) && companyConfig.keywords.length > 0
            ? companyConfig.keywords
            : config.jobMatcher.defaultKeywords;

        try {
            const response = await fetchWithTimeout(companyConfig.careersUrl, Number(config.jobMatcher.requestTimeoutMs || 15000));
            const html = await response.text();
            const lowerHtml = html.toLowerCase();
            const matchedKeywords = keywords.filter((keyword) => lowerHtml.includes(String(keyword).toLowerCase()));

            results.set(companyKey, {
                company: companyConfig.company,
                careersUrl: companyConfig.careersUrl,
                status: matchedKeywords.length > 0 ? 'Open Roles Found' : 'No Matching Roles Found',
                matchedKeywords,
                checkedAt: new Date().toISOString(),
                notes: matchedKeywords.length > 0
                    ? `Matched keywords: ${matchedKeywords.join(', ')}`
                    : 'Configured careers page did not match the target role keywords in this run.'
            });

            console.log(`   • ${companyConfig.company}: ${matchedKeywords.length > 0 ? 'open-role signals found' : 'no matching role keywords'}`);
        } catch (error) {
            results.set(companyKey, {
                company: companyConfig.company,
                careersUrl: companyConfig.careersUrl,
                status: 'Check Failed',
                matchedKeywords: [],
                checkedAt: new Date().toISOString(),
                notes: `Careers page check failed: ${truncate(error.message, 220)}`
            });

            console.log(`   • ${companyConfig.company}: job check failed`);
        }
    }));

    return results;
}

function enrichConnectionsWithCampaignData(connections, config, jobMatches) {
    return connections.map((connection) => {
        const companyName = detectCompanyName(connection);
        const companyKey = normalizeCompanyName(companyName);
        const contactType = classifyContactType(connection);
        const templateVariant = DEFAULT_TEMPLATES[contactType] ? contactType : 'generic';
        const jobMatch = companyKey ? jobMatches.get(companyKey) : null;

        return {
            ...connection,
            companyName,
            companyKey,
            contactType,
            templateVariant,
            careersUrl: jobMatch?.careersUrl || '',
            jobMatchStatus: jobMatch?.status || (companyName ? 'Not Configured' : 'Unknown Company'),
            jobMatchKeywords: jobMatch?.matchedKeywords || [],
            jobMatchNotes: jobMatch?.notes || (companyName ? 'No configured careers page for this company yet.' : 'Company could not be extracted from the headline.'),
            lastJobCheckAt: jobMatch?.checkedAt || ''
        };
    });
}

function formatCompanySignal(connection) {
    if (connection.jobMatchStatus === 'Open Roles Found' && connection.jobMatchKeywords.length > 0) {
        return `I also noticed your careers page currently shows signals for roles related to ${connection.jobMatchKeywords.join(', ')}. `;
    }

    if (connection.companyName) {
        return `If your team is hiring for software engineering roles at ${connection.companyName}, `;
    }

    return 'If there are any relevant engineering openings, ';
}

function buildMessageFromTemplate(connection, config) {
    const template = config.templates[connection.templateVariant] || config.templates.generic || DEFAULT_TEMPLATES.generic;
    const company = connection.companyName || 'your company';
    const companySignal = formatCompanySignal(connection);

    return template
        .replace(/{name}/g, connection.firstName || connection.fullName.split(' ')[0])
        .replace(/{company}/g, company)
        .replace(/{company_signal}/g, companySignal)
        .replace(/{contact_type}/g, connection.contactType.replace(/_/g, ' '));
}

function buildDigestData({
    runStartedAt,
    config,
    totalConnections,
    syncedConnections,
    relevantConnections,
    candidates,
    sentProfiles,
    failedProfiles,
    skippedProfiles,
    connections,
    jobMatches
}) {
    const checkedCompanies = Array.from(jobMatches.values());
    const companiesWithOpenSignals = checkedCompanies.filter((item) => item.status === 'Open Roles Found');

    return {
        generatedAt: new Date().toISOString(),
        runStartedAt,
        totalConnections,
        syncedConnections,
        relevantConnections,
        candidateCount: candidates.length,
        sentCount: sentProfiles.length,
        failedCount: failedProfiles.length,
        skippedCount: skippedProfiles.length,
        checkedCompanies,
        companiesWithOpenSignals,
        topCandidates: candidates.slice(0, 15).map((candidate) => ({
            fullName: candidate.fullName,
            companyName: candidate.companyName,
            headline: candidate.headline,
            contactType: candidate.contactType,
            templateVariant: candidate.templateVariant,
            jobMatchStatus: candidate.jobMatchStatus,
            jobMatchKeywords: candidate.jobMatchKeywords
        })),
        sentProfiles,
        failedProfiles,
        skippedProfiles,
        configSnapshot: {
            jobMatcherEnabled: config.jobMatcher.enabled,
            configuredCompanies: (config.jobMatcher.companies || []).map((company) => company.company),
            digestToNotion: config.digest.createNotionPage
        },
        scannedCompanies: Array.from(new Set(connections.map((connection) => connection.companyName).filter(Boolean))).slice(0, 60)
    };
}

function buildDigestMarkdown(digest) {
    const lines = [];

    lines.push('# LinkedIn Outreach Digest');
    lines.push('');
    lines.push(`Generated: ${digest.generatedAt}`);
    lines.push(`Run Started: ${digest.runStartedAt}`);
    lines.push('');
    lines.push('## Run Summary');
    lines.push(`- Total LinkedIn connections count: ${digest.totalConnections || 'Unknown'}`);
    lines.push(`- Connections synced in this run: ${digest.syncedConnections}`);
    lines.push(`- Relevant recruiter / hiring matches in this run: ${digest.relevantConnections}`);
    lines.push(`- Candidates queued: ${digest.candidateCount}`);
    lines.push(`- Messages sent: ${digest.sentCount}`);
    lines.push(`- Failed sends: ${digest.failedCount}`);
    lines.push(`- Skipped contacts: ${digest.skippedCount}`);
    lines.push('');
    lines.push('## Company Opening Checks');

    if (digest.checkedCompanies.length === 0) {
        lines.push('- No configured company career pages were checked in this run.');
    } else {
        for (const company of digest.checkedCompanies) {
            lines.push(`- ${company.company}: ${company.status}${company.matchedKeywords.length > 0 ? ` (${company.matchedKeywords.join(', ')})` : ''}`);
        }
    }

    lines.push('');
    lines.push('## Top Candidates');
    if (digest.topCandidates.length === 0) {
        lines.push('- No candidates were queued in this run.');
    } else {
        for (const candidate of digest.topCandidates) {
            lines.push(`- ${candidate.fullName} | ${candidate.companyName || 'Unknown Company'} | ${candidate.contactType} | template=${candidate.templateVariant} | ${candidate.jobMatchStatus}`);
        }
    }

    if (digest.sentProfiles.length > 0) {
        lines.push('');
        lines.push('## Sent Profiles');
        for (const name of digest.sentProfiles) {
            lines.push(`- ${name}`);
        }
    }

    if (digest.failedProfiles.length > 0) {
        lines.push('');
        lines.push('## Failed Profiles');
        for (const entry of digest.failedProfiles) {
            lines.push(`- ${entry.fullName}: ${entry.reason}`);
        }
    }

    return `${lines.join('\n')}\n`;
}

function writeDigestFiles(digest, config) {
    const markdown = buildDigestMarkdown(digest);

    if (config.digest.writeMarkdown) {
        fs.writeFileSync(DIGEST_MARKDOWN_PATH, markdown);
    }

    if (config.digest.writeJson) {
        writeJsonFile(DIGEST_JSON_PATH, digest);
    }

    return { markdown, markdownPath: DIGEST_MARKDOWN_PATH, jsonPath: DIGEST_JSON_PATH };
}

module.exports = {
    CAMPAIGN_CONFIG_PATH,
    DIGEST_MARKDOWN_PATH,
    DIGEST_JSON_PATH,
    loadCampaignConfig,
    runJobMatcher,
    enrichConnectionsWithCampaignData,
    buildMessageFromTemplate,
    buildDigestData,
    buildDigestMarkdown,
    writeDigestFiles
};
