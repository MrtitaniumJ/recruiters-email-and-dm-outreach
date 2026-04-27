const fs = require('fs');
const path = require('path');

const NOTION_VERSION = '2022-06-28';
const DATABASE_TITLE = 'LinkedIn Connections Tracker';
const MUTATION_DELAY_MS = 500;
const PROTECTED_OUTREACH_STATUSES = new Set(['Messaged', 'Followed Up', 'Replied', 'Skipped', 'Do Not Message']);
const TRACKER_PROPERTY_DEFINITIONS = {
    Name: { title: {} },
    'First Name': { rich_text: {} },
    'Profile Key': { rich_text: {} },
    'Profile URL': { url: {} },
    'Message URL': { url: {} },
    Company: { rich_text: {} },
    'Contact Type': {
        select: {
            options: [
                { name: 'recruiter', color: 'blue' },
                { name: 'talent_acquisition', color: 'green' },
                { name: 'hr', color: 'yellow' },
                { name: 'hiring_manager', color: 'purple' },
                { name: 'engineer', color: 'pink' },
                { name: 'manager', color: 'orange' },
                { name: 'generic', color: 'gray' }
            ]
        }
    },
    'Template Variant': { rich_text: {} },
    Headline: { rich_text: {} },
    'Additional Details': { rich_text: {} },
    'Connected On Raw': { rich_text: {} },
    'Connected On': { date: {} },
    Relevance: {
        select: {
            options: [
                { name: 'Strong Match', color: 'green' },
                { name: 'Possible Match', color: 'yellow' },
                { name: 'Not Relevant', color: 'gray' }
            ]
        }
    },
    'Match Score': { number: {} },
    'Match Reason': { rich_text: {} },
    'Careers URL': { url: {} },
    'Job Match Status': {
        select: {
            options: [
                { name: 'Open Roles Found', color: 'green' },
                { name: 'No Matching Roles Found', color: 'yellow' },
                { name: 'Not Configured', color: 'gray' },
                { name: 'Unknown Company', color: 'gray' },
                { name: 'Check Failed', color: 'red' }
            ]
        }
    },
    'Job Match Keywords': { rich_text: {} },
    'Job Match Notes': { rich_text: {} },
    'Last Job Check At': { date: {} },
    'Outreach Status': {
        select: {
            options: [
                { name: 'Pending', color: 'blue' },
                { name: 'Messaged', color: 'green' },
                { name: 'Already Messaged', color: 'yellow' },
                { name: 'Followed Up', color: 'blue' },
                { name: 'Replied', color: 'purple' },
                { name: 'Skipped', color: 'orange' },
                { name: 'Do Not Message', color: 'red' },
                { name: 'Review', color: 'gray' },
                { name: 'Failed', color: 'pink' }
            ]
        }
    },
    'Last Synced At': { date: {} },
    'Last Messaged At': { date: {} },
    'Last Follow Up At': { date: {} },
    'Follow Up Stage': { number: {} },
    'Replied': { checkbox: {} },
    'Message Attempts': { number: {} },
    'Connection Count Snapshot': { number: {} },
    Source: { rich_text: {} },
    Notes: { rich_text: {} }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function truncate(text, maxLength = 1900) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 3)}...`;
}

function titleProperty(content) {
    const normalized = truncate(content, 1900);
    return {
        title: normalized
            ? [{ type: 'text', text: { content: normalized } }]
            : []
    };
}

function richTextProperty(content) {
    const normalized = truncate(content, 1900);
    return {
        rich_text: normalized
            ? [{ type: 'text', text: { content: normalized } }]
            : []
    };
}

function dateProperty(value) {
    return {
        date: value ? { start: value } : null
    };
}

function selectProperty(name) {
    return {
        select: name ? { name } : null
    };
}

function numberProperty(value) {
    return {
        number: Number.isFinite(value) ? value : null
    };
}

function urlProperty(value) {
    return {
        url: value || null
    };
}

function checkboxProperty(value) {
    return { checkbox: Boolean(value) };
}

function richTextArray(content) {
    const normalized = truncate(content, 1800);
    return normalized
        ? [{ type: 'text', text: { content: normalized } }]
        : [];
}

function getTitleText(property) {
    return property?.title?.[0]?.plain_text || '';
}

function getRichText(property) {
    return property?.rich_text?.map((entry) => entry.plain_text).join('') || '';
}

function getSelectName(property) {
    return property?.select?.name || '';
}

function getDateValue(property) {
    return property?.date?.start || '';
}

function getNumberValue(property) {
    return Number(property?.number || 0);
}

function getUrlValue(property) {
    return property?.url || '';
}

function readFileIfExists(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8').trim();
    } catch (error) {
        return '';
    }
}

function readLegacyNotionSetup(projectRoot) {
    let token = '';
    let seedDatabaseId = '';

    try {
        const rootIndex = fs.readFileSync(path.join(projectRoot, 'index.js'), 'utf8');
        const tokenMatch = rootIndex.match(/const NOTION_TOKEN = '([^']+)'/);
        token = tokenMatch?.[1] || '';
    } catch (error) {
        token = '';
    }

    seedDatabaseId = readFileIfExists(path.join(projectRoot, 'db_id.txt'));

    return { token, seedDatabaseId };
}

class NotionTracker {
    constructor({
        projectRoot,
        token,
        trackerDbId,
        trackerDbIdFilePath,
        parentPageId,
        seedDatabaseId
    }) {
        this.projectRoot = projectRoot;
        this.token = token;
        this.trackerDbId = trackerDbId;
        this.trackerDbIdFilePath = trackerDbIdFilePath;
        this.parentPageId = parentPageId;
        this.seedDatabaseId = seedDatabaseId;
        this.recordsByProfileKey = new Map();
    }

    get enabled() {
        return Boolean(this.token);
    }

    async request(apiPath, method, body = null) {
        const retriableStatuses = new Set([408, 409, 429, 500, 502, 503, 504]);

        for (let attempt = 1; attempt <= 5; attempt += 1) {
            const response = await fetch(`https://api.notion.com/v1${apiPath}`, {
                method,
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Notion-Version': NOTION_VERSION,
                    'Content-Type': 'application/json'
                },
                body: body ? JSON.stringify(body) : undefined
            });

            const rawText = await response.text();
            let data = null;

            try {
                data = rawText ? JSON.parse(rawText) : {};
            } catch (error) {
                if (attempt < 5) {
                    await sleep(1000 * attempt);
                    continue;
                }

                throw new Error(`Notion returned a non-JSON response (${response.status}): ${truncate(rawText, 160)}`);
            }

            if (response.ok) {
                return data;
            }

            if (retriableStatuses.has(response.status) && attempt < 5) {
                await sleep(1000 * attempt);
                continue;
            }

            throw new Error(`Notion API Error (${response.status}): ${data.message}`);
        }

        throw new Error('Notion request exhausted all retries.');
    }

    async ensureDatabase() {
        if (!this.enabled) {
            return null;
        }

        if (!this.trackerDbId) {
            this.trackerDbId = readFileIfExists(this.trackerDbIdFilePath);
        }

        if (this.trackerDbId) {
            await this.ensureDatabaseSchema();
            return this.trackerDbId;
        }

        if (!this.parentPageId) {
            this.parentPageId = await this.resolveParentPageId();
        }

        const created = await this.request('/databases', 'POST', {
            parent: {
                type: 'page_id',
                page_id: this.parentPageId
            },
            title: [{ type: 'text', text: { content: DATABASE_TITLE } }],
            properties: TRACKER_PROPERTY_DEFINITIONS
        });

        this.trackerDbId = created.id;
        fs.writeFileSync(this.trackerDbIdFilePath, this.trackerDbId);
        await this.ensureDatabaseSchema();
        return this.trackerDbId;
    }

    async ensureDatabaseSchema() {
        if (!this.trackerDbId) {
            return;
        }

        const database = await this.request(`/databases/${this.trackerDbId}`, 'GET');
        const existingProperties = database.properties || {};
        const missingProperties = {};

        for (const [propertyName, definition] of Object.entries(TRACKER_PROPERTY_DEFINITIONS)) {
            if (!existingProperties[propertyName]) {
                missingProperties[propertyName] = definition;
            }
        }

        if (Object.keys(missingProperties).length === 0) {
            return;
        }

        await this.request(`/databases/${this.trackerDbId}`, 'PATCH', {
            properties: missingProperties
        });
    }

    async resolveParentPageId() {
        if (this.parentPageId) {
            return this.parentPageId;
        }

        if (!this.seedDatabaseId) {
            throw new Error('Could not determine a parent Notion page. Configure LINKEDIN_NOTION_PARENT_PAGE_ID or keep db_id.txt available.');
        }

        const seedDatabase = await this.request(`/databases/${this.seedDatabaseId}`, 'GET');
        const pageId = seedDatabase?.parent?.page_id;
        if (!pageId) {
            throw new Error('Existing Notion database does not expose a page_id parent, so a LinkedIn tracker database cannot be created automatically.');
        }

        this.parentPageId = pageId;
        return pageId;
    }

    async loadRecords() {
        const databaseId = await this.ensureDatabase();
        const recordsByProfileKey = new Map();
        let cursor = null;

        do {
            const payload = cursor ? { start_cursor: cursor } : {};
            const response = await this.request(`/databases/${databaseId}/query`, 'POST', payload);

            for (const page of response.results || []) {
                const properties = page.properties || {};
                const profileKey = getRichText(properties['Profile Key']);
                if (!profileKey) {
                    continue;
                }

                recordsByProfileKey.set(profileKey, {
                    pageId: page.id,
                    profileKey,
                    name: getTitleText(properties.Name),
                    firstName: getRichText(properties['First Name']),
                    profileUrl: getUrlValue(properties['Profile URL']),
                    messageUrl: getUrlValue(properties['Message URL']),
                    companyName: getRichText(properties.Company),
                    contactType: getSelectName(properties['Contact Type']),
                    templateVariant: getRichText(properties['Template Variant']),
                    headline: getRichText(properties.Headline),
                    additionalDetails: getRichText(properties['Additional Details']),
                    connectedOnRaw: getRichText(properties['Connected On Raw']),
                    connectedOnDate: getDateValue(properties['Connected On']),
                    outreachStatus: getSelectName(properties['Outreach Status']),
                    relevance: getSelectName(properties.Relevance),
                    matchScore: getNumberValue(properties['Match Score']),
                    matchReason: getRichText(properties['Match Reason']),
                    careersUrl: getUrlValue(properties['Careers URL']),
                    jobMatchStatus: getSelectName(properties['Job Match Status']),
                    jobMatchKeywords: getRichText(properties['Job Match Keywords']),
                    jobMatchNotes: getRichText(properties['Job Match Notes']),
                    lastJobCheckAt: getDateValue(properties['Last Job Check At']),
                    messageAttempts: getNumberValue(properties['Message Attempts']),
                    notes: getRichText(properties.Notes),
                    lastMessagedAt: getDateValue(properties['Last Messaged At']),
                    lastFollowUpAt: getDateValue(properties['Last Follow Up At']),
                    followUpStage: getNumberValue(properties['Follow Up Stage']),
                    replied: Boolean(properties['Replied']?.checkbox)
                });
            }

            cursor = response.has_more ? response.next_cursor : null;
        } while (cursor);

        this.recordsByProfileKey = recordsByProfileKey;
        return recordsByProfileKey;
    }

    determineOutreachStatus(connection, existingRecord, sentLogs) {
        if (existingRecord?.outreachStatus && PROTECTED_OUTREACH_STATUSES.has(existingRecord.outreachStatus)) {
            return existingRecord.outreachStatus;
        }

        if (sentLogs.has(connection.fullName)) {
            return existingRecord?.outreachStatus === 'Messaged' ? 'Messaged' : 'Already Messaged';
        }

        if (connection.relevanceLabel === 'Not Relevant') {
            return 'Review';
        }

        return 'Pending';
    }

    buildSyncProperties(connection, context, existingRecord) {
        const outreachStatus = this.determineOutreachStatus(connection, existingRecord, context.sentLogs);

        return {
            Name: titleProperty(connection.fullName),
            'First Name': richTextProperty(connection.firstName),
            'Profile Key': richTextProperty(connection.profileKey),
            'Profile URL': urlProperty(connection.profileUrl),
            'Message URL': urlProperty(connection.messageUrl),
            Company: richTextProperty(connection.companyName),
            'Contact Type': selectProperty(connection.contactType),
            'Template Variant': richTextProperty(connection.templateVariant),
            Headline: richTextProperty(connection.headline),
            'Additional Details': richTextProperty(connection.additionalDetails),
            'Connected On Raw': richTextProperty(connection.connectedOnRaw),
            'Connected On': dateProperty(connection.connectedOnDate),
            Relevance: selectProperty(connection.relevanceLabel),
            'Match Score': numberProperty(connection.matchScore),
            'Match Reason': richTextProperty(connection.matchReason),
            'Careers URL': urlProperty(connection.careersUrl),
            'Job Match Status': selectProperty(connection.jobMatchStatus),
            'Job Match Keywords': richTextProperty((connection.jobMatchKeywords || []).join(', ')),
            'Job Match Notes': richTextProperty(connection.jobMatchNotes),
            'Last Job Check At': dateProperty(connection.lastJobCheckAt),
            'Outreach Status': selectProperty(outreachStatus),
            'Last Synced At': dateProperty(context.syncedAtIso),
            'Connection Count Snapshot': numberProperty(context.connectionCount),
            Source: richTextProperty('LinkedIn Connections')
        };
    }

    shouldUpdateExistingRecord(existingRecord, connection, outreachStatus) {
        if (!existingRecord) {
            return true;
        }

        return existingRecord.name !== connection.fullName ||
            existingRecord.firstName !== connection.firstName ||
            existingRecord.profileUrl !== (connection.profileUrl || '') ||
            existingRecord.messageUrl !== (connection.messageUrl || '') ||
            existingRecord.companyName !== (connection.companyName || '') ||
            existingRecord.contactType !== (connection.contactType || '') ||
            existingRecord.templateVariant !== (connection.templateVariant || '') ||
            existingRecord.headline !== (connection.headline || '') ||
            existingRecord.additionalDetails !== (connection.additionalDetails || '') ||
            existingRecord.connectedOnRaw !== (connection.connectedOnRaw || '') ||
            existingRecord.connectedOnDate !== (connection.connectedOnDate || '') ||
            existingRecord.relevance !== connection.relevanceLabel ||
            existingRecord.matchScore !== connection.matchScore ||
            existingRecord.matchReason !== (connection.matchReason || '') ||
            existingRecord.careersUrl !== (connection.careersUrl || '') ||
            existingRecord.jobMatchStatus !== (connection.jobMatchStatus || '') ||
            existingRecord.jobMatchKeywords !== ((connection.jobMatchKeywords || []).join(', ')) ||
            existingRecord.jobMatchNotes !== (connection.jobMatchNotes || '') ||
            existingRecord.lastJobCheckAt !== (connection.lastJobCheckAt || '') ||
            existingRecord.outreachStatus !== outreachStatus;
    }

    async syncConnections(connections, context, options = {}) {
        if (!this.enabled) {
            return this.recordsByProfileKey;
        }

        if (this.recordsByProfileKey.size === 0) {
            await this.loadRecords();
        }

        const databaseId = await this.ensureDatabase();
        const label = options.label || 'Notion sync';
        let processed = 0;
        let created = 0;
        let updated = 0;
        let skipped = 0;

        if (connections.length > 0) {
            console.log(`🗂️ ${label}: syncing ${connections.length} connections...`);
        }

        for (const connection of connections) {
            const existingRecord = this.recordsByProfileKey.get(connection.profileKey);
            const properties = this.buildSyncProperties(connection, context, existingRecord);
            const outreachStatus = getSelectName(properties['Outreach Status']);

            try {
                if (!this.shouldUpdateExistingRecord(existingRecord, connection, outreachStatus)) {
                    skipped += 1;
                } else if (existingRecord) {
                    await this.request(`/pages/${existingRecord.pageId}`, 'PATCH', { properties });
                    updated += 1;
                } else {
                    const createdPage = await this.request('/pages', 'POST', {
                        parent: {
                            database_id: databaseId
                        },
                        properties: {
                            ...properties,
                            'Message Attempts': numberProperty(0),
                            'Last Messaged At': dateProperty(null),
                            Notes: richTextProperty('')
                        }
                    });

                    this.recordsByProfileKey.set(connection.profileKey, {
                        pageId: createdPage.id,
                        profileKey: connection.profileKey,
                        name: connection.fullName,
                        firstName: connection.firstName,
                        profileUrl: connection.profileUrl || '',
                        messageUrl: connection.messageUrl || '',
                        companyName: connection.companyName || '',
                        contactType: connection.contactType || '',
                        templateVariant: connection.templateVariant || '',
                        headline: connection.headline || '',
                        additionalDetails: connection.additionalDetails || '',
                        connectedOnRaw: connection.connectedOnRaw || '',
                        connectedOnDate: connection.connectedOnDate || '',
                        outreachStatus,
                        relevance: connection.relevanceLabel,
                        matchScore: connection.matchScore,
                        matchReason: connection.matchReason || '',
                        careersUrl: connection.careersUrl || '',
                        jobMatchStatus: connection.jobMatchStatus || '',
                        jobMatchKeywords: (connection.jobMatchKeywords || []).join(', '),
                        jobMatchNotes: connection.jobMatchNotes || '',
                        lastJobCheckAt: connection.lastJobCheckAt || '',
                        messageAttempts: 0,
                        notes: '',
                        lastMessagedAt: ''
                    });

                    created += 1;
                    await sleep(MUTATION_DELAY_MS);
                    processed += 1;
                    if (processed === 1 || processed % 10 === 0 || processed === connections.length) {
                        console.log(`   • ${label}: ${processed}/${connections.length} processed (created ${created}, updated ${updated}, skipped ${skipped})`);
                    }
                    continue;
                }

                if (existingRecord) {
                    this.recordsByProfileKey.set(connection.profileKey, {
                        pageId: existingRecord.pageId,
                        profileKey: connection.profileKey,
                        name: connection.fullName,
                        firstName: connection.firstName,
                        profileUrl: connection.profileUrl || '',
                        messageUrl: connection.messageUrl || '',
                        companyName: connection.companyName || '',
                        contactType: connection.contactType || '',
                        templateVariant: connection.templateVariant || '',
                        headline: connection.headline || '',
                        additionalDetails: connection.additionalDetails || '',
                        connectedOnRaw: connection.connectedOnRaw || '',
                        connectedOnDate: connection.connectedOnDate || '',
                        outreachStatus,
                        relevance: connection.relevanceLabel,
                        matchScore: connection.matchScore,
                        matchReason: connection.matchReason || '',
                        careersUrl: connection.careersUrl || '',
                        jobMatchStatus: connection.jobMatchStatus || '',
                        jobMatchKeywords: (connection.jobMatchKeywords || []).join(', '),
                        jobMatchNotes: connection.jobMatchNotes || '',
                        lastJobCheckAt: connection.lastJobCheckAt || '',
                        messageAttempts: existingRecord.messageAttempts || 0,
                        notes: existingRecord.notes || '',
                        lastMessagedAt: existingRecord.lastMessagedAt || ''
                    });
                }

                await sleep(MUTATION_DELAY_MS);
            } catch (error) {
                console.warn(`⚠️ Notion sync skipped ${connection.fullName}: ${error.message}`);
            }

            processed += 1;
            if (processed === 1 || processed % 10 === 0 || processed === connections.length) {
                console.log(`   • ${label}: ${processed}/${connections.length} processed (created ${created}, updated ${updated}, skipped ${skipped})`);
            }
        }

        return this.recordsByProfileKey;
    }

    async updateMessageResult(connection, { status, note, sentAtIso, failed = false }) {
        if (!this.enabled) {
            return;
        }

        const existingRecord = this.recordsByProfileKey.get(connection.profileKey);
        if (!existingRecord) {
            return;
        }

        const nextAttempts = failed
            ? existingRecord.messageAttempts || 0
            : (existingRecord.messageAttempts || 0) + 1;

        const properties = {
            'Outreach Status': selectProperty(status),
            Notes: richTextProperty(note || existingRecord.notes || ''),
            'Message Attempts': numberProperty(nextAttempts)
        };

        if (sentAtIso) {
            properties['Last Messaged At'] = dateProperty(sentAtIso);
        }

        await this.request(`/pages/${existingRecord.pageId}`, 'PATCH', { properties });
        await sleep(MUTATION_DELAY_MS);

        this.recordsByProfileKey.set(connection.profileKey, {
            ...existingRecord,
            outreachStatus: status,
            messageAttempts: nextAttempts,
            notes: note || existingRecord.notes || '',
            lastMessagedAt: sentAtIso || existingRecord.lastMessagedAt || ''
        });
    }

    async recordOutreachResult(record, {
        status,
        stage = 0,
        sentAtIso,
        note,
        replied = false,
        failed = false
    }) {
        if (!this.enabled || !record?.pageId) {
            return;
        }

        const nextAttempts = failed
            ? record.messageAttempts || 0
            : (record.messageAttempts || 0) + 1;
        const properties = {
            'Outreach Status': selectProperty(status),
            'Message Attempts': numberProperty(nextAttempts),
            Notes: richTextProperty(note || record.notes || ''),
            Replied: checkboxProperty(replied)
        };

        if (!failed) {
            if (stage === 0 && sentAtIso) {
                properties['Last Messaged At'] = dateProperty(sentAtIso);
            }
            if (stage >= 1 && sentAtIso) {
                properties['Last Follow Up At'] = dateProperty(sentAtIso);
            }
            properties['Follow Up Stage'] = numberProperty(stage);
        }

        await this.request(`/pages/${record.pageId}`, 'PATCH', { properties });
        await sleep(MUTATION_DELAY_MS);

        this.recordsByProfileKey.set(record.profileKey, {
            ...record,
            outreachStatus: status,
            messageAttempts: nextAttempts,
            notes: note || record.notes || '',
            replied,
            followUpStage: failed ? (record.followUpStage || 0) : stage,
            lastMessagedAt: !failed && stage === 0 && sentAtIso ? sentAtIso : record.lastMessagedAt || '',
            lastFollowUpAt: !failed && stage >= 1 && sentAtIso ? sentAtIso : record.lastFollowUpAt || ''
        });
    }

    async markReplied(record, note) {
        if (!this.enabled || !record?.pageId) {
            return;
        }

        await this.request(`/pages/${record.pageId}`, 'PATCH', {
            properties: {
                'Outreach Status': selectProperty('Replied'),
                Replied: checkboxProperty(true),
                Notes: richTextProperty(note || record.notes || 'Reply detected in thread.')
            }
        });
        await sleep(MUTATION_DELAY_MS);

        this.recordsByProfileKey.set(record.profileKey, {
            ...record,
            outreachStatus: 'Replied',
            replied: true,
            notes: note || record.notes || 'Reply detected in thread.'
        });
    }

    async createDigestPage({ title, markdown }) {
        if (!this.enabled) {
            return null;
        }

        const parentPageId = await this.resolveParentPageId();
        const blocks = markdown
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 90)
            .map((line) => {
                if (line.startsWith('## ')) {
                    return {
                        object: 'block',
                        type: 'heading_2',
                        heading_2: { rich_text: richTextArray(line.slice(3)) }
                    };
                }

                if (line.startsWith('# ')) {
                    return {
                        object: 'block',
                        type: 'heading_1',
                        heading_1: { rich_text: richTextArray(line.slice(2)) }
                    };
                }

                if (line.startsWith('- ')) {
                    return {
                        object: 'block',
                        type: 'bulleted_list_item',
                        bulleted_list_item: { rich_text: richTextArray(line.slice(2)) }
                    };
                }

                return {
                    object: 'block',
                    type: 'paragraph',
                    paragraph: { rich_text: richTextArray(line) }
                };
            });

        return this.request('/pages', 'POST', {
            parent: {
                type: 'page_id',
                page_id: parentPageId
            },
            properties: {
                title: richTextArray(title)
            },
            children: blocks
        });
    }
}

function createNotionTracker({ projectRoot, baseDir, env }) {
    const legacy = readLegacyNotionSetup(projectRoot);
    const token = env.NOTION_TOKEN || legacy.token;
    const trackerDbIdFilePath = path.join(baseDir, 'linkedin_notion_db_id.txt');
    const trackerDbId = env.LINKEDIN_NOTION_DB_ID || readFileIfExists(trackerDbIdFilePath);
    const parentPageId = env.LINKEDIN_NOTION_PARENT_PAGE_ID || '';
    const seedDatabaseId = env.LINKEDIN_NOTION_SEED_DATABASE_ID || legacy.seedDatabaseId;

    return new NotionTracker({
        projectRoot,
        token,
        trackerDbId,
        trackerDbIdFilePath,
        parentPageId,
        seedDatabaseId
    });
}

module.exports = {
    readFileIfExists,
    createNotionTracker,
    readLegacyNotionSetup
};
