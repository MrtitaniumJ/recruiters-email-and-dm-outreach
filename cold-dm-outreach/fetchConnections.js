const fs = require('fs');
const path = require('path');

const {
    launchBrowser,
    ensureLinkedInSession,
    extractTotalConnectionCount,
    collectAllConnections,
    sleep,
    CONNECTIONS_URL
} = require('./linkedinClient');
const { createNotionTracker } = require('./notionTracker');
const { annotateClassification, cleanCompanyGuess } = require('./outreachClassifier');
const { loadCampaignConfig } = require('./campaignAutomation');

require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: false });

const SYNC_STATE_PATH = path.join(__dirname, 'linkedin_sync_state.json');

function parseBoolean(value, fallback) {
    if (value === undefined) {
        return fallback;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return fallback;
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

function detectCompanyName(connection) {
    const headline = `${connection.headline || ''} ${connection.additionalDetails || ''}`.replace(/\s+/g, ' ').trim();
    const patterns = [
        /@([A-Za-z0-9&().,'\- ]{2,80})/,
        /\bat\s+([A-Za-z0-9&().,'\- ]{2,80})/i,
        /-\s*([A-Za-z0-9&().,'\- ]{2,80})/
    ];

    for (const pattern of patterns) {
        const match = headline.match(pattern);
        if (!match) continue;
        const company = cleanCompanyGuess(match[1].split('|')[0].split(',')[0]);
        if (company && company.length >= 2) {
            return company;
        }
    }
    return '';
}

function enrichConnection(raw) {
    const annotated = annotateClassification(raw);
    const connectedOnDate = parseConnectedOnDate(raw.connectedOnRaw);
    const profileKey = raw.profileUrl || raw.messageUrl || raw.fullName;
    const companyName = detectCompanyName(raw);

    return {
        ...annotated,
        companyName,
        connectedOnDate,
        profileKey,
        matchReason: `classified as ${annotated.contactType}`,
        jobMatchStatus: companyName ? 'Not Configured' : 'Unknown Company',
        jobMatchKeywords: [],
        jobMatchNotes: companyName ? '' : 'Company not detected from headline.',
        lastJobCheckAt: '',
        careersUrl: ''
    };
}

function buildConfig() {
    return {
        liAt: process.env.LI_AT ? process.env.LI_AT.replace(/['"]/g, '').trim() : '',
        headless: parseBoolean(process.env.HEADLESS, false),
        navigationTimeoutMs: Number(process.env.NAVIGATION_TIMEOUT_MS || 45000),
        maxScrollSteps: Number(process.env.FETCH_MAX_SCROLL_STEPS || 800),
        stagnationLimit: Number(process.env.FETCH_STAGNATION_LIMIT || 15),
        scrollDelayMs: Number(process.env.FETCH_SCROLL_DELAY_MS || 1400),
        hardCapConnections: Number(process.env.FETCH_HARD_CAP || 6000)
    };
}

async function main() {
    const config = buildConfig();
    if (!config.liAt) {
        console.error('❌ LI_AT cookie missing in cold-dm-outreach/.env');
        process.exit(1);
    }

    console.log('🚀 FETCH LATEST CONNECTIONS');
    console.log(`🕐 ${new Date().toISOString()}`);

    const projectRoot = path.resolve(__dirname, '..');
    const tracker = createNotionTracker({ projectRoot, baseDir: __dirname, env: process.env });

    if (!tracker.enabled) {
        console.error('❌ Notion tracker is not configured. Set NOTION_TOKEN in environment or root index.js.');
        process.exit(1);
    }

    console.log('🗂️ Connecting to Notion tracker database...');
    await tracker.ensureDatabase();
    const existingRecords = await tracker.loadRecords();
    console.log(`🗂️ Notion currently holds ${existingRecords.size} connection rows.`);

    const syncState = readJsonFile(SYNC_STATE_PATH, {});
    const previousKnownCount = Number(syncState.lastKnownConnectionCount || 0);

    const browser = await launchBrowser({ headless: config.headless });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });

    try {
        console.log('🍪 Injecting LI_AT cookie and opening LinkedIn...');
        const session = await ensureLinkedInSession(page, config.liAt, { navigationTimeoutMs: config.navigationTimeoutMs });
        console.log(`✅ Session ready: ${session.title}`);

        const totalConnections = await extractTotalConnectionCount(page);
        if (totalConnections) {
            console.log(`👥 LinkedIn reports ${totalConnections.toLocaleString('en-US')} total connections.`);
        } else {
            console.log('⚠️ Could not read total connection count header.');
        }

        const targetTotal = totalConnections && totalConnections < config.hardCapConnections
            ? totalConnections
            : null;

        console.log('📜 Scrolling through connection list until exhausted...');
        const rawConnections = await collectAllConnections(page, {
            targetTotal,
            maxScrollSteps: config.maxScrollSteps,
            stagnationLimit: config.stagnationLimit,
            scrollDelayMs: config.scrollDelayMs,
            onProgress: ({ step, total, newCount, stagnant }) => {
                if (step % 5 === 0 || newCount === 0) {
                    console.log(`   • step ${step}: collected ${total}${totalConnections ? `/${totalConnections}` : ''} (+${newCount}, stagnant ${stagnant})`);
                }
            }
        });

        console.log(`✅ Scraped ${rawConnections.length} unique connections from LinkedIn.`);

        const enriched = rawConnections.map(enrichConnection);

        const newConnections = enriched.filter((connection) => !existingRecords.has(connection.profileKey));
        const changedConnections = enriched.filter((connection) => {
            const existing = existingRecords.get(connection.profileKey);
            if (!existing) return false;
            return existing.headline !== (connection.headline || '') ||
                existing.companyName !== (connection.companyName || '') ||
                existing.contactType !== (connection.contactType || '') ||
                existing.relevance !== connection.relevanceLabel;
        });

        console.log(`🆕 New connections: ${newConnections.length}`);
        console.log(`✏️ Updated connections: ${changedConnections.length}`);

        if (newConnections.length === 0 && changedConnections.length === 0) {
            console.log('🎉 Notion is already up to date. No new or changed connections to sync.');
        } else {
            const toSync = [...newConnections, ...changedConnections];
            const syncContext = {
                connectionCount: totalConnections || rawConnections.length,
                sentLogs: new Set(),
                syncedAtIso: new Date().toISOString()
            };
            await tracker.syncConnections(toSync, syncContext, { label: 'Fetch connections sync' });
            console.log(`✅ Synced ${toSync.length} connections to Notion.`);
        }

        writeJsonFile(SYNC_STATE_PATH, {
            lastKnownConnectionCount: totalConnections || previousKnownCount,
            lastFullFetchAt: new Date().toISOString(),
            lastFullFetchScraped: rawConnections.length,
            lastFullFetchNew: newConnections.length,
            lastFullFetchChanged: changedConnections.length
        });

        console.log('📊 Fetch summary:');
        console.log(`   • LinkedIn total : ${totalConnections || 'unknown'}`);
        console.log(`   • Scraped now    : ${rawConnections.length}`);
        console.log(`   • New added      : ${newConnections.length}`);
        console.log(`   • Updated        : ${changedConnections.length}`);
        console.log(`   • Notion rows    : ${tracker.recordsByProfileKey.size}`);
    } finally {
        await sleep(1500);
        await browser.close();
    }
}

main().catch((error) => {
    console.error('❌ Fatal error in fetchConnections:', error.message);
    console.error(error.stack);
    process.exit(1);
});
