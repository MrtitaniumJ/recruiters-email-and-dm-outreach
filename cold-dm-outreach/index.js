const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const {
    loadCampaignConfig,
    runJobMatcher,
    enrichConnectionsWithCampaignData,
    buildMessageFromTemplate,
    buildDigestData,
    writeDigestFiles
} = require('./campaignAutomation');
const { createNotionTracker } = require('./notionTracker');

require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: false });

const LINKEDIN_BASE_URL = 'https://www.linkedin.com';
const CONNECTIONS_URL = `${LINKEDIN_BASE_URL}/mynetwork/invite-connect/connections/`;
const DEFAULT_MESSAGE_TEMPLATE = "Hi {name},\n\nI'm Jatin, currently looking for new SDE opportunities. Would love to connect and hear if you have any open roles in your team.\n\nBest,\nJatin";
const SYNC_STATE_PATH = path.join(__dirname, 'linkedin_sync_state.json');
const COMPOSER_SELECTORS = [
    'div.msg-form__contenteditable[role="textbox"]',
    'div.msg-form__contenteditable',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="Write a message"]',
    'textarea'
];
const BLOCKED_OUTREACH_STATUSES = new Set(['Messaged', 'Already Messaged', 'Skipped', 'Do Not Message', 'Review']);

const RELEVANCE_RULES = {
    strongPatterns: [
        /\brecruit(er|ment|ing)?\b/i,
        /\btalent acquisition\b/i,
        /\btalent partner\b/i,
        /\btalent scout\b/i,
        /\btalent sourcer\b/i,
        /\bhuman resources?\b/i,
        /\bstaffing\b/i,
        /\bsourcer\b/i,
        /\bheadhunter\b/i,
        /\bpeople (consultant|partner|operations|ops)\b/i,
        /\bhr\b.*\b(executive|manager|generalist|business partner|bp)\b/i,
        /\bit recruitment\b/i,
        /\bcampus hiring\b/i,
        /\btech hiring\b/i,
        /\bhiring talent\b/i,
        /\bta\b/i
    ],
    softPatterns: [
        /\bhiring\b/i,
        /\btalent(s)?\b/i,
        /\bhr\b/i
    ],
    negativePatterns: [
        /\bstudent\b/i,
        /\bintern(ship)?\b/i,
        /\btrainee\b/i,
        /\bpsycholog/i,
        /\bdesigner\b/i,
        /\bdeveloper\b/i,
        /\bengineer\b/i,
        /\bsales\b/i,
        /\bmarketing\b/i
    ]
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

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

function normalizeMessageTemplate(template) {
    return (template || DEFAULT_MESSAGE_TEMPLATE).replace(/\\n/g, '\n');
}

function normalizeName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
}

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

function readSentLogs(logPath) {
    return readJsonFile(logPath, []);
}

function writeSentLogs(logPath, sentLogs) {
    writeJsonFile(logPath, Array.from(sentLogs));
}

function buildConfig() {
    return {
        dryRun: parseBoolean(process.env.DRY_RUN, true),
        liAt: process.env.LI_AT ? process.env.LI_AT.replace(/['"]/g, '').trim() : '',
        headless: parseBoolean(process.env.HEADLESS, false) ? 'new' : false,
        maxProfilesPerRun: Number(process.env.MAX_PROFILES_PER_RUN || 20),
        maxConnectionsToSync: Number(process.env.MAX_CONNECTIONS_TO_SYNC || 250),
        recentConnectionSyncSteps: Number(process.env.RECENT_CONNECTION_SYNC_STEPS || 30),
        newConnectionSyncSteps: Number(process.env.NEW_CONNECTION_SYNC_STEPS || 60),
        forceConnectionSync: parseBoolean(process.env.FORCE_CONNECTION_SYNC, false),
        minDelayMs: Number(process.env.MIN_DELAY_MS || 15000),
        maxDelayMs: Number(process.env.MAX_DELAY_MS || 35000),
        navigationTimeoutMs: Number(process.env.NAVIGATION_TIMEOUT_MS || 30000),
        messageTemplate: normalizeMessageTemplate(process.env.MESSAGE_TEMPLATE)
    };
}

async function launchBrowser(headlessMode) {
    return puppeteer.launch({
        headless: headlessMode,
        args: [
            '--disable-extensions',
            '--disable-plugins',
            '--disable-sync',
            '--disable-blink-features=AutomationControlled',
            '--no-first-run'
        ]
    });
}

async function ensureLinkedInSession(page, liAt, timeoutMs) {
    await page.setCookie({
        name: 'li_at',
        value: liAt,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true
    });

    await page.goto(CONNECTIONS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
    });

    await sleep(4000);

    const sessionState = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const url = location.href.toLowerCase();
        const loginDetected = url.includes('/login') ||
            url.includes('/checkpoint/') ||
            bodyText.includes('sign in') ||
            bodyText.includes('join linkedin');

        return {
            url: location.href,
            title: document.title,
            loginDetected
        };
    });

    if (sessionState.loginDetected) {
        throw new Error('LinkedIn session is not authenticated. Refresh the LI_AT cookie in cold-dm-outreach/.env.');
    }

    return sessionState;
}

async function extractTotalConnectionCount(page) {
    const totalConnections = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const match = text.match(/([\d,]+)\s+connections?/i);
        if (!match) {
            return null;
        }

        return Number(match[1].replace(/,/g, ''));
    });

    return Number.isFinite(totalConnections) ? totalConnections : null;
}

function determineSyncPlan(totalConnections, syncState, config) {
    const previousCount = Number(syncState.lastKnownConnectionCount || 0);
    const currentCount = Number(totalConnections || 0);
    const countDelta = currentCount > 0 && previousCount > 0 ? currentCount - previousCount : 0;
    const shouldDeepSync = config.forceConnectionSync || previousCount === 0 || countDelta > 0;

    return {
        countDelta,
        shouldDeepSync,
        scrollSteps: shouldDeepSync ? config.newConnectionSyncSteps : config.recentConnectionSyncSteps,
        reason: config.forceConnectionSync
            ? 'forced'
            : previousCount === 0
                ? 'initial sync'
                : countDelta > 0
                    ? `connection count increased by ${countDelta}`
                    : 'regular recent-connections sync'
    };
}

async function collectConnections(page, maxScrollSteps, maxConnectionsToSync) {
    const connectionsByKey = new Map();

    for (let step = 0; step < maxScrollSteps; step += 1) {
        const visibleConnections = await extractVisibleConnections(page);
        for (const connection of visibleConnections) {
            const dedupeKey = connection.profileUrl || connection.messageUrl || connection.fullName;
            if (!connectionsByKey.has(dedupeKey)) {
                connectionsByKey.set(dedupeKey, connection);
            }
        }

        console.log(`   • Scroll ${step + 1}/${maxScrollSteps}: ${visibleConnections.length} visible connections, ${connectionsByKey.size} unique synced`);

        if (connectionsByKey.size >= maxConnectionsToSync) {
            break;
        }

        await page.evaluate(() => {
            const scrollableElements = Array.from(document.querySelectorAll('*'))
                .filter((element) => {
                    const style = window.getComputedStyle(element);
                    return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 80;
                })
                .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight));

            const target = scrollableElements[0] || document.scrollingElement || document.documentElement || document.body;
            target.scrollBy(0, Math.max(window.innerHeight, 900));
        });

        await sleep(1200);
    }

    return Array.from(connectionsByKey.values()).slice(0, maxConnectionsToSync);
}

async function extractVisibleConnections(page) {
    return page.evaluate((linkedinBaseUrl) => {
        function getCardDataFromLink(link) {
            let node = link;
            let bestMatch = null;

            for (let depth = 0; depth < 8 && node; depth += 1) {
                node = node.parentElement;
                if (!node) {
                    break;
                }

                const lines = (node.innerText || '')
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean);

                if (lines.length < 3 || lines.length > 8) {
                    continue;
                }

                const messageLineCount = lines.filter((line) => /^message$/i.test(line)).length;
                if (messageLineCount !== 1) {
                    continue;
                }

                const connectedLineCount = lines.filter((line) => /^connected on /i.test(line)).length;
                if (connectedLineCount > 1) {
                    continue;
                }

                const profileAnchor = node.querySelector('a[href*="/in/"]');
                if (!profileAnchor) {
                    continue;
                }

                const textLength = lines.join(' ').length;
                if (!bestMatch || textLength < bestMatch.textLength) {
                    bestMatch = {
                        lines,
                        textLength,
                        profileUrl: profileAnchor.href || '',
                        messageUrl: link.href || '',
                        linkCount: node.querySelectorAll('a[href]').length
                    };
                }
            }

            return bestMatch;
        }

        const connections = [];
        const seenKeys = new Set();

        document.querySelectorAll('a[href*="/messaging/compose/"]').forEach((messageLink) => {
            const card = getCardDataFromLink(messageLink);
            if (!card) {
                return;
            }

            const fullName = String(card.lines[0] || '').replace(/\s+/g, ' ').trim();
            if (!fullName) {
                return;
            }

            const detailLines = card.lines
                .slice(1)
                .filter((line) => !/^connected on /i.test(line) && !/^message$/i.test(line));
            const connectedOnRaw = card.lines.find((line) => /^connected on /i.test(line)) || '';
            const headline = detailLines[0] || '';
            const additionalDetails = detailLines.slice(1).join(' | ');
            const profileUrl = card.profileUrl.startsWith('http') ? card.profileUrl : `${linkedinBaseUrl}${card.profileUrl}`;
            const messageUrl = card.messageUrl.startsWith('http') ? card.messageUrl : `${linkedinBaseUrl}${card.messageUrl}`;
            const dedupeKey = profileUrl || messageUrl || fullName;

            if (seenKeys.has(dedupeKey)) {
                return;
            }

            seenKeys.add(dedupeKey);
            connections.push({
                fullName,
                firstName: fullName.split(' ')[0],
                headline,
                additionalDetails,
                connectedOnRaw,
                profileUrl,
                messageUrl
            });
        });

        return connections;
    }, LINKEDIN_BASE_URL);
}

function parseConnectedOnDate(connectedOnRaw) {
    if (!connectedOnRaw) {
        return '';
    }

    const normalized = connectedOnRaw.replace(/^connected on\s+/i, '').trim();
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    return parsed.toISOString().split('T')[0];
}

function scoreConnection(connection) {
    const searchableText = `${connection.headline} ${connection.additionalDetails}`.trim();
    const strongMatches = RELEVANCE_RULES.strongPatterns
        .filter((pattern) => pattern.test(searchableText))
        .map((pattern) => pattern.source);
    const softMatches = RELEVANCE_RULES.softPatterns
        .filter((pattern) => pattern.test(searchableText))
        .map((pattern) => pattern.source);
    const negativeMatches = RELEVANCE_RULES.negativePatterns
        .filter((pattern) => pattern.test(searchableText))
        .map((pattern) => pattern.source);
    const matchScore = (strongMatches.length * 2) + softMatches.length - negativeMatches.length;

    let relevanceLabel = 'Not Relevant';
    if (matchScore >= 4 || strongMatches.length >= 2) {
        relevanceLabel = 'Strong Match';
    } else if (matchScore >= 2 && (strongMatches.length > 0 || softMatches.length > 0)) {
        relevanceLabel = 'Possible Match';
    }

    const reasons = [];
    if (strongMatches.length > 0) {
        reasons.push(`strong keywords: ${strongMatches.join(', ')}`);
    }
    if (softMatches.length > 0) {
        reasons.push(`soft keywords: ${softMatches.join(', ')}`);
    }
    if (negativeMatches.length > 0) {
        reasons.push(`negative keywords: ${negativeMatches.join(', ')}`);
    }

    return {
        matchScore,
        relevanceLabel,
        matchReason: truncate(reasons.join(' | '), 900)
    };
}

function annotateConnection(connection) {
    const connectedOnDate = parseConnectedOnDate(connection.connectedOnRaw);
    const { matchScore, relevanceLabel, matchReason } = scoreConnection(connection);
    const profileKey = connection.profileUrl || connection.messageUrl || connection.fullName;

    return {
        ...connection,
        connectedOnDate,
        profileKey,
        matchScore,
        relevanceLabel,
        matchReason
    };
}

function pickCandidates(connections, notionRecords, sentLogs, maxProfilesPerRun) {
    return connections
        .filter((connection) => {
            if (connection.relevanceLabel === 'Not Relevant') {
                return false;
            }

            if (sentLogs.has(connection.fullName)) {
                return false;
            }

            const record = notionRecords.get(connection.profileKey);
            if (!record) {
                return true;
            }

            return !BLOCKED_OUTREACH_STATUSES.has(record.outreachStatus);
        })
        .sort((left, right) => {
            const leftOpenRoleBoost = left.jobMatchStatus === 'Open Roles Found' ? 1 : 0;
            const rightOpenRoleBoost = right.jobMatchStatus === 'Open Roles Found' ? 1 : 0;
            if (rightOpenRoleBoost !== leftOpenRoleBoost) {
                return rightOpenRoleBoost - leftOpenRoleBoost;
            }

            if (right.matchScore !== left.matchScore) {
                return right.matchScore - left.matchScore;
            }

            return left.fullName.localeCompare(right.fullName);
        })
        .slice(0, maxProfilesPerRun);
}

function buildPrioritySyncConnections(connections, candidates) {
    const priority = new Map();

    for (const candidate of candidates) {
        priority.set(candidate.profileKey, candidate);
    }

    if (priority.size === 0) {
        for (const connection of connections) {
            if (connection.relevanceLabel !== 'Not Relevant') {
                priority.set(connection.profileKey, connection);
            }

            if (priority.size >= 25) {
                break;
            }
        }
    }

    return Array.from(priority.values());
}

async function waitForAnySelector(page, selectors, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        for (const selector of selectors) {
            const element = await page.$(selector);
            if (element) {
                return selector;
            }
        }

        await sleep(250);
    }

    throw new Error(`Timed out waiting for a message composer. Tried selectors: ${selectors.join(', ')}`);
}

async function clearComposer(page, selector) {
    await page.focus(selector);
    await page.evaluate((activeSelector) => {
        const element = document.querySelector(activeSelector);
        if (!element) {
            return;
        }

        if (element.isContentEditable) {
            element.textContent = '';
            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
            return;
        }

        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }, selector);
}

async function clickSendButton(page) {
    return page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const sendButton = buttons.find((button) => {
            const text = (button.innerText || button.textContent || button.getAttribute('aria-label') || '').trim().toLowerCase();
            if (text !== 'send') {
                return false;
            }

            if (button.disabled) {
                return false;
            }

            const style = window.getComputedStyle(button);
            return style.visibility !== 'hidden' && style.display !== 'none';
        });

        if (!sendButton) {
            return false;
        }

        sendButton.click();
        return true;
    });
}

async function sendMessageToProfile(page, profile, message, navigationTimeoutMs) {
    await page.goto(profile.messageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeoutMs
    });

    await sleep(5000);

    const composerSelector = await waitForAnySelector(page, COMPOSER_SELECTORS, 15000);
    await clearComposer(page, composerSelector);
    await page.type(composerSelector, message, { delay: 18 });
    await sleep(800);

    const sendClicked = await clickSendButton(page);
    if (!sendClicked) {
        throw new Error('Send button was not found or was disabled.');
    }

    await page.waitForFunction((selector) => {
        const element = document.querySelector(selector);
        if (!element) {
            return false;
        }

        const currentValue = element.isContentEditable
            ? (element.innerText || element.textContent || '').trim()
            : String(element.value || '').trim();

        return currentValue.length === 0;
    }, { timeout: 10000 }, composerSelector);
}

async function returnToConnections(page, timeoutMs) {
    await page.goto(CONNECTIONS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
    });
    await sleep(3000);
}

async function main() {
    const config = buildConfig();
    const campaignConfig = loadCampaignConfig();
    const projectRoot = path.resolve(__dirname, '..');
    const logPath = path.join(__dirname, 'sent_logs.json');
    const sentLogs = new Set(readSentLogs(logPath).map(normalizeName).filter(Boolean));
    const syncState = readJsonFile(SYNC_STATE_PATH, {});
    const notionTracker = createNotionTracker({
        projectRoot,
        baseDir: __dirname,
        env: process.env
    });
    const runStartedAt = new Date().toISOString();
    const sessionSent = [];
    const sessionFailed = [];
    const sessionSkipped = [];
    let totalConnections = 0;
    let connections = [];
    let relevantConnections = [];
    let candidates = [];
    let jobMatches = new Map();

    if (!config.liAt) {
        console.error('❌ ERROR: LI_AT cookie not found in cold-dm-outreach/.env');
        process.exit(1);
    }

    console.log(`🚀 Mode: ${config.dryRun ? 'DRY RUN' : 'ACTIVE'}`);
    console.log(`📘 Previously logged profiles: ${sentLogs.size}`);
    console.log(`🧾 Notion tracker: ${notionTracker.enabled ? 'ENABLED' : 'DISABLED'}`);
    console.log('🚀 Launching Chrome Browser...');

    const browser = await launchBrowser(config.headless);
    const page = await browser.newPage();

    await page.setViewport({ width: 1600, height: 1000 });

    try {
        console.log('🍪 Injecting LI_AT cookie...');
        const sessionState = await ensureLinkedInSession(page, config.liAt, config.navigationTimeoutMs);
        console.log(`✅ LinkedIn session ready: ${sessionState.title}`);

        totalConnections = await extractTotalConnectionCount(page);
        if (totalConnections) {
            console.log(`👥 LinkedIn shows ${totalConnections.toLocaleString('en-US')} total connections`);
        } else {
            console.log('⚠️ Could not read the total connection count from LinkedIn');
        }

        const syncPlan = determineSyncPlan(totalConnections, syncState, config);
        console.log(`🔄 Sync plan: ${syncPlan.reason} (${syncPlan.scrollSteps} scroll steps)`);

        const rawConnections = await collectConnections(page, syncPlan.scrollSteps, config.maxConnectionsToSync);
        const scoredConnections = rawConnections.map(annotateConnection);
        const prelimConnections = enrichConnectionsWithCampaignData(scoredConnections, campaignConfig, new Map());
        jobMatches = await runJobMatcher(prelimConnections, campaignConfig);
        connections = enrichConnectionsWithCampaignData(scoredConnections, campaignConfig, jobMatches);
        relevantConnections = connections.filter((connection) => connection.relevanceLabel !== 'Not Relevant');
        const companiesWithOpenSignals = Array.from(jobMatches.values()).filter((entry) => entry.status === 'Open Roles Found');

        console.log(`✅ Synced ${connections.length} connections from LinkedIn`);
        console.log(`🎯 Relevant recruiter/hiring matches in this sync: ${relevantConnections.length}`);
        console.log(`🏢 Companies with open-role signals: ${companiesWithOpenSignals.length}`);

        if (connections.length === 0) {
            console.log('⚠️ No connections were extracted from LinkedIn. Aborting.');
            return;
        }

        let notionRecords = new Map();
        if (notionTracker.enabled) {
            await notionTracker.ensureDatabase();
            notionRecords = await notionTracker.loadRecords();
            console.log(`🗂️ Notion tracker database ready with ${notionRecords.size} indexed rows before this run`);
        }

        writeJsonFile(SYNC_STATE_PATH, {
            lastKnownConnectionCount: totalConnections || syncState.lastKnownConnectionCount || 0,
            lastSyncAt: new Date().toISOString(),
            lastSyncReason: syncPlan.reason,
            lastSyncScrollSteps: syncPlan.scrollSteps
        });

        candidates = pickCandidates(connections, notionRecords, sentLogs, config.maxProfilesPerRun);
        console.log(`📬 Candidates queued for messaging: ${candidates.length}`);

        const prioritySyncConnections = buildPrioritySyncConnections(connections, candidates);
        const prioritySyncKeys = new Set(prioritySyncConnections.map((connection) => connection.profileKey));
        const syncContext = {
            connectionCount: totalConnections || 0,
            sentLogs,
            syncedAtIso: new Date().toISOString()
        };

        if (notionTracker.enabled && prioritySyncConnections.length > 0) {
            await notionTracker.syncConnections(prioritySyncConnections, syncContext, {
                label: 'Pre-outreach Notion sync'
            });
            notionRecords = notionTracker.recordsByProfileKey;
        }

        if (candidates.length === 0) {
            console.log('🎉 No pending recruiter-like connections need a message right now.');

            if (notionTracker.enabled) {
                const remainingConnections = connections.filter((connection) => !prioritySyncKeys.has(connection.profileKey));
                if (remainingConnections.length > 0) {
                    await notionTracker.syncConnections(remainingConnections, syncContext, {
                        label: 'Post-run Notion sync'
                    });
                }
            }
        } else {
            candidates.forEach((candidate, index) => {
                console.log(`${index + 1}. ${candidate.fullName} - ${candidate.headline || candidate.additionalDetails || 'No headline'} [${candidate.relevanceLabel}, score ${candidate.matchScore}]`);
                console.log(`   Company: ${candidate.companyName || 'Unknown'} | Contact Type: ${candidate.contactType} | Template: ${candidate.templateVariant} | Job Match: ${candidate.jobMatchStatus}`);
            });

            for (let index = 0; index < candidates.length; index += 1) {
                const candidate = candidates[index];
                const message = buildMessageFromTemplate(candidate, campaignConfig);

                console.log(`\n[${index + 1}/${candidates.length}] 🎯 ${candidate.fullName}`);
                console.log(`   Headline: ${candidate.headline || 'N/A'}`);
                console.log(`   Company: ${candidate.companyName || 'Unknown'}`);
                console.log(`   Relevance: ${candidate.relevanceLabel} (score ${candidate.matchScore})`);
                console.log(`   Contact Type: ${candidate.contactType}`);
                console.log(`   Template: ${candidate.templateVariant}`);
                console.log(`   Job Match: ${candidate.jobMatchStatus}${candidate.jobMatchKeywords.length > 0 ? ` (${candidate.jobMatchKeywords.join(', ')})` : ''}`);
                console.log(`   Match reason: ${candidate.matchReason || 'N/A'}`);

                if (config.dryRun) {
                    console.log('   [DRY RUN] Skipping live send.');
                    sessionSkipped.push({
                        fullName: candidate.fullName,
                        reason: 'Dry-run mode'
                    });
                    continue;
                }

                try {
                    await sendMessageToProfile(page, candidate, message, config.navigationTimeoutMs);
                    console.log('   ✅ Message sent');

                    sentLogs.add(candidate.fullName);
                    writeSentLogs(logPath, sentLogs);
                    sessionSent.push(candidate.fullName);

                    if (notionTracker.enabled) {
                        await notionTracker.updateMessageResult(candidate, {
                            status: 'Messaged',
                            note: `Message sent on ${new Date().toISOString().split('T')[0]} using template ${candidate.templateVariant}${candidate.jobMatchStatus === 'Open Roles Found' ? ' with open-role signal' : ''}.`,
                            sentAtIso: new Date().toISOString()
                        });
                    }

                    await returnToConnections(page, config.navigationTimeoutMs);

                    if (index < candidates.length - 1) {
                        const waitMs = randomBetween(config.minDelayMs, config.maxDelayMs);
                        console.log(`   ⏳ Waiting ${Math.round(waitMs / 1000)}s before the next profile...`);
                        await sleep(waitMs);
                    }
                } catch (error) {
                    console.log(`   ❌ Failed for ${candidate.fullName}: ${error.message}`);
                    sessionFailed.push({
                        fullName: candidate.fullName,
                        reason: truncate(error.message, 240)
                    });

                    if (notionTracker.enabled) {
                        await notionTracker.updateMessageResult(candidate, {
                            status: 'Failed',
                            note: `Failed on ${new Date().toISOString().split('T')[0]}: ${truncate(error.message, 400)}`,
                            failed: true
                        }).catch(err => console.error('   ❌ Tracking error:', err.message));
                    }

                    await returnToConnections(page, config.navigationTimeoutMs).catch(err => console.warn('   ⚠️ Navigation warning:', err.message));
                }
            }

            if (notionTracker.enabled) {
                const remainingConnections = connections.filter((connection) => !prioritySyncKeys.has(connection.profileKey));
                if (remainingConnections.length > 0) {
                    await notionTracker.syncConnections(remainingConnections, {
                        ...syncContext,
                        syncedAtIso: new Date().toISOString()
                    }, {
                        label: 'Post-outreach Notion sync'
                    });
                }
            }
        }

        const digest = buildDigestData({
            runStartedAt,
            config: campaignConfig,
            totalConnections,
            syncedConnections: connections.length,
            relevantConnections: relevantConnections.length,
            candidates,
            sentProfiles: sessionSent,
            failedProfiles: sessionFailed,
            skippedProfiles: sessionSkipped,
            connections,
            jobMatches
        });
        const digestArtifacts = writeDigestFiles(digest, campaignConfig);

        if (notionTracker.enabled && campaignConfig.digest.createNotionPage) {
            const digestTitle = `LinkedIn Outreach Digest - ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
            await notionTracker.createDigestPage({
                title: digestTitle,
                markdown: digestArtifacts.markdown
            }).catch((error) => {
                console.log(`⚠️ Digest page could not be created in Notion: ${error.message}`);
            });
        }

        console.log(`📝 Digest written to ${digestArtifacts.markdownPath}`);

        console.log('\n' + '='.repeat(50));
        console.log('✅ Session complete');
        console.log(`📬 Sent in this run: ${sessionSent.length}`);
        sessionSent.forEach((name) => console.log(`   ✓ ${name}`));
        console.log(`🗂️ Total logged profiles: ${sentLogs.size}`);
    } finally {
        await sleep(2000);
        await browser.close();
    }
}

main().catch((error) => {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
});
