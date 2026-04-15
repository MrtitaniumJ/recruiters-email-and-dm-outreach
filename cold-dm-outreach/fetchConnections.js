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

/**
 * FETCH_MODE=latest (default): stop after no profiles absent from Notion appear for FETCH_STAGNATION_LIMIT
 *   extract cycles (after FETCH_LATEST_HEAD_STEPS). Does not backfill the full LinkedIn history.
 * FETCH_MODE=full: scroll until LinkedIn total or global list stagnation (use for one-time backfill).
 * PUPPETEER_PROTOCOL_TIMEOUT_MS: CDP timeout in ms; 0 disables (may hang). Default 600000 (10 min).
 */

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

function parseFetchMode(value) {
    const normalized = String(value || 'latest').trim().toLowerCase();
    if (normalized === 'full') return 'full';
    return 'latest';
}

function buildConfig() {
    const protocolRaw = process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS;
    let protocolTimeoutMs = 600000;
    if (protocolRaw !== undefined && String(protocolRaw).trim() !== '') {
        const parsed = Number(protocolRaw);
        protocolTimeoutMs = Number.isFinite(parsed) ? parsed : 600000;
    }

    return {
        liAt: process.env.LI_AT ? process.env.LI_AT.replace(/['"]/g, '').trim() : '',
        headless: parseBoolean(process.env.HEADLESS, false),
        navigationTimeoutMs: Number(process.env.NAVIGATION_TIMEOUT_MS || 45000),
        maxScrollSteps: Number(process.env.FETCH_MAX_SCROLL_STEPS || 800),
        stagnationLimit: Number(process.env.FETCH_STAGNATION_LIMIT || 15),
        scrollDelayMs: Number(process.env.FETCH_SCROLL_DELAY_MS || 1400),
        hardCapConnections: Number(process.env.FETCH_HARD_CAP || 6000),
        fetchMode: parseFetchMode(process.env.FETCH_MODE),
        latestHeadSteps: Number(process.env.FETCH_LATEST_HEAD_STEPS || 12),
        scrollsPerExtract: Number(process.env.FETCH_SCROLLS_PER_EXTRACT || 2),
        maxComposeAnchors: Number(process.env.FETCH_MAX_COMPOSE_ANCHORS || 0),
        extractTailWindow: Number(process.env.FETCH_EXTRACT_TAIL_WINDOW || 120),
        protocolTimeoutMs
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
    const existingNotionKeys = new Set(existingRecords.keys());

    const syncState = readJsonFile(SYNC_STATE_PATH, {});
    const previousKnownCount = Number(syncState.lastKnownConnectionCount || 0);

    console.log(`⚙️ FETCH_MODE=${config.fetchMode}  protocolTimeoutMs=${config.protocolTimeoutMs}`);

    const browser = await launchBrowser({
        headless: config.headless,
        protocolTimeoutMs: config.protocolTimeoutMs
    });
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

        const targetTotal =
            config.fetchMode === 'full' && totalConnections && totalConnections < config.hardCapConnections
                ? totalConnections
                : null;

        const expectedGap =
            config.fetchMode === 'latest' && totalConnections
                ? Math.max(0, totalConnections - existingRecords.size)
                : 0;

        if (config.fetchMode === 'latest' && totalConnections) {
            if (expectedGap > 0) {
                console.log(`🧮 Gap vs Notion: ~${expectedGap} new connections to fetch (${existingRecords.size} already stored).`);
            } else {
                console.log(`✅ Notion already holds all ${totalConnections} connections — will only scan head for updates.`);
            }
        }

        const flushBatchSize = Math.max(0, Number(process.env.FETCH_FLUSH_BATCH_SIZE || 50));

        const scrollLabel =
            config.fetchMode === 'latest'
                ? 'Scrolling (latest mode: stops when gap is filled or no new-vs-Notion profiles for a streak)...'
                : 'Scrolling (full mode: toward LinkedIn total or list exhaustion)...';
        console.log(`📜 ${scrollLabel}`);

        let incrementalSyncedCount = 0;
        const onBatchFlush = async (batch) => {
            if (!batch || batch.length === 0) {
                return;
            }
            const enrichedBatch = batch.map(enrichConnection);
            const syncContext = {
                connectionCount: totalConnections || 0,
                sentLogs: new Set(),
                syncedAtIso: new Date().toISOString()
            };
            await tracker.syncConnections(enrichedBatch, syncContext, { label: 'Fetch connections incremental flush' });
            incrementalSyncedCount += enrichedBatch.length;

            for (const entry of enrichedBatch) {
                existingNotionKeys.add(entry.profileKey);
                existingRecords.set(entry.profileKey, {
                    headline: entry.headline || '',
                    companyName: entry.companyName || '',
                    contactType: entry.contactType || '',
                    relevance: entry.relevanceLabel || ''
                });
            }

            console.log(
                `💾 Flushed ${enrichedBatch.length} new connections to Notion (session total: ${incrementalSyncedCount}, Notion rows now ~${existingRecords.size}).`
            );
        };

        const collectResult = await collectAllConnections(page, {
            targetTotal,
            maxScrollSteps: config.maxScrollSteps,
            stagnationLimit: config.stagnationLimit,
            scrollDelayMs: config.scrollDelayMs,
            mode: config.fetchMode,
            existingNotionKeys,
            latestHeadSteps: config.latestHeadSteps,
            scrollsPerExtract: config.scrollsPerExtract,
            maxComposeAnchors: config.maxComposeAnchors,
            extractTailWindow: config.extractTailWindow,
            targetNewToNotion: expectedGap,
            flushBatchSize,
            onBatchFlush,
            onProgress: ({
                step,
                total,
                newCount,
                stagnant,
                unknownStagnant,
                newToNotion,
                totalScrolls
            }) => {
                if (step % 5 === 0 || newCount === 0) {
                    const tail =
                        config.fetchMode === 'latest'
                            ? ` (+${newCount}, stagnant ${stagnant}, unknownStagnant ${unknownStagnant}, newToNotion +${newToNotion}, scrolls ${totalScrolls})`
                            : ` (+${newCount}, stagnant ${stagnant}, scrolls ${totalScrolls})`;
                    console.log(
                        `   • extract ${step}: collected ${total}${totalConnections ? `/${totalConnections}` : ''}${tail}`
                    );
                }
            }
        });

        const rawConnections = collectResult.connections;
        console.log(
            `✅ Scraped ${rawConnections.length} unique connections (stop: ${collectResult.stopReason}, extract cycles ${collectResult.extractCycles}, scrolls ${collectResult.totalScrolls}).`
        );

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
            lastFetchAt: new Date().toISOString(),
            lastMode: config.fetchMode,
            lastStoppedBecause: collectResult.stopReason,
            lastExtractCycles: collectResult.extractCycles,
            lastTotalScrolls: collectResult.totalScrolls,
            lastUnknownAddedDuringRun: collectResult.totalNewToNotionAdded,
            lastFetchScraped: rawConnections.length,
            lastFetchNew: newConnections.length,
            lastFetchChanged: changedConnections.length,
            lastFullFetchAt: new Date().toISOString(),
            lastFullFetchScraped: rawConnections.length,
            lastFullFetchNew: newConnections.length,
            lastFullFetchChanged: changedConnections.length
        });

        console.log('📊 Fetch summary:');
        console.log(`   • Mode / stop    : ${config.fetchMode} / ${collectResult.stopReason}`);
        console.log(`   • LinkedIn total : ${totalConnections || 'unknown'}`);
        console.log(`   • Scraped now    : ${rawConnections.length}`);
        console.log(`   • New vs Notion  : ${collectResult.totalNewToNotionAdded} (keys absent before run)`);
        console.log(`   • Flushed live   : ${incrementalSyncedCount} (synced during scroll)`);
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
