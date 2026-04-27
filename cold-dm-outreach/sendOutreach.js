const fs = require('fs');
const path = require('path');

const {
    launchBrowser,
    ensureLinkedInSession,
    sendMessageToProfile,
    sleep,
    randomBetween
} = require('./linkedinClient');
const { createNotionTracker } = require('./notionTracker');
const { priorityFor } = require('./outreachClassifier');
const { buildMessage } = require('./outreachTemplates');

require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: false });

const OUTREACH_LOG_PATH = path.join(__dirname, 'outreach_run_log.json');

function parseBoolean(value, fallback) {
    if (value === undefined) {
        return fallback;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return fallback;
}

function writeJsonFile(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function daysSince(iso) {
    if (!iso) return Infinity;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return Infinity;
    return (Date.now() - then) / (1000 * 60 * 60 * 24);
}

function buildConfig() {
    return {
        dryRun: parseBoolean(process.env.DRY_RUN, false),
        liAt: process.env.LI_AT ? process.env.LI_AT.replace(/['"]/g, '').trim() : '',
        headless: parseBoolean(process.env.HEADLESS, false),
        navigationTimeoutMs: Number(process.env.NAVIGATION_TIMEOUT_MS || 45000),
        dailyCap: Number(process.env.OUTREACH_DAILY_CAP || 30),
        initialMinShare: Number(process.env.OUTREACH_INITIAL_SHARE || 0.65),
        minDelayMs: Number(process.env.OUTREACH_MIN_DELAY_MS || 60000),
        maxDelayMs: Number(process.env.OUTREACH_MAX_DELAY_MS || 150000),
        longBreakEvery: Number(process.env.OUTREACH_LONG_BREAK_EVERY || 10),
        longBreakMinMs: Number(process.env.OUTREACH_LONG_BREAK_MIN_MS || 180000),
        longBreakMaxMs: Number(process.env.OUTREACH_LONG_BREAK_MAX_MS || 300000),
        followUpGapDays: Number(process.env.OUTREACH_FOLLOWUP_GAP_DAYS || 5),
        secondFollowUpGapDays: Number(process.env.OUTREACH_FOLLOWUP2_GAP_DAYS || 7),
        replyDetection: parseBoolean(process.env.OUTREACH_REPLY_DETECTION, true),
        allowedContactTypes: (process.env.OUTREACH_ALLOWED_TYPES || 'recruiter,talent_acquisition,hr,hiring_manager,engineer,manager')
            .split(',').map((item) => item.trim()).filter(Boolean)
    };
}

function isEligibleForInitial(record, allowed) {
    if (record.replied) return false;
    if (!record.messageUrl && !record.profileUrl) return false;
    if (!allowed.includes(record.contactType)) return false;
    const status = record.outreachStatus || 'Pending';
    if (['Messaged', 'Followed Up', 'Replied', 'Skipped', 'Do Not Message', 'Already Messaged'].includes(status)) return false;
    return true;
}

function isEligibleForFollowUp(record, allowed, config) {
    if (record.replied) return false;
    if (!record.messageUrl && !record.profileUrl) return false;
    if (!allowed.includes(record.contactType)) return false;
    const status = record.outreachStatus || '';

    if (status === 'Messaged' && (record.followUpStage || 0) === 0) {
        return daysSince(record.lastMessagedAt) >= config.followUpGapDays;
    }
    if (status === 'Followed Up' && (record.followUpStage || 0) === 1) {
        return daysSince(record.lastFollowUpAt || record.lastMessagedAt) >= config.secondFollowUpGapDays;
    }
    return false;
}

function nextStageFor(record) {
    const current = record.followUpStage || 0;
    return Math.min(current + 1, 2);
}

function sortByPriority(a, b) {
    const priorityDelta = priorityFor(b.contactType) - priorityFor(a.contactType);
    if (priorityDelta !== 0) return priorityDelta;
    const scoreDelta = (b.matchScore || 0) - (a.matchScore || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return String(a.name || '').localeCompare(String(b.name || ''));
}

function buildQueue(records, config) {
    const initial = [];
    const followUps = [];

    for (const record of records.values()) {
        if (isEligibleForInitial(record, config.allowedContactTypes)) {
            initial.push({ ...record, stage: 0 });
        } else if (isEligibleForFollowUp(record, config.allowedContactTypes, config)) {
            followUps.push({ ...record, stage: nextStageFor(record) });
        }
    }

    initial.sort(sortByPriority);
    followUps.sort(sortByPriority);

    const followUpTarget = Math.max(1, Math.round(config.dailyCap * (1 - config.initialMinShare)));
    const initialTarget = Math.max(0, config.dailyCap - followUpTarget);

    const selectedInitial = initial.slice(0, initialTarget);
    const selectedFollowUps = followUps.slice(0, followUpTarget);

    let combined = [...selectedInitial, ...selectedFollowUps];
    if (combined.length < config.dailyCap) {
        const deficit = config.dailyCap - combined.length;
        const remainingInitial = initial.slice(selectedInitial.length, selectedInitial.length + deficit);
        combined = [...combined, ...remainingInitial];
    }
    if (combined.length < config.dailyCap) {
        const deficit = config.dailyCap - combined.length;
        const remainingFollowUps = followUps.slice(selectedFollowUps.length, selectedFollowUps.length + deficit);
        combined = [...combined, ...remainingFollowUps];
    }

    return {
        queue: combined.slice(0, config.dailyCap),
        stats: {
            pendingInitial: initial.length,
            pendingFollowUps: followUps.length,
            selectedInitial: Math.min(selectedInitial.length, combined.length),
            selectedFollowUps: Math.min(selectedFollowUps.length, combined.length)
        }
    };
}

function candidateFromRecord(record) {
    return {
        fullName: record.name || '',
        firstName: record.firstName || (record.name || '').split(' ')[0] || '',
        profileUrl: record.profileUrl || '',
        messageUrl: record.messageUrl || record.profileUrl || '',
        headline: record.headline || '',
        companyName: record.companyName || '',
        contactType: record.contactType || 'generic',
        profileKey: record.profileKey
    };
}

async function main() {
    const config = buildConfig();
    if (!config.liAt) {
        console.error('❌ LI_AT cookie missing in cold-dm-outreach/.env');
        process.exit(1);
    }

    console.log('🚀 SEND OUTREACH DMs');
    console.log(`🕐 ${new Date().toISOString()}`);
    console.log(`🎯 Daily cap: ${config.dailyCap} | Initial share: ${Math.round(config.initialMinShare * 100)}%`);
    console.log(`🔁 Follow-up gaps: initial→FU1 = ${config.followUpGapDays}d, FU1→FU2 = ${config.secondFollowUpGapDays}d`);

    const projectRoot = path.resolve(__dirname, '..');
    const tracker = createNotionTracker({ projectRoot, baseDir: __dirname, env: process.env });
    if (!tracker.enabled) {
        console.error('❌ Notion tracker is not configured.');
        process.exit(1);
    }

    console.log('🗂️ Loading Notion records...');
    await tracker.ensureDatabase();
    const records = await tracker.loadRecords();
    console.log(`🗂️ Loaded ${records.size} connection rows from Notion.`);

    const { queue, stats } = buildQueue(records, config);

    console.log(`📬 Queue summary:`);
    console.log(`   • Eligible for initial  : ${stats.pendingInitial}`);
    console.log(`   • Eligible for follow-up: ${stats.pendingFollowUps}`);
    console.log(`   • Queued this run       : ${queue.length}`);

    if (queue.length === 0) {
        console.log('🎉 Nothing to message right now. Your outreach queue is empty.');
        console.log('💡 Tip: run fetch_latest_connections.bat to discover more leads.');
        return;
    }

    queue.forEach((entry, index) => {
        console.log(`${index + 1}. [${entry.stage === 0 ? 'INITIAL' : `FOLLOW-UP ${entry.stage}`}] ${entry.name} — ${entry.contactType} @ ${entry.companyName || 'unknown'}`);
    });

    if (config.dryRun) {
        console.log('\n[DRY_RUN=true] Printing messages only, no sends.');
        queue.forEach((entry) => {
            const candidate = candidateFromRecord(entry);
            const msg = buildMessage({ connection: candidate, stage: entry.stage });
            console.log(`\n— ${entry.name} [stage ${entry.stage}] —\n${msg}`);
        });
        return;
    }

    console.log('\n🌐 Launching LinkedIn session...');
    const browser = await launchBrowser({ headless: config.headless });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });

    const runLog = {
        startedAt: new Date().toISOString(),
        sent: [],
        followUps: [],
        skipped: [],
        failed: [],
        replies: []
    };

    try {
        const session = await ensureLinkedInSession(page, config.liAt, { navigationTimeoutMs: config.navigationTimeoutMs });
        console.log(`✅ Session ready: ${session.title}`);

        for (let index = 0; index < queue.length; index += 1) {
            const entry = queue[index];
            const candidate = candidateFromRecord(entry);
            const message = buildMessage({ connection: candidate, stage: entry.stage });

            console.log(`\n[${index + 1}/${queue.length}] 🎯 ${entry.name} (${entry.contactType}, stage ${entry.stage})`);
            console.log(`   Company: ${entry.companyName || 'unknown'}`);
            console.log(`   Msg: ${message.slice(0, 110)}${message.length > 110 ? '…' : ''}`);

            if (!candidate.messageUrl) {
                console.log('   ⚠️ No message URL available, skipping.');
                runLog.skipped.push({ name: entry.name, reason: 'no_message_url' });
                continue;
            }

            try {
                const result = await sendMessageToProfile(page, candidate, message, {
                    navigationTimeoutMs: config.navigationTimeoutMs,
                    replyDetection: config.replyDetection && entry.stage >= 1
                });

                if (!result.sent && result.reason === 'reply_detected') {
                    console.log('   💬 Reply detected in thread — marking as Replied, no message sent.');
                    await tracker.markReplied(entry, `Reply detected on ${new Date().toISOString().split('T')[0]}`).catch(e => console.error(`      ⚠️ Failed to mark as replied in tracker: ${e.message}`));
                    runLog.replies.push({ name: entry.name });
                } else {
                    console.log('   ✅ Message sent');
                    const status = entry.stage === 0 ? 'Messaged' : 'Followed Up';
                    const note = entry.stage === 0
                        ? `Initial message sent on ${new Date().toISOString().split('T')[0]} (${entry.contactType}).`
                        : `Follow-up ${entry.stage} sent on ${new Date().toISOString().split('T')[0]}.`;

                    await tracker.recordOutreachResult(entry, {
                        status,
                        stage: entry.stage,
                        sentAtIso: new Date().toISOString(),
                        note
                    });

                    if (entry.stage === 0) {
                        runLog.sent.push({ name: entry.name, contactType: entry.contactType });
                    } else {
                        runLog.followUps.push({ name: entry.name, stage: entry.stage });
                    }
                }
            } catch (error) {
                console.log(`   ❌ Failed: ${error.message}`);
                runLog.failed.push({ name: entry.name, reason: error.message });
                await tracker.recordOutreachResult(entry, {
                    status: 'Failed',
                    stage: entry.stage,
                    failed: true,
                    note: `Failed on ${new Date().toISOString().split('T')[0]}: ${String(error.message).slice(0, 200)}`
                }).catch(e => console.error(`      ⚠️ Failed to record outreach result in tracker: ${e.message}`));
            }

            if (index < queue.length - 1) {
                const isLongBreak = config.longBreakEvery > 0 && (index + 1) % config.longBreakEvery === 0;
                const waitMs = isLongBreak
                    ? randomBetween(config.longBreakMinMs, config.longBreakMaxMs)
                    : randomBetween(config.minDelayMs, config.maxDelayMs);
                console.log(`   ⏳ Waiting ${Math.round(waitMs / 1000)}s${isLongBreak ? ' (long break)' : ''}...`);
                await sleep(waitMs);
            }
        }

        runLog.finishedAt = new Date().toISOString();
        writeJsonFile(OUTREACH_LOG_PATH, runLog);

        console.log('\n' + '='.repeat(50));
        console.log('✅ Outreach run complete');
        console.log(`   Initial sent : ${runLog.sent.length}`);
        console.log(`   Follow-ups   : ${runLog.followUps.length}`);
        console.log(`   Replies found: ${runLog.replies.length}`);
        console.log(`   Failed       : ${runLog.failed.length}`);
        console.log(`   Skipped      : ${runLog.skipped.length}`);
        console.log(`📝 Run log written to ${OUTREACH_LOG_PATH}`);
    } finally {
        await sleep(2000);
        await browser.close();
    }
}

main().catch((error) => {
    console.error('❌ Fatal error in sendOutreach:', error.message);
    console.error(error.stack);
    process.exit(1);
});
