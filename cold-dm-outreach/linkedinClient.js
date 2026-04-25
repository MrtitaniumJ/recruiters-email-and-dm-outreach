const puppeteer = require('puppeteer');

const LINKEDIN_BASE_URL = 'https://www.linkedin.com';
const CONNECTIONS_URL = `${LINKEDIN_BASE_URL}/mynetwork/invite-connect/connections/`;

const COMPOSER_SELECTORS = [
    'div.msg-form__contenteditable[role="textbox"]',
    'div.msg-form__contenteditable',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="Write a message"]',
    'textarea'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function launchBrowser({ headless = false, protocolTimeoutMs } = {}) {
    const launchOptions = {
        headless: headless ? 'new' : false,
        args: [
            '--disable-extensions',
            '--disable-plugins',
            '--disable-sync',
            '--disable-blink-features=AutomationControlled',
            '--no-first-run'
        ]
    };

    if (protocolTimeoutMs !== undefined && protocolTimeoutMs !== null) {
        const parsed = Number(protocolTimeoutMs);
        if (parsed === 0 || Number.isFinite(parsed)) {
            launchOptions.protocolTimeout = parsed;
        }
    }

    return puppeteer.launch(launchOptions);
}

async function ensureLinkedInSession(page, liAt, { navigationTimeoutMs = 30000, targetUrl = CONNECTIONS_URL } = {}) {
    await page.setCookie({
        name: 'li_at',
        value: liAt,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true
    });

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
    await sleep(4000);

    const sessionState = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const url = location.href.toLowerCase();
        const loginDetected = url.includes('/login') ||
            url.includes('/checkpoint/') ||
            bodyText.includes('sign in') ||
            bodyText.includes('join linkedin');

        return { url: location.href, title: document.title, loginDetected };
    });

    if (sessionState.loginDetected) {
        throw new Error('LinkedIn session is not authenticated. Refresh the LI_AT cookie in cold-dm-outreach/.env.');
    }

    return sessionState;
}

async function extractTotalConnectionCount(page) {
    return page.evaluate(() => {
        const text = document.body?.innerText || '';
        const match = text.match(/([\d,]+)\s+connections?/i);
        if (!match) {
            return null;
        }

        const value = Number(match[1].replace(/,/g, ''));
        return Number.isFinite(value) ? value : null;
    });
}

async function extractVisibleConnections(page, { maxComposeAnchors = 0, tailWindow = 0 } = {}) {
    return page.evaluate(({ linkedinBaseUrl, maxComposeAnchors: maxAnchors, tailWindow: tailLimit }) => {
        const rxMessage = /^message$/i;
        const rxConnected = /^connected on /i;

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

                let messageLineCount = 0;
                let connectedLineCount = 0;
                for (let i = 0; i < lines.length; i++) {
                    if (rxMessage.test(lines[i])) {
                        messageLineCount++;
                    } else if (rxConnected.test(lines[i])) {
                        connectedLineCount++;
                    }
                }

                if (messageLineCount !== 1) {
                    continue;
                }

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
                        messageUrl: link.href || ''
                    };
                }
            }

            return bestMatch;
        }

        const connections = [];
        const seenKeys = new Set();

        const allComposeLinks = Array.from(document.querySelectorAll('a[href*="/messaging/compose/"]'));
        let messageLinks = allComposeLinks;

        // Tail-only window keeps the per-cycle DOM walk bounded even when the
        // mounted connection list grows into the thousands. New cards always
        // appear at the bottom as we scroll, so scanning the tail is enough.
        if (tailLimit > 0 && allComposeLinks.length > tailLimit) {
            messageLinks = allComposeLinks.slice(-tailLimit);
        } else if (maxAnchors > 0 && allComposeLinks.length > maxAnchors) {
            const headCount = Math.ceil(maxAnchors / 2);
            const tailCount = maxAnchors - headCount;
            const picked = new Set();
            allComposeLinks.slice(0, headCount).forEach((link) => picked.add(link));
            allComposeLinks.slice(-tailCount).forEach((link) => picked.add(link));
            messageLinks = Array.from(picked);
        }

        messageLinks.forEach((messageLink) => {
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
                .filter((line) => !rxConnected.test(line) && !rxMessage.test(line));
            const connectedOnRaw = card.lines.find((line) => rxConnected.test(line)) || '';
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
    }, {
        linkedinBaseUrl: LINKEDIN_BASE_URL,
        maxComposeAnchors: maxComposeAnchors || 0,
        tailWindow: tailWindow || 0
    });
}

async function scrollOnce(page) {
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
}

async function clickShowMoreButton(page) {
    return page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const target = buttons.find((button) => {
            const text = (button.innerText || button.textContent || '').trim().toLowerCase();
            return /show more results|see more/.test(text) && !button.disabled;
        });

        if (!target) {
            return false;
        }

        target.scrollIntoView({ block: 'center' });
        target.click();
        return true;
    });
}

async function collectAllConnections(page, {
    targetTotal = null,
    maxScrollSteps = 800,
    stagnationLimit = 12,
    scrollDelayMs = 1400,
    onProgress = null,
    mode = 'full',
    existingNotionKeys = null,
    latestHeadSteps = 0,
    scrollsPerExtract = 1,
    maxComposeAnchors = 0,
    extractTailWindow = 0,
    targetNewToNotion = 0,
    flushBatchSize = 0,
    onBatchFlush = null
} = {}) {
    const byKey = new Map();
    let stagnant = 0;
    let unknownStagnant = 0;
    let extractCycle = 0;
    let totalScrolls = 0;
    let stopReason = 'max_scroll_steps';
    let totalNewToNotionAdded = 0;
    const notionKeys = existingNotionKeys instanceof Set ? existingNotionKeys : null;
    const incremental = mode === 'latest' && notionKeys;
    const scrollBatch = Math.max(1, Number(scrollsPerExtract) || 1);
    const headFloor = Math.max(0, Number(latestHeadSteps) || 0);
    const extractOpts = {
        maxComposeAnchors: Number(maxComposeAnchors) || 0,
        tailWindow: Math.max(0, Number(extractTailWindow) || 0)
    };
    const flushThreshold = Math.max(0, Number(flushBatchSize) || 0);
    const targetNewGoal = Math.max(0, Number(targetNewToNotion) || 0);
    let pendingFlush = [];

    const flushNow = async (reason) => {
        if (typeof onBatchFlush !== 'function' || pendingFlush.length === 0) {
            return;
        }
        const batch = pendingFlush;
        pendingFlush = [];
        try {
            await onBatchFlush(batch, { reason });
        } catch (flushError) {
            // Re-queue so we don't silently lose rows, then rethrow.
            pendingFlush = batch.concat(pendingFlush);
            throw flushError;
        }
    };

    while (extractCycle < maxScrollSteps) {
        extractCycle += 1;
        const visible = await extractVisibleConnections(page, extractOpts);
        let newCount = 0;
        let newToNotion = 0;

        for (const connection of visible) {
            const key = connection.profileUrl || connection.messageUrl || connection.fullName;
            if (!byKey.has(key)) {
                byKey.set(key, connection);
                newCount += 1;
                if (!notionKeys || !notionKeys.has(key)) {
                    newToNotion += 1;
                    pendingFlush.push(connection);
                }
            }
        }

        totalNewToNotionAdded += newToNotion;

        if (incremental && extractCycle >= headFloor) {
            if (newToNotion === 0) {
                unknownStagnant += 1;
            } else {
                unknownStagnant = 0;
            }
        }

        if (typeof onProgress === 'function') {
            onProgress({
                step: extractCycle,
                maxScrollSteps,
                total: byKey.size,
                newCount,
                stagnant,
                unknownStagnant,
                newToNotion,
                totalScrolls
            });
        }

        if (flushThreshold > 0 && pendingFlush.length >= flushThreshold) {
            await flushNow('batch_size');
        }

        if (targetTotal && byKey.size >= targetTotal) {
            await flushNow('target_total_reached');
            stopReason = 'target_total_reached';
            break;
        }

        if (targetNewGoal > 0 && totalNewToNotionAdded >= targetNewGoal) {
            await flushNow('target_new_to_notion_reached');
            stopReason = 'target_new_to_notion_reached';
            break;
        }

        // Only honor the "known head streak" stop when we do NOT have a definite
        // Notion gap to close. If expectedGap > 0, the missing profiles can live
        // anywhere below the already-synced head — we must keep scrolling until
        // either the gap is filled or the list is genuinely exhausted.
        if (
            incremental &&
            targetNewGoal === 0 &&
            extractCycle >= headFloor &&
            unknownStagnant >= stagnationLimit
        ) {
            await flushNow('latest_unknown_stagnation');
            stopReason = 'latest_unknown_stagnation';
            break;
        }

        if (newCount === 0) {
            stagnant += 1;
            await clickShowMoreButton(page).catch(() => {});
            if (stagnant >= stagnationLimit) {
                await flushNow('global_stagnation');
                stopReason = 'global_stagnation';
                break;
            }
        } else {
            stagnant = 0;
        }

        for (let s = 0; s < scrollBatch; s += 1) {
            await scrollOnce(page);
            totalScrolls += 1;
        }

        await sleep(scrollDelayMs);
    }

    await flushNow(stopReason);

    return {
        connections: Array.from(byKey.values()),
        stopReason,
        extractCycles: extractCycle,
        totalScrolls,
        totalNewToNotionAdded
    };
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

async function detectExistingReply(page) {
    return page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.msg-s-message-list__event, li.msg-s-message-list__event'));
        if (items.length === 0) {
            return { hasMessages: false, lastFromOther: false };
        }

        const last = items[items.length - 1];
        const senderText = (last.innerText || '').toLowerCase();
        const lastFromOther = !senderText.includes('you ') && !senderText.startsWith('you');
        return { hasMessages: true, lastFromOther };
    }).catch(() => ({ hasMessages: false, lastFromOther: false }));
}

async function sendMessageToProfile(page, profile, message, { navigationTimeoutMs = 30000, replyDetection = false } = {}) {
    await page.goto(profile.messageUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
    await sleep(5000);

    if (replyDetection) {
        const replyState = await detectExistingReply(page);
        if (replyState.hasMessages && replyState.lastFromOther) {
            return { sent: false, reason: 'reply_detected' };
        }
    }

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

    return { sent: true };
}

async function returnToConnections(page, { navigationTimeoutMs = 30000 } = {}) {
    await page.goto(CONNECTIONS_URL, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
    await sleep(3000);
}

module.exports = {
    LINKEDIN_BASE_URL,
    CONNECTIONS_URL,
    sleep,
    randomBetween,
    launchBrowser,
    ensureLinkedInSession,
    extractTotalConnectionCount,
    extractVisibleConnections,
    collectAllConnections,
    sendMessageToProfile,
    returnToConnections,
    detectExistingReply
};
