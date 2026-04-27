const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const { loadCampaignConfig } = require('./campaignAutomation');
const { createJobTracker } = require('./jobTracker');
const { buildResumeProfile } = require('./resumeProfile');

require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: false });

const JOB_CONFIG_PATH = path.join(__dirname, 'jobApplication.config.json');
const JOB_STATE_PATH = path.join(__dirname, 'job_application_state.json');
const JOB_DIGEST_MARKDOWN_PATH = path.join(__dirname, 'job_application_digest.md');
const JOB_DIGEST_JSON_PATH = path.join(__dirname, 'job_application_digest.json');
const ROLE_LINK_HINTS = [
    '/job',
    '/jobs',
    '/careers',
    '/openings',
    '/positions',
    'greenhouse.io',
    'lever.co',
    'workdayjobs.com',
    'myworkdayjobs.com',
    'ashbyhq.com',
    'smartrecruiters.com'
];
const POSITIVE_SIGNAL_PATTERNS = [
    'software engineer',
    'software developer',
    'frontend',
    'backend',
    'full stack',
    'react',
    'next.js',
    'node',
    'typescript',
    'web engineer',
    'application engineer'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseBoolean(value, fallback) {
    if (value === undefined) {
        return fallback;
    }

    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
        return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
        return false;
    }

    return fallback;
}

function truncate(text, maxLength = 1000) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 3)}...`;
}

function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(text) {
    return normalizeText(text).toLowerCase();
}

function normalizeArray(values) {
    return Array.isArray(values)
        ? values.map((value) => normalizeText(value)).filter(Boolean)
        : [];
}

function mergeUniqueValues(...lists) {
    const seen = new Set();
    const merged = [];

    for (const list of lists) {
        if (!Array.isArray(list)) {
            continue;
        }

        for (const value of list) {
            const normalized = normalizeText(value);
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

function detectAts(url) {
    const normalized = String(url || '').toLowerCase();

    if (normalized.includes('greenhouse.io')) {
        return 'greenhouse';
    }
    if (normalized.includes('lever.co')) {
        return 'lever';
    }
    if (normalized.includes('myworkdayjobs.com') || normalized.includes('workdayjobs.com')) {
        return 'workday';
    }
    if (normalized.includes('ashbyhq.com')) {
        return 'ashby';
    }
    if (normalized.includes('smartrecruiters.com')) {
        return 'smartrecruiters';
    }
    if (normalized) {
        return 'generic';
    }

    return 'unknown';
}

function buildJobKey(company, title, url) {
    return `${normalizeKey(company)}::${normalizeKey(title)}::${normalizeKey(url)}`;
}

function resolveMaybeRelativePath(baseDir, maybePath) {
    if (!maybePath) {
        return '';
    }

    if (path.isAbsolute(maybePath)) {
        return maybePath;
    }

    return path.resolve(baseDir, maybePath);
}

function loadJobAutomationConfig() {
    const campaignConfig = loadCampaignConfig();
    const fallback = {
        automation: {
            maxJobsPerRun: 12,
            onlyApplyToNewJobs: true,
            autoApplyEnabled: false,
            applicationMode: 'guarded_auto_apply',
            manualCaptchaHandoff: false,
            captchaWaitMs: 180000,
            supportedAtsForAutoApply: ['greenhouse', 'lever', 'smartrecruiters'],
            navigationTimeoutMs: 30000,
            careersPageWaitMs: 5000,
            headless: false
        },
        matching: {
            keywords: campaignConfig.jobMatcher.defaultKeywords || POSITIVE_SIGNAL_PATTERNS,
            negativeKeywords: ['intern', 'internship', 'principal', 'staff', 'marketing', 'sales', 'designer'],
            targetLocations: ['india', 'remote']
        },
        applicant: {
            fullName: process.env.APPLICANT_FULL_NAME || 'Jatin Sharma',
            email: process.env.APPLICANT_EMAIL || process.env.EMAIL_USER || '',
            phone: process.env.APPLICANT_PHONE || '',
            currentLocation: process.env.APPLICANT_LOCATION || 'India',
            linkedinUrl: process.env.APPLICANT_LINKEDIN_URL || '',
            githubUrl: process.env.APPLICANT_GITHUB_URL || '',
            portfolioUrl: process.env.APPLICANT_PORTFOLIO_URL || '',
            websiteUrl: process.env.APPLICANT_WEBSITE_URL || '',
            yearsOfExperience: process.env.APPLICANT_YOE || '',
            workAuthorization: process.env.APPLICANT_WORK_AUTHORIZATION || '',
            sponsorshipRequired: process.env.APPLICANT_SPONSORSHIP_REQUIRED || 'No',
            resumePath: process.env.APPLICANT_RESUME_PATH || path.resolve(__dirname, '..', 'Jatin_Sharma_SDE_FS.pdf')
        },
        digest: {
            writeMarkdown: true,
            writeJson: true,
            createNotionPage: true
        },
        companies: (campaignConfig.jobMatcher.companies || []).map((company) => ({
            company: company.company,
            careersUrl: company.careersUrl
        }))
    };

    const loaded = readJsonFile(JOB_CONFIG_PATH, fallback);
    const merged = {
        ...fallback,
        ...loaded,
        automation: {
            ...fallback.automation,
            ...(loaded.automation || {})
        },
        matching: {
            ...fallback.matching,
            ...(loaded.matching || {}),
            keywords: normalizeArray(loaded?.matching?.keywords || fallback.matching.keywords),
            negativeKeywords: normalizeArray(loaded?.matching?.negativeKeywords || fallback.matching.negativeKeywords),
            targetLocations: normalizeArray(loaded?.matching?.targetLocations || fallback.matching.targetLocations)
        },
        applicant: {
            ...fallback.applicant,
            ...(loaded.applicant || {})
        },
        digest: {
            ...fallback.digest,
            ...(loaded.digest || {})
        },
        companies: Array.isArray(loaded?.companies) && loaded.companies.length > 0
            ? loaded.companies
            : fallback.companies
    };

    merged.automation.autoApplyEnabled = parseBoolean(
        process.env.JOB_AUTO_APPLY_ENABLED,
        parseBoolean(merged.automation.autoApplyEnabled, false)
    );
    merged.automation.headless = parseBoolean(
        process.env.JOB_AUTOMATION_HEADLESS,
        parseBoolean(merged.automation.headless, false)
    );
    merged.automation.onlyApplyToNewJobs = parseBoolean(
        process.env.JOB_AUTOMATION_ONLY_NEW,
        parseBoolean(merged.automation.onlyApplyToNewJobs, true)
    );
    merged.automation.manualCaptchaHandoff = parseBoolean(
        process.env.JOB_MANUAL_CAPTCHA_HANDOFF,
        parseBoolean(merged.automation.manualCaptchaHandoff, false)
    );
    merged.automation.captchaWaitMs = Number(process.env.JOB_CAPTCHA_WAIT_MS || merged.automation.captchaWaitMs || 180000);
    merged.applicant.resumePath = resolveMaybeRelativePath(__dirname, merged.applicant.resumePath);
    merged.resumeProfile = buildResumeProfile({
        resumePath: merged.applicant.resumePath,
        fallbackLocations: merged.matching.targetLocations
    });

    if (!merged.applicant.email && merged.resumeProfile.email) {
        merged.applicant.email = merged.resumeProfile.email;
    }

    if (!merged.applicant.phone && merged.resumeProfile.phone) {
        merged.applicant.phone = merged.resumeProfile.phone;
    }

    if (!merged.applicant.linkedinUrl && merged.resumeProfile.linkedinUrl) {
        merged.applicant.linkedinUrl = merged.resumeProfile.linkedinUrl;
    }

    if (!merged.applicant.githubUrl && merged.resumeProfile.githubUrl) {
        merged.applicant.githubUrl = merged.resumeProfile.githubUrl;
    }

    if (!merged.applicant.portfolioUrl && !merged.applicant.websiteUrl && merged.resumeProfile.portfolioUrl) {
        merged.applicant.portfolioUrl = merged.resumeProfile.portfolioUrl;
    }

    return merged;
}

function loadState() {
    return readJsonFile(JOB_STATE_PATH, {
        lastRunAt: '',
        seenJobs: {},
        appliedJobKeys: []
    });
}

function writeState(state) {
    writeJsonFile(JOB_STATE_PATH, state);
}

async function launchBrowser(headlessMode) {
    return puppeteer.launch({
        headless: headlessMode ? 'new' : false,
        args: [
            '--disable-extensions',
            '--disable-plugins',
            '--disable-sync',
            '--disable-blink-features=AutomationControlled',
            '--no-first-run'
        ]
    });
}

async function discoverJobsForCompany(page, companyConfig, config) {
    const careersUrl = companyConfig.jobBoardUrl || companyConfig.jobsUrl || companyConfig.careersUrl;
    if (!careersUrl) {
        return [];
    }

    await page.goto(careersUrl, {
        waitUntil: 'domcontentloaded',
        timeout: Number(config.automation.navigationTimeoutMs || 30000)
    });
    await sleep(Number(config.automation.careersPageWaitMs || 5000));

    await page.evaluate(() => {
        window.scrollBy(0, Math.max(window.innerHeight, 900));
    });
    await sleep(1200);

    return page.evaluate((companyName, hintFragments) => {
        function normalizeTextLocal(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        function absoluteUrl(value) {
            try {
                return new URL(value, location.href).href;
            } catch (error) {
                return '';
            }
        }

        function getContextText(node) {
            let current = node;
            let bestText = '';

            for (let depth = 0; depth < 5 && current; depth += 1) {
                const text = normalizeTextLocal(current.innerText || current.textContent || '');
                if (text.length > bestText.length && text.length < 1200) {
                    bestText = text;
                }
                current = current.parentElement;
            }

            return bestText;
        }

        function detectLocation(text) {
            const segments = normalizeTextLocal(text)
                .split('|')
                .map((segment) => segment.trim())
                .filter(Boolean);

            return segments.find((segment) => /remote|hybrid|india|bangalore|bengaluru|gurgaon|noida|pune|hyderabad|mumbai|delhi/i.test(segment)) || '';
        }

        function detectEmploymentType(text) {
            const normalized = normalizeTextLocal(text);
            const patterns = ['full time', 'full-time', 'contract', 'internship', 'part time', 'part-time'];
            return patterns.find((pattern) => normalized.toLowerCase().includes(pattern)) || '';
        }

        function looksLikeRoleTitle(title, contextText) {
            const normalizedTitle = normalizeTextLocal(title).toLowerCase();
            const normalizedContext = normalizeTextLocal(contextText).toLowerCase();
            const rolePatterns = [
                /\bengineer\b/,
                /\bdeveloper\b/,
                /\bsde\b/,
                /full stack/,
                /full-stack/,
                /frontend/,
                /backend/,
                /\bsoftware\b/,
                /\bweb\b/,
                /\bapplication\b/,
                /\btechnology\b/,
                /\bqa\b/,
                /\bdevops\b/,
                /\bdata\b/
            ];

            if (rolePatterns.some((pattern) => pattern.test(normalizedTitle))) {
                return true;
            }

            return normalizedTitle.split(' ').length >= 2 &&
                rolePatterns.some((pattern) => pattern.test(normalizedContext));
        }

        function isGenericCareerNavigation(title, url) {
            const normalizedTitle = normalizeTextLocal(title).toLowerCase();
            const normalizedUrl = String(url || '').toLowerCase();
            const genericTitlePatterns = [
                /^search$/,
                /^explore$/,
                /^find jobs$/,
                /^job search$/,
                /^experienced professionals$/,
                /^students? and entry/,
                /^student and entry level/,
                /^talent community$/,
                /^people stories/,
                /^what we look for/,
                /^what you can do here$/,
                /^how we hire/,
                /^interview tips/,
                /^cookie preferences$/,
                /^skip to content$/,
                /^careers$/,
                /^explore open roles$/,
                /^job openings$/,
                /^open roles$/,
                /^see all results/,
                /^india english$/
            ];
            const genericUrlFragments = [
                '#',
                '/lp/',
                'job_boards',
                'how-we-hire',
                'what-we-look-for',
                'interview-tips',
                'people-stories',
                'diversity',
                'mobility',
                'talent-community',
                'talentcommunity'
            ];

            return genericTitlePatterns.some((pattern) => pattern.test(normalizedTitle)) ||
                genericUrlFragments.some((fragment) => normalizedUrl.includes(fragment));
        }

        function pushJob(jobs, seenKeys, job) {
            const key = `${normalizeTextLocal(job.title).toLowerCase()}::${job.url}`;
            if (!job.title || !job.url || seenKeys.has(key)) {
                return;
            }

            seenKeys.add(key);
            jobs.push(job);
        }

        const jobs = [];
        const seenKeys = new Set();

        document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
            try {
                const parsed = JSON.parse(script.textContent || 'null');
                const payloads = Array.isArray(parsed) ? parsed : [parsed];

                for (const payload of payloads) {
                    const candidates = payload?.['@graph'] ? payload['@graph'] : [payload];
                    for (const item of candidates) {
                        if (item?.['@type'] !== 'JobPosting') {
                            continue;
                        }

                        const title = normalizeTextLocal(item.title || item.name);
                        const url = absoluteUrl(item.url || location.href);
                        const locationText = normalizeTextLocal(
                            item.jobLocation?.address?.addressLocality ||
                            item.jobLocation?.address?.addressRegion ||
                            item.jobLocation?.address?.streetAddress ||
                            ''
                        );
                        const summary = normalizeTextLocal(item.description || '').slice(0, 900);

                        if (!looksLikeRoleTitle(title, summary)) {
                            continue;
                        }

                        pushJob(jobs, seenKeys, {
                            company: companyName,
                            title,
                            url,
                            applyUrl: url,
                            sourcePageUrl: location.href,
                            location: locationText,
                            department: '',
                            employmentType: normalizeTextLocal(item.employmentType || ''),
                            summary
                        });
                    }
                }
            } catch (error) {
                return;
            }
        });

        document.querySelectorAll('a[href]').forEach((anchor) => {
            const href = absoluteUrl(anchor.href);
            const anchorText = normalizeTextLocal(anchor.innerText || anchor.textContent || '');
            const contextText = getContextText(anchor);
            const title = anchorText || normalizeTextLocal((contextText || '').split('\n')[0]);
            const haystack = `${href} ${anchorText} ${contextText}`.toLowerCase();
            const looksLikeJobLink = hintFragments.some((fragment) => haystack.includes(String(fragment).toLowerCase()));

            if (!looksLikeJobLink) {
                return;
            }

            if (title.length < 4) {
                return;
            }

            if (/learn more|read more|view all|careers|our team|privacy|terms|benefits/i.test(title)) {
                return;
            }

            if (!looksLikeRoleTitle(title, contextText)) {
                return;
            }

             if (isGenericCareerNavigation(title, href)) {
                return;
            }

            pushJob(jobs, seenKeys, {
                company: companyName,
                title,
                url: href,
                applyUrl: href,
                sourcePageUrl: location.href,
                location: detectLocation(contextText),
                department: '',
                employmentType: detectEmploymentType(contextText),
                summary: normalizeTextLocal(contextText).slice(0, 900)
            });
        });

        return jobs.slice(0, 100);
    }, companyConfig.company, ROLE_LINK_HINTS);
}

function scoreJob(job, config) {
    const searchableText = `${job.title} ${job.summary} ${job.location} ${job.department} ${job.company}`.toLowerCase();
    const resumeRoleMatches = mergeUniqueValues(
        (config.resumeProfile?.roleKeywords || [])
            .filter((keyword) => searchableText.includes(keyword.toLowerCase()))
    );
    const resumeSkillMatches = mergeUniqueValues(
        (config.resumeProfile?.skillKeywords || [])
            .filter((keyword) => searchableText.includes(keyword.toLowerCase()))
    ).filter((keyword) => !resumeRoleMatches.some((entry) => entry.toLowerCase() === keyword.toLowerCase()));
    const preferenceMatches = mergeUniqueValues(
        config.matching.keywords
            .filter((keyword) => searchableText.includes(keyword.toLowerCase()))
    ).filter((keyword) => {
        const normalized = keyword.toLowerCase();
        return !resumeRoleMatches.some((entry) => entry.toLowerCase() === normalized) &&
            !resumeSkillMatches.some((entry) => entry.toLowerCase() === normalized);
    });
    const negativeMatches = config.matching.negativeKeywords
        .filter((keyword) => searchableText.includes(keyword.toLowerCase()));
    const locationMatches = mergeUniqueValues(
        mergeUniqueValues(
            config.matching.targetLocations,
            config.resumeProfile?.locationKeywords || []
        ).filter((keyword) => searchableText.includes(keyword.toLowerCase()))
    );
    const matchScore = (resumeRoleMatches.length * 3) +
        (resumeSkillMatches.length * 2) +
        (preferenceMatches.length * 2) +
        locationMatches.length -
        (negativeMatches.length * 3);

    let fitLabel = 'Low Fit';
    if (
        matchScore >= 6 ||
        (resumeRoleMatches.length >= 1 && (resumeSkillMatches.length >= 1 || preferenceMatches.length >= 1)) ||
        preferenceMatches.length >= 2
    ) {
        fitLabel = 'High Fit';
    } else if (matchScore >= 3 || resumeRoleMatches.length >= 1 || preferenceMatches.length >= 1) {
        fitLabel = 'Possible Fit';
    }

    if (negativeMatches.length > 0 && matchScore <= 0) {
        fitLabel = 'Low Fit';
    }

    return {
        matchScore,
        matchedKeywords: mergeUniqueValues(
            resumeRoleMatches,
            resumeSkillMatches,
            preferenceMatches,
            locationMatches
        ).slice(0, 12),
        fitLabel,
        isRelevant: fitLabel !== 'Low Fit',
        matchBreakdown: {
            resumeRoleMatches,
            resumeSkillMatches,
            preferenceMatches,
            locationMatches,
            negativeMatches
        }
    };
}

function annotateJobs(discoveredJobs, state, config, trackerRecords) {
    const appliedJobKeys = new Set(state.appliedJobKeys || []);

    return discoveredJobs.map((job) => {
        const jobKey = buildJobKey(job.company, job.title, job.url);
        const ats = detectAts(job.applyUrl || job.url);
        const scoring = scoreJob(job, config);
        const existingState = state.seenJobs?.[jobKey];
        const existingTrackerRecord = trackerRecords.get(jobKey);
        const isAlreadyApplied = appliedJobKeys.has(jobKey) ||
            existingTrackerRecord?.status === 'Applied' ||
            existingTrackerRecord?.status === 'Already Applied';
        const isNew = !existingState && !existingTrackerRecord;
        const applySupport = {
            supported: config.automation.supportedAtsForAutoApply.includes(ats),
            reason: config.automation.supportedAtsForAutoApply.includes(ats) ? 'Supported ATS' : 'Unsupported ATS'
        };

        return {
            ...job,
            ...scoring,
            jobKey,
            ats,
            isNew,
            isAlreadyApplied,
            shouldAttemptApply: scoring.isRelevant &&
                !isAlreadyApplied &&
                applySupport.supported &&
                (!config.automation.onlyApplyToNewJobs || isNew) &&
                config.automation.autoApplyEnabled,
            applySupport,
            note: scoring.isRelevant
                ? `${job.company} matched your resume profile via ${scoring.matchedKeywords.join(', ') || 'role alignment'}.`
                : scoring.matchBreakdown.negativeMatches.length > 0
                    ? `Role was filtered out by ${scoring.matchBreakdown.negativeMatches.join(', ')}.`
                    : 'Role did not align strongly with your resume profile.'
        };
    });
}

function pickJobsForAction(jobs, config) {
    return jobs
        .filter((job) => job.isRelevant && !job.isAlreadyApplied)
        .sort((left, right) => {
            if (right.matchScore !== left.matchScore) {
                return right.matchScore - left.matchScore;
            }

            if (Number(right.isNew) !== Number(left.isNew)) {
                return Number(right.isNew) - Number(left.isNew);
            }

            return left.title.localeCompare(right.title);
        })
        .slice(0, Number(config.automation.maxJobsPerRun || 12));
}

async function clickApplyEntryPoint(page) {
    const clicked = await page.evaluate(() => {
        function normalizeTextLocal(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        const candidates = Array.from(document.querySelectorAll('a, button'));
        const target = candidates.find((element) => {
            const text = normalizeTextLocal(
                element.innerText ||
                element.textContent ||
                element.getAttribute('aria-label') ||
                ''
            ).toLowerCase();
            return /apply|submit application|easy apply|candidate home/i.test(text);
        });

        if (!target) {
            return false;
        }

        target.click();
        return true;
    }).catch(() => false);

    if (clicked) {
        await sleep(1500);
    }

    return clicked;
}

async function resolveSmartRecruitersApplyUrl(page) {
    return page.evaluate(() => {
        const directLink = Array.from(document.querySelectorAll('a[href]'))
            .map((anchor) => anchor.href || '')
            .find((href) => href.includes('/oneclick-ui/'));

        return directLink || '';
    }).catch(() => '');
}

async function detectBotProtection(page) {
    const frameSignals = await Promise.all(page.frames().map(async (frame) => {
        try {
            const bodyText = await frame.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500));
            return {
                url: frame.url(),
                bodyText
            };
        } catch (error) {
            return {
                url: frame.url(),
                bodyText: ''
            };
        }
    }));

    const triggered = frameSignals.find((signal) =>
        signal.url.includes('captcha-delivery.com') ||
        /verification required|slide right to secure your access|automated \(bot\) activity/i.test(signal.bodyText)
    );

    if (!triggered) {
        return null;
    }

    const blockedHost = triggered.url ? (() => {
        try {
            return new URL(triggered.url).hostname;
        } catch (error) {
            return 'the application page';
        }
    })() : 'the application page';

    return `Bot protection detected on ${blockedHost}.`;
}

async function waitForBotProtectionToClear(page, waitMs) {
    const deadline = Date.now() + waitMs;

    while (Date.now() < deadline) {
        const protectionNote = await detectBotProtection(page);
        if (!protectionNote) {
            return true;
        }

        await sleep(2000);
    }

    return false;
}

async function prepareApplicationForm(page, job, config) {
    const entryUrl = job.applyUrl || job.url;
    await page.goto(entryUrl, {
        waitUntil: job.ats === 'smartrecruiters' ? 'networkidle2' : 'domcontentloaded',
        timeout: Number(config.automation.navigationTimeoutMs || 30000)
    });
    await sleep(3000);

    if (job.ats === 'greenhouse' || job.ats === 'lever' || job.ats === 'smartrecruiters') {
        await clickApplyEntryPoint(page).catch(err => console.warn('   ⚠️ UI interaction warning (apply entry):', err.message));
    }

    if (job.ats === 'smartrecruiters') {
        const directApplyUrl = await resolveSmartRecruitersApplyUrl(page);
        if (directApplyUrl) {
            await page.goto(directApplyUrl, {
                waitUntil: 'networkidle2',
                timeout: Number(config.automation.navigationTimeoutMs || 30000)
            });
            await sleep(4000);
        }
    }

    const protectionNote = await detectBotProtection(page);
    if (protectionNote) {
        return {
            hasForm: false,
            fieldCount: 0,
            requiredUnknownFields: [],
            requiredSupportedFields: [],
            supported: false,
            needsResumeUpload: false,
            blockedByProtection: true,
            protectionNote
        };
    }

    return page.evaluate(() => {
        function normalizeTextLocal(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        function getLabelText(field) {
            if (!field) {
                return '';
            }

            const ariaLabel = field.getAttribute('aria-label') || '';
            const placeholder = field.getAttribute('placeholder') || '';
            const parentLabel = field.closest('label');
            if (parentLabel) {
                return normalizeTextLocal(parentLabel.innerText || parentLabel.textContent || ariaLabel || placeholder);
            }

            const id = field.id;
            if (id) {
                const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                if (explicit) {
                    return normalizeTextLocal(explicit.innerText || explicit.textContent || ariaLabel || placeholder);
                }
            }

            return normalizeTextLocal(ariaLabel || placeholder || field.getAttribute('name') || '');
        }

        const form = document.querySelector('form');
        if (!form) {
            return {
                hasForm: false,
                fieldCount: 0,
                requiredUnknownFields: [],
                requiredSupportedFields: [],
                supported: false,
                needsResumeUpload: false
            };
        }

        const supportedPatterns = [
            /first name/,
            /last name/,
            /full name/,
            /email/,
            /phone/,
            /location/,
            /city/,
            /linkedin/,
            /github/,
            /portfolio/,
            /website/,
            /resume/
        ];
        const ignorablePatterns = [
            /cover letter/,
            /salary/,
            /start date/,
            /notice period/,
            /gender/,
            /race/,
            /veteran/,
            /disability/,
            /visa/,
            /work authorization/,
            /sponsorship/,
            /experience/,
            /captcha/
        ];

        const fields = Array.from(form.querySelectorAll('input, textarea, select'));
        const requiredUnknownFields = [];
        const requiredSupportedFields = [];
        let supportedFieldCount = 0;
        let needsResumeUpload = false;

        fields.forEach((field, index) => {
            const tagName = field.tagName.toLowerCase();
            const type = (field.getAttribute('type') || tagName).toLowerCase();
            const label = getLabelText(field).toLowerCase();
            const name = (field.getAttribute('name') || '').toLowerCase();
            const identifier = `${label} ${name} ${type}`;
            const required = field.required || field.getAttribute('aria-required') === 'true';

            if (['hidden', 'submit', 'button', 'search'].includes(type)) {
                return;
            }

            if (type === 'file' && /resume|cv/.test(identifier)) {
                needsResumeUpload = true;
                field.setAttribute('data-codex-resume-input', '1');
                supportedFieldCount += 1;
                return;
            }

            if (supportedPatterns.some((pattern) => pattern.test(identifier))) {
                field.setAttribute('data-codex-fill-target', `field-${index}`);
                field.setAttribute('data-codex-label', label);
                supportedFieldCount += 1;
                if (required) {
                    requiredSupportedFields.push(normalizeTextLocal(identifier).slice(0, 120));
                }
                return;
            }

            if (required && !ignorablePatterns.some((pattern) => pattern.test(identifier))) {
                requiredUnknownFields.push(normalizeTextLocal(identifier).slice(0, 120));
            }
        });

        return {
            hasForm: true,
            fieldCount: fields.length,
            requiredUnknownFields: Array.from(new Set(requiredUnknownFields)).slice(0, 10),
            requiredSupportedFields: Array.from(new Set(requiredSupportedFields)).slice(0, 10),
            supported: supportedFieldCount > 0,
            needsResumeUpload
        };
    });
}

function applicantPayload(config) {
    const fullName = normalizeText(config.applicant.fullName);
    const nameParts = fullName.split(' ').filter(Boolean);

    return {
        fullName,
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        email: normalizeText(config.applicant.email),
        phone: normalizeText(config.applicant.phone),
        location: normalizeText(config.applicant.currentLocation),
        linkedinUrl: normalizeText(config.applicant.linkedinUrl),
        githubUrl: normalizeText(config.applicant.githubUrl),
        portfolioUrl: normalizeText(config.applicant.portfolioUrl || config.applicant.websiteUrl),
        websiteUrl: normalizeText(config.applicant.websiteUrl || config.applicant.portfolioUrl),
        yearsOfExperience: normalizeText(config.applicant.yearsOfExperience),
        workAuthorization: normalizeText(config.applicant.workAuthorization),
        sponsorshipRequired: normalizeText(config.applicant.sponsorshipRequired)
    };
}

async function fillSupportedFields(page, config) {
    const applicant = applicantPayload(config);

    return page.evaluate((applicantData) => {
        function normalizeTextLocal(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        function setValue(element, value) {
            if (!element || value === undefined || value === null || value === '') {
                return false;
            }

            const tagName = element.tagName.toLowerCase();
            if (tagName === 'select') {
                const options = Array.from(element.options || []);
                const normalizedValue = normalizeTextLocal(value).toLowerCase();
                const candidate = options.find((option) => normalizeTextLocal(option.textContent).toLowerCase() === normalizedValue) ||
                    options.find((option) => normalizeTextLocal(option.textContent).toLowerCase().includes(normalizedValue));

                if (!candidate) {
                    return false;
                }

                element.value = candidate.value;
                element.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }

            element.focus();
            element.value = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        function getDescriptor(field) {
            const label = (
                field.getAttribute('data-codex-label') ||
                field.getAttribute('aria-label') ||
                field.getAttribute('placeholder') ||
                field.getAttribute('name') ||
                ''
            ).toLowerCase();
            return normalizeTextLocal(label);
        }

        const filled = [];
        const fields = Array.from(document.querySelectorAll('[data-codex-fill-target]'));

        fields.forEach((field) => {
            const descriptor = getDescriptor(field);
            let value = '';

            if (/first/.test(descriptor) && /name/.test(descriptor)) {
                value = applicantData.firstName;
            } else if (/last/.test(descriptor) && /name/.test(descriptor)) {
                value = applicantData.lastName;
            } else if (/full/.test(descriptor) && /name/.test(descriptor)) {
                value = applicantData.fullName;
            } else if (/email/.test(descriptor)) {
                value = applicantData.email;
            } else if (/phone|mobile/.test(descriptor)) {
                value = applicantData.phone;
            } else if (/location|city/.test(descriptor)) {
                value = applicantData.location;
            } else if (/linkedin/.test(descriptor)) {
                value = applicantData.linkedinUrl;
            } else if (/github/.test(descriptor)) {
                value = applicantData.githubUrl;
            } else if (/portfolio|website/.test(descriptor)) {
                value = applicantData.portfolioUrl || applicantData.websiteUrl;
            } else if (/experience/.test(descriptor)) {
                value = applicantData.yearsOfExperience;
            } else if (/authorization/.test(descriptor)) {
                value = applicantData.workAuthorization;
            } else if (/sponsorship/.test(descriptor)) {
                value = applicantData.sponsorshipRequired;
            }

            if (setValue(field, value)) {
                filled.push(descriptor);
            }
        });

        return {
            filled
        };
    }, applicant);
}

async function uploadResumeIfPresent(page, config) {
    const resumePath = config.applicant.resumePath;
    if (!resumePath || !fs.existsSync(resumePath)) {
        return {
            uploaded: false,
            note: 'Resume file not found on disk.'
        };
    }

    const fileInput = await page.$('input[data-codex-resume-input="1"]');
    if (!fileInput) {
        return {
            uploaded: false,
            note: 'No resume upload field was detected.'
        };
    }

    await fileInput.uploadFile(resumePath);
    await sleep(1500);
    return {
        uploaded: true,
        note: 'Resume uploaded.'
    };
}

async function submitApplication(page) {
    const clicked = await page.evaluate(() => {
        function normalizeTextLocal(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        const target = buttons.find((element) => {
            const text = normalizeTextLocal(
                element.innerText ||
                element.textContent ||
                element.getAttribute('value') ||
                element.getAttribute('aria-label') ||
                ''
            ).toLowerCase();
            return /submit|apply|send application|finish/i.test(text) && !element.disabled;
        });

        if (!target) {
            return false;
        }

        target.click();
        return true;
    });

    if (!clicked) {
        return {
            submitted: false,
            note: 'Submit button was not found.'
        };
    }

    await sleep(4000);
    const confirmationFound = await page.evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        return /thank you|application submitted|we have received|thanks for applying|applied successfully/.test(text);
    });

    return {
        submitted: confirmationFound,
        note: confirmationFound
            ? 'Application submitted successfully.'
            : 'Submit was clicked but no confirmation text was detected.'
    };
}

async function attemptApply(page, job, config) {
    if (!job.applySupport.supported) {
        return {
            status: 'Unsupported',
            note: `${job.ats} is not in the supported auto-apply list yet.`
        };
    }

    let formInfo = await prepareApplicationForm(page, job, config);
    if (formInfo.blockedByProtection) {
        if (config.automation.autoApplyEnabled && config.automation.manualCaptchaHandoff && !config.automation.headless) {
            const waitSeconds = Math.round(Number(config.automation.captchaWaitMs || 180000) / 1000);
            console.log(`   ⏳ Bot protection detected. Solve it in the opened browser within ${waitSeconds}s to continue...`);
            const cleared = await waitForBotProtectionToClear(page, Number(config.automation.captchaWaitMs || 180000));
            if (cleared) {
                formInfo = await prepareApplicationForm(page, job, config);
            }
        }
    }

    if (formInfo.blockedByProtection) {
        return {
            status: 'Review',
            note: formInfo.protectionNote
        };
    }

    if (!formInfo.hasForm || !formInfo.supported) {
        return {
            status: 'Review',
            note: 'A supported application form was not detected on the page.'
        };
    }

    if (formInfo.requiredUnknownFields.length > 0) {
        return {
            status: 'Review',
            note: `Application needs manual review because required fields were not recognized: ${formInfo.requiredUnknownFields.join(', ')}`
        };
    }

    if (!config.applicant.email || !config.applicant.fullName) {
        return {
            status: 'Review',
            note: 'Applicant profile is incomplete. Full name and email are required for auto-apply.'
        };
    }

    const applicant = applicantPayload(config);
    const missingRequiredProfileFields = (formInfo.requiredSupportedFields || [])
        .filter((descriptor) => {
            const normalized = descriptor.toLowerCase();

            if (/first|last|full/.test(normalized) && /name/.test(normalized)) {
                return !applicant.fullName;
            }
            if (/email/.test(normalized)) {
                return !applicant.email;
            }
            if (/phone|mobile/.test(normalized)) {
                return !applicant.phone;
            }
            if (/location|city/.test(normalized)) {
                return !applicant.location;
            }
            if (/linkedin/.test(normalized)) {
                return !applicant.linkedinUrl;
            }
            if (/github/.test(normalized)) {
                return !applicant.githubUrl;
            }
            if (/portfolio|website/.test(normalized)) {
                return !(applicant.portfolioUrl || applicant.websiteUrl);
            }
            if (/experience/.test(normalized)) {
                return !applicant.yearsOfExperience;
            }
            if (/authorization/.test(normalized)) {
                return !applicant.workAuthorization;
            }
            if (/sponsorship/.test(normalized)) {
                return !applicant.sponsorshipRequired;
            }

            return false;
        });

    if (missingRequiredProfileFields.length > 0) {
        return {
            status: 'Review',
            note: `Application needs manual review because your profile is missing required values for: ${missingRequiredProfileFields.join(', ')}`
        };
    }

    if (!config.automation.autoApplyEnabled) {
        return {
            status: 'Review',
            note: 'Auto-apply is disabled, so the job was queued for review.'
        };
    }

    const fillResult = await fillSupportedFields(page, config);
    const resumeResult = await uploadResumeIfPresent(page, config);

    if (formInfo.needsResumeUpload && !resumeResult.uploaded) {
        return {
            status: 'Review',
            note: resumeResult.note
        };
    }

    const submitResult = await submitApplication(page);
    return {
        status: submitResult.submitted ? 'Applied' : 'Review',
        note: `${fillResult.filled.length} fields were filled. ${resumeResult.note} ${submitResult.note}`.trim()
    };
}

function buildDigest(discoveredJobs, actionableJobs, applicationResults, config, runStartedAt) {
    const newJobs = discoveredJobs.filter((job) => job.isNew);
    const highFitJobs = discoveredJobs.filter((job) => job.fitLabel === 'High Fit');
    const appliedJobs = applicationResults.filter((item) => item.result.status === 'Applied');
    const reviewJobs = applicationResults.filter((item) => item.result.status === 'Review');
    const failedJobs = applicationResults.filter((item) => item.result.status === 'Failed');

    return {
        generatedAt: new Date().toISOString(),
        runStartedAt,
        companyCount: config.companies.length,
        discoveredCount: discoveredJobs.length,
        newJobCount: newJobs.length,
        highFitCount: highFitJobs.length,
        queuedForAction: actionableJobs.length,
        appliedCount: appliedJobs.length,
        reviewCount: reviewJobs.length,
        failedCount: failedJobs.length,
        resumeProfile: {
            enabled: Boolean(config.resumeProfile?.available),
            sourcePath: config.resumeProfile?.sourcePath || config.applicant.resumePath || '',
            roleKeywords: config.resumeProfile?.roleKeywords || [],
            skillKeywords: config.resumeProfile?.skillKeywords || [],
            locationKeywords: mergeUniqueValues(
                config.matching.targetLocations || [],
                config.resumeProfile?.locationKeywords || []
            )
        },
        appliedJobs: appliedJobs.map((entry) => ({
            title: entry.job.title,
            company: entry.job.company,
            url: entry.job.url,
            note: entry.result.note
        })),
        reviewJobs: reviewJobs.map((entry) => ({
            title: entry.job.title,
            company: entry.job.company,
            url: entry.job.url,
            note: entry.result.note
        })),
        topJobs: actionableJobs.slice(0, 15).map((job) => ({
            title: job.title,
            company: job.company,
            location: job.location,
            fitLabel: job.fitLabel,
            matchScore: job.matchScore,
            matchedKeywords: job.matchedKeywords,
            ats: job.ats,
            isNew: job.isNew,
            url: job.url
        }))
    };
}

function buildDigestMarkdown(digest) {
    const lines = [];
    lines.push('# Daily Job Automation Digest');
    lines.push('');
    lines.push(`Generated: ${digest.generatedAt}`);
    lines.push(`Run Started: ${digest.runStartedAt}`);
    lines.push('');
    lines.push('## Summary');
    lines.push(`- Companies checked: ${digest.companyCount}`);
    lines.push(`- Jobs discovered: ${digest.discoveredCount}`);
    lines.push(`- New jobs: ${digest.newJobCount}`);
    lines.push(`- High-fit jobs: ${digest.highFitCount}`);
    lines.push(`- Jobs queued for action: ${digest.queuedForAction}`);
    lines.push(`- Applied automatically: ${digest.appliedCount}`);
    lines.push(`- Needs review: ${digest.reviewCount}`);
    lines.push(`- Failed: ${digest.failedCount}`);
    lines.push('');
    lines.push('## Resume Match Profile');
    lines.push(`- Resume source: ${digest.resumeProfile.sourcePath || 'Not configured'}`);
    lines.push(`- Resume matching enabled: ${digest.resumeProfile.enabled ? 'yes' : 'no (fallback keywords only)'}`);
    lines.push(`- Role keywords: ${(digest.resumeProfile.roleKeywords || []).join(', ') || 'None extracted'}`);
    lines.push(`- Skill keywords: ${(digest.resumeProfile.skillKeywords || []).join(', ') || 'None extracted'}`);
    lines.push(`- Target locations: ${(digest.resumeProfile.locationKeywords || []).join(', ') || 'None configured'}`);
    lines.push('');
    lines.push('## Top Jobs');

    if (digest.topJobs.length === 0) {
        lines.push('- No relevant jobs were found in this run.');
    } else {
        for (const job of digest.topJobs) {
            lines.push(`- ${job.title} | ${job.company} | ${job.location || 'Location not listed'} | ${job.fitLabel} | ATS=${job.ats} | new=${job.isNew ? 'yes' : 'no'}`);
        }
    }

    if (digest.appliedJobs.length > 0) {
        lines.push('');
        lines.push('## Applied Jobs');
        for (const job of digest.appliedJobs) {
            lines.push(`- ${job.title} at ${job.company}: ${job.note}`);
        }
    }

    if (digest.reviewJobs.length > 0) {
        lines.push('');
        lines.push('## Review Queue');
        for (const job of digest.reviewJobs) {
            lines.push(`- ${job.title} at ${job.company}: ${job.note}`);
        }
    }

    return `${lines.join('\n')}\n`;
}

function writeDigestFiles(digest, config) {
    const markdown = buildDigestMarkdown(digest);

    if (config.digest.writeMarkdown) {
        fs.writeFileSync(JOB_DIGEST_MARKDOWN_PATH, markdown);
    }

    if (config.digest.writeJson) {
        writeJsonFile(JOB_DIGEST_JSON_PATH, digest);
    }

    return {
        markdown,
        markdownPath: JOB_DIGEST_MARKDOWN_PATH,
        jsonPath: JOB_DIGEST_JSON_PATH
    };
}

async function main() {
    const config = loadJobAutomationConfig();
    const state = loadState();
    const projectRoot = path.resolve(__dirname, '..');
    const tracker = createJobTracker({
        projectRoot,
        baseDir: __dirname,
        env: process.env
    });
    const runStartedAt = new Date().toISOString();
    const runDateIso = runStartedAt.split('T')[0];
    const browser = await launchBrowser(config.automation.headless);
    const page = await browser.newPage();

    page.setDefaultNavigationTimeout(Number(config.automation.navigationTimeoutMs || 30000));
    await page.setViewport({ width: 1600, height: 1000 });

    try {
        console.log(`🚀 Daily job automation: ${config.automation.autoApplyEnabled ? 'AUTO-APPLY ENABLED' : 'DISCOVERY / REVIEW MODE'}`);
        console.log(`🏢 Companies configured: ${config.companies.length}`);
        console.log(
            `📄 Resume matching: ${config.resumeProfile?.available
                ? `ENABLED (${config.resumeProfile.roleKeywords.length} role signals, ${config.resumeProfile.skillKeywords.length} skill signals)`
                : 'FALLBACK KEYWORDS ONLY'}`
        );
        console.log(`🧾 Notion job tracker: ${tracker.enabled ? 'ENABLED' : 'DISABLED'}`);

        let trackerRecords = new Map();
        if (tracker.enabled) {
            await tracker.ensureDatabase();
            trackerRecords = await tracker.loadRecords();
            console.log(`🗂️ Job tracker database ready with ${trackerRecords.size} indexed roles before this run`);
        }

        const discoveredJobs = [];
        for (const companyConfig of config.companies) {
            try {
                console.log(`🔎 Checking ${companyConfig.company} careers page...`);
                const companyJobs = await discoverJobsForCompany(page, companyConfig, config);
                console.log(`   • ${companyJobs.length} raw roles found`);
                discoveredJobs.push(...companyJobs);
            } catch (error) {
                console.log(`   • failed to read ${companyConfig.company}: ${truncate(error.message, 220)}`);
            }
        }

        const dedupedJobs = Array.from(new Map(
            discoveredJobs.map((job) => [buildJobKey(job.company, job.title, job.url), job])
        ).values());
        const annotatedJobs = annotateJobs(dedupedJobs, state, config, trackerRecords);
        const actionableJobs = pickJobsForAction(annotatedJobs, config);

        console.log(`✅ Total deduped jobs discovered: ${annotatedJobs.length}`);
        console.log(`🎯 Relevant jobs queued: ${actionableJobs.length}`);

        const syncContext = {
            runDateIso,
            applicationMode: config.automation.autoApplyEnabled ? config.automation.applicationMode : 'discover_only',
            resumePath: config.applicant.resumePath || ''
        };

        if (tracker.enabled && annotatedJobs.length > 0) {
            await tracker.syncJobs(annotatedJobs, syncContext);
        }

        const applicationResults = [];
        for (const job of actionableJobs) {
            console.log(`\n🎯 ${job.title} | ${job.company}`);
            console.log(`   URL: ${job.url}`);
            console.log(`   Fit: ${job.fitLabel} (score ${job.matchScore})`);
            console.log(`   ATS: ${job.ats}`);
            console.log(`   New role: ${job.isNew ? 'yes' : 'no'}`);

            let result = null;
            try {
                result = await attemptApply(page, job, config);
                console.log(`   ${result.status === 'Applied' ? '✅' : '📝'} ${result.status}: ${result.note}`);
            } catch (error) {
                result = {
                    status: 'Failed',
                    note: truncate(error.message, 300)
                };
                console.log(`   ❌ Failed: ${result.note}`);
            }

            applicationResults.push({ job, result });

            if (tracker.enabled) {
                await tracker.updateApplicationResult(job, result, runDateIso).catch(err => console.error('   ❌ Tracking error:', err.message));
            }

            if (result.status === 'Applied') {
                state.appliedJobKeys = Array.from(new Set([...(state.appliedJobKeys || []), job.jobKey]));
            }

            state.seenJobs[job.jobKey] = {
                firstSeenAt: state.seenJobs[job.jobKey]?.firstSeenAt || runStartedAt,
                lastSeenAt: runStartedAt,
                title: job.title,
                company: job.company,
                url: job.url,
                status: result.status
            };
        }

        for (const job of annotatedJobs) {
            if (!state.seenJobs[job.jobKey]) {
                state.seenJobs[job.jobKey] = {
                    firstSeenAt: runStartedAt,
                    lastSeenAt: runStartedAt,
                    title: job.title,
                    company: job.company,
                    url: job.url,
                    status: job.isRelevant ? 'Review' : 'Skipped'
                };
            } else {
                state.seenJobs[job.jobKey].lastSeenAt = runStartedAt;
            }
        }

        state.lastRunAt = runStartedAt;
        writeState(state);

        const digest = buildDigest(annotatedJobs, actionableJobs, applicationResults, config, runStartedAt);
        const digestArtifacts = writeDigestFiles(digest, config);

        if (tracker.enabled && config.digest.createNotionPage) {
            const digestTitle = `Daily Job Automation Digest - ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
            await tracker.createDigestPage({
                title: digestTitle,
                markdown: digestArtifacts.markdown
            }).catch((error) => {
                console.log(`⚠️ Job digest page could not be created in Notion: ${error.message}`);
            });
        }

        console.log(`📝 Job digest written to ${digestArtifacts.markdownPath}`);
        console.log(`🗃️ State saved to ${JOB_STATE_PATH}`);
    } finally {
        await sleep(1500);
        await browser.close();
    }
}

main().catch((error) => {
    console.error('❌ Fatal job automation error:', error.message);
    console.error(error.stack);
    process.exit(1);
});
