const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RESUME_SEED_PROFILE_PATH = path.join(__dirname, 'resumeProfile.seed.json');

const RESUME_EXTRACTION_SCRIPT = [
    'import sys',
    'from PyPDF2 import PdfReader',
    'reader = PdfReader(sys.argv[1])',
    'print("\\n".join((page.extract_text() or "") for page in reader.pages))'
].join('\n');

const ROLE_SIGNAL_CATALOG = [
    { pattern: /software engineer/i, keywords: ['software engineer', 'sde', 'sde 1'] },
    { pattern: /software developer/i, keywords: ['software developer', 'developer'] },
    { pattern: /full stack/i, keywords: ['full stack', 'full-stack', 'full stack developer', 'full stack engineer'] },
    { pattern: /react(?:\.js)?|next\.js/i, keywords: ['frontend', 'frontend engineer', 'ui engineer'] },
    { pattern: /node(?:\.js)?|express(?:\.js)?|django|rest api/i, keywords: ['backend', 'backend engineer', 'application engineer'] },
    { pattern: /automation|chrome extensions|telegram bots|web scraping/i, keywords: ['automation', 'automation engineer'] },
    { pattern: /saas/i, keywords: ['saas'] }
];

const SKILL_SIGNAL_CATALOG = [
    { pattern: /react(?:\.js)?/i, keywords: ['react', 'react.js'] },
    { pattern: /next\.js/i, keywords: ['next.js'] },
    { pattern: /node(?:\.js)?/i, keywords: ['node', 'node.js'] },
    { pattern: /express(?:\.js)?/i, keywords: ['express', 'express.js'] },
    { pattern: /typescript/i, keywords: ['typescript'] },
    { pattern: /javascript/i, keywords: ['javascript'] },
    { pattern: /postgres(?:ql)?/i, keywords: ['postgresql'] },
    { pattern: /mongodb/i, keywords: ['mongodb'] },
    { pattern: /mysql/i, keywords: ['mysql'] },
    { pattern: /rest api/i, keywords: ['rest api'] },
    { pattern: /jwt/i, keywords: ['jwt'] },
    { pattern: /rbac/i, keywords: ['rbac'] },
    { pattern: /oauth/i, keywords: ['oauth'] },
    { pattern: /docker/i, keywords: ['docker'] },
    { pattern: /\baws\b|ec2|s3|lambda/i, keywords: ['aws', 'ec2', 's3', 'lambda'] },
    { pattern: /playwright/i, keywords: ['playwright'] },
    { pattern: /selenium/i, keywords: ['selenium'] },
    { pattern: /jest/i, keywords: ['jest'] },
    { pattern: /cypress/i, keywords: ['cypress'] },
    { pattern: /microservices/i, keywords: ['microservices'] },
    { pattern: /websockets/i, keywords: ['websockets'] },
    { pattern: /stripe/i, keywords: ['stripe'] },
    { pattern: /llm|generative ai|gemini ai/i, keywords: ['llm', 'generative ai'] }
];

const LOCATION_SIGNAL_CATALOG = [
    { pattern: /\bremote\b/i, keywords: ['remote'] },
    { pattern: /\bindia\b/i, keywords: ['india'] },
    { pattern: /new delhi/i, keywords: ['new delhi'] }
];

function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function mergeUniqueValues(...lists) {
    const seen = new Set();
    const merged = [];

    for (const list of lists) {
        if (!Array.isArray(list)) {
            continue;
        }

        for (const entry of list) {
            const normalized = normalizeText(entry);
            const key = normalized.toLowerCase();
            if (!normalized || seen.has(key)) {
                continue;
            }

            seen.add(key);
            merged.push(normalized);
        }
    }

    return merged;
}

function extractResumeText(resumePath) {
    if (!resumePath || !fs.existsSync(resumePath)) {
        return '';
    }

    const commandAttempts = [
        ['python', ['-c', RESUME_EXTRACTION_SCRIPT, resumePath]],
        ['py', ['-3', '-c', RESUME_EXTRACTION_SCRIPT, resumePath]]
    ];

    for (const [command, args] of commandAttempts) {
        try {
            const output = execFileSync(command, args, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            });
            const normalized = normalizeText(output);
            if (normalized) {
                return output;
            }
        } catch (error) {
            continue;
        }
    }

    return '';
}

function loadSeedProfile() {
    try {
        return JSON.parse(fs.readFileSync(RESUME_SEED_PROFILE_PATH, 'utf8'));
    } catch (error) {
        return {};
    }
}

function collectSignalKeywords(searchableText, catalog) {
    return mergeUniqueValues(
        ...catalog
            .filter((signal) => signal.pattern.test(searchableText))
            .map((signal) => signal.keywords)
    );
}

function firstMatch(text, pattern) {
    const match = String(text || '').match(pattern);
    return normalizeText(match?.[0] || '');
}

function buildResumeProfile({ resumePath, fallbackLocations = [] }) {
    const seedProfile = loadSeedProfile();
    const rawResumeText = extractResumeText(resumePath);
    const normalizedResumeText = normalizeText(rawResumeText);
    const searchableText = normalizedResumeText.toLowerCase();

    const roleKeywords = mergeUniqueValues(
        collectSignalKeywords(searchableText, ROLE_SIGNAL_CATALOG),
        seedProfile.roleKeywords
    );
    const skillKeywords = mergeUniqueValues(
        collectSignalKeywords(searchableText, SKILL_SIGNAL_CATALOG),
        seedProfile.skillKeywords
    );
    const locationKeywords = mergeUniqueValues(
        fallbackLocations,
        collectSignalKeywords(searchableText, LOCATION_SIGNAL_CATALOG),
        seedProfile.locationKeywords
    );

    const email = firstMatch(rawResumeText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || normalizeText(seedProfile.email);
    const phone = firstMatch(rawResumeText, /(?:\+\d{1,3}\s*)?(?:\d[\s-]*){10,14}/) || normalizeText(seedProfile.phone);
    const linkedinUrl = firstMatch(rawResumeText, /https?:\/\/(?:www\.)?linkedin\.com\/[^\s|)]+/i) || normalizeText(seedProfile.linkedinUrl);
    const githubUrl = firstMatch(rawResumeText, /https?:\/\/(?:www\.)?github\.com\/[^\s|)]+/i) || normalizeText(seedProfile.githubUrl);
    const portfolioUrl = firstMatch(
        rawResumeText,
        /https?:\/\/(?!www\.linkedin\.com)(?!github\.com)(?!www\.github\.com)[^\s|)]+/i
    ) || normalizeText(seedProfile.portfolioUrl);

    return {
        available: Boolean(normalizedResumeText || roleKeywords.length || skillKeywords.length),
        sourcePath: resumePath || normalizeText(seedProfile.sourcePath),
        roleKeywords,
        skillKeywords,
        locationKeywords,
        email,
        phone,
        linkedinUrl,
        githubUrl,
        portfolioUrl
    };
}

module.exports = {
    buildResumeProfile
};
