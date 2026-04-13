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

async function launchBrowser({ headless = false } = {}) {
    return puppeteer.launch({
        headless: headless ? 'new' : false,
        args: [
            '--disable-extensions',
            '--disable-plugins',
            '--disable-sync',
            '--disable-blink-features=AutomationControlled',
            '--no-first-run'
        ]
    });
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
                        messageUrl: link.href || ''
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
    onProgress = null
} = {}) {
    const byKey = new Map();
    let stagnant = 0;

    for (let step = 0; step < maxScrollSteps; step += 1) {
        const visible = await extractVisibleConnections(page);
        let newCount = 0;
        for (const connection of visible) {
            const key = connection.profileUrl || connection.messageUrl || connection.fullName;
            if (!byKey.has(key)) {
                byKey.set(key, connection);
                newCount += 1;
            }
        }

        if (typeof onProgress === 'function') {
            onProgress({ step: step + 1, maxScrollSteps, total: byKey.size, newCount, stagnant });
        }

        if (targetTotal && byKey.size >= targetTotal) {
            break;
        }

        if (newCount === 0) {
            stagnant += 1;
            await clickShowMoreButton(page).catch(() => {});
            if (stagnant >= stagnationLimit) {
                break;
            }
        } else {
            stagnant = 0;
        }

        await scrollOnce(page);
        await sleep(scrollDelayMs);
    }

    return Array.from(byKey.values());
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
            element.innerHTML = '';
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
