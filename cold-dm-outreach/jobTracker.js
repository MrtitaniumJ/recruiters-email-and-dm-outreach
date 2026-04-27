const fs = require('fs');
const path = require('path');

const { readLegacyNotionSetup } = require('./notionTracker');

const NOTION_VERSION = '2022-06-28';
const DATABASE_TITLE = 'Daily Job Applications Tracker';
const MUTATION_DELAY_MS = 500;
const PROTECTED_STATUSES = new Set(['Applied', 'Already Applied', 'Skipped']);
const TRACKER_PROPERTY_DEFINITIONS = {
    Role: { title: {} },
    Company: { rich_text: {} },
    'Job Key': { rich_text: {} },
    'Job URL': { url: {} },
    'Apply URL': { url: {} },
    'Source Page': { url: {} },
    Location: { rich_text: {} },
    Department: { rich_text: {} },
    'Employment Type': { rich_text: {} },
    ATS: {
        select: {
            options: [
                { name: 'greenhouse', color: 'green' },
                { name: 'lever', color: 'blue' },
                { name: 'workday', color: 'purple' },
                { name: 'ashby', color: 'yellow' },
                { name: 'smartrecruiters', color: 'orange' },
                { name: 'generic', color: 'gray' },
                { name: 'unknown', color: 'gray' }
            ]
        }
    },
    Fit: {
        select: {
            options: [
                { name: 'High Fit', color: 'green' },
                { name: 'Possible Fit', color: 'yellow' },
                { name: 'Low Fit', color: 'gray' }
            ]
        }
    },
    'Match Score': { number: {} },
    'Matched Keywords': { rich_text: {} },
    Status: {
        select: {
            options: [
                { name: 'New', color: 'blue' },
                { name: 'Review', color: 'yellow' },
                { name: 'Applying', color: 'orange' },
                { name: 'Applied', color: 'green' },
                { name: 'Already Applied', color: 'purple' },
                { name: 'Unsupported', color: 'gray' },
                { name: 'Skipped', color: 'gray' },
                { name: 'Failed', color: 'red' }
            ]
        }
    },
    'Application Mode': {
        select: {
            options: [
                { name: 'discover_only', color: 'gray' },
                { name: 'guarded_auto_apply', color: 'orange' }
            ]
        }
    },
    'First Seen At': { date: {} },
    'Last Seen At': { date: {} },
    'Last Applied At': { date: {} },
    'Resume Path': { rich_text: {} },
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

function urlProperty(content) {
    return {
        url: content || null
    };
}

function numberProperty(value) {
    return {
        number: Number.isFinite(value) ? value : null
    };
}

function dateProperty(value) {
    return {
        date: value ? { start: value } : null
    };
}

function selectProperty(value) {
    return {
        select: value ? { name: value } : null
    };
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

function readFileIfExists(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8').trim();
    } catch (error) {
        return '';
    }
}

class JobTracker {
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
        this.recordsByJobKey = new Map();
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
            throw new Error('Could not determine a parent Notion page for the job tracker.');
        }

        const seedDatabase = await this.request(`/databases/${this.seedDatabaseId}`, 'GET');
        const pageId = seedDatabase?.parent?.page_id;
        if (!pageId) {
            throw new Error('Existing Notion database does not expose a page parent for the job tracker.');
        }

        this.parentPageId = pageId;
        return pageId;
    }

    async loadRecords() {
        if (!this.enabled) {
            return this.recordsByJobKey;
        }

        const databaseId = await this.ensureDatabase();
        const recordsByJobKey = new Map();
        let cursor = null;

        do {
            const payload = cursor ? { start_cursor: cursor } : {};
            const response = await this.request(`/databases/${databaseId}/query`, 'POST', payload);

            for (const page of response.results || []) {
                const properties = page.properties || {};
                const jobKey = getRichText(properties['Job Key']);
                if (!jobKey) {
                    continue;
                }

                recordsByJobKey.set(jobKey, {
                    pageId: page.id,
                    jobKey,
                    title: getTitleText(properties.Role),
                    company: getRichText(properties.Company),
                    status: getSelectName(properties.Status),
                    firstSeenAt: getDateValue(properties['First Seen At']),
                    lastSeenAt: getDateValue(properties['Last Seen At']),
                    lastAppliedAt: getDateValue(properties['Last Applied At']),
                    notes: getRichText(properties.Notes)
                });
            }

            cursor = response.has_more ? response.next_cursor : null;
        } while (cursor);

        this.recordsByJobKey = recordsByJobKey;
        return recordsByJobKey;
    }

    determineStatus(job, existingRecord) {
        if (existingRecord?.status && PROTECTED_STATUSES.has(existingRecord.status)) {
            return existingRecord.status;
        }

        if (job.application?.status) {
            return job.application.status;
        }

        if (!job.isRelevant) {
            return 'Skipped';
        }

        if (!job.isNew) {
            return existingRecord?.status || 'Review';
        }

        if (job.shouldAttemptApply) {
            return 'Applying';
        }

        if (job.applySupport?.reason === 'Unsupported ATS') {
            return 'Unsupported';
        }

        return 'Review';
    }

    buildProperties(job, context, existingRecord) {
        const status = this.determineStatus(job, existingRecord);

        return {
            Role: titleProperty(job.title),
            Company: richTextProperty(job.company),
            'Job Key': richTextProperty(job.jobKey),
            'Job URL': urlProperty(job.url),
            'Apply URL': urlProperty(job.applyUrl || job.url),
            'Source Page': urlProperty(job.sourcePageUrl),
            Location: richTextProperty(job.location),
            Department: richTextProperty(job.department),
            'Employment Type': richTextProperty(job.employmentType),
            ATS: selectProperty(job.ats),
            Fit: selectProperty(job.fitLabel),
            'Match Score': numberProperty(job.matchScore),
            'Matched Keywords': richTextProperty((job.matchedKeywords || []).join(', ')),
            Status: selectProperty(status),
            'Application Mode': selectProperty(context.applicationMode),
            'First Seen At': dateProperty(existingRecord?.firstSeenAt || context.runDateIso),
            'Last Seen At': dateProperty(context.runDateIso),
            'Resume Path': richTextProperty(context.resumePath),
            Notes: richTextProperty(job.application?.note || job.note || existingRecord?.notes || '')
        };
    }

    shouldUpdateExistingRecord(existingRecord, job, status) {
        if (!existingRecord) {
            return true;
        }

        return existingRecord.title !== job.title ||
            existingRecord.company !== job.company ||
            existingRecord.status !== status ||
            existingRecord.lastSeenAt !== job.runDateIso ||
            existingRecord.notes !== (job.application?.note || job.note || '');
    }

    async syncJobs(jobs, context) {
        if (!this.enabled) {
            return this.recordsByJobKey;
        }

        if (this.recordsByJobKey.size === 0) {
            await this.loadRecords();
        }

        const databaseId = await this.ensureDatabase();
        let processed = 0;
        let created = 0;
        let updated = 0;
        let skipped = 0;

        if (jobs.length > 0) {
            console.log(`🗂️ Job tracker sync: syncing ${jobs.length} jobs...`);
        }

        for (const job of jobs) {
            const existingRecord = this.recordsByJobKey.get(job.jobKey);
            const properties = this.buildProperties(job, context, existingRecord);
            const status = getSelectName(properties.Status);
            const shouldUpdate = this.shouldUpdateExistingRecord(existingRecord, { ...job, runDateIso: context.runDateIso }, status);

            try {
                if (!shouldUpdate) {
                    skipped += 1;
                } else if (existingRecord) {
                    await this.request(`/pages/${existingRecord.pageId}`, 'PATCH', { properties });
                    updated += 1;
                } else {
                    const createdPage = await this.request('/pages', 'POST', {
                        parent: {
                            database_id: databaseId
                        },
                        properties
                    });

                    this.recordsByJobKey.set(job.jobKey, {
                        pageId: createdPage.id,
                        jobKey: job.jobKey,
                        title: job.title,
                        company: job.company,
                        status,
                        firstSeenAt: context.runDateIso,
                        lastSeenAt: context.runDateIso,
                        lastAppliedAt: '',
                        notes: job.application?.note || job.note || ''
                    });
                    created += 1;
                    await sleep(MUTATION_DELAY_MS);
                    processed += 1;
                    if (processed === 1 || processed % 10 === 0 || processed === jobs.length) {
                        console.log(`   • Job tracker: ${processed}/${jobs.length} processed (created ${created}, updated ${updated}, skipped ${skipped})`);
                    }
                    continue;
                }

                if (existingRecord) {
                    this.recordsByJobKey.set(job.jobKey, {
                        ...existingRecord,
                        title: job.title,
                        company: job.company,
                        status,
                        lastSeenAt: context.runDateIso,
                        notes: job.application?.note || job.note || existingRecord.notes || ''
                    });
                }

                await sleep(MUTATION_DELAY_MS);
            } catch (error) {
                console.warn(`⚠️ Job tracker sync skipped ${job.title} at ${job.company}: ${error.message}`);
            }

            processed += 1;
            if (processed === 1 || processed % 10 === 0 || processed === jobs.length) {
                console.log(`   • Job tracker: ${processed}/${jobs.length} processed (created ${created}, updated ${updated}, skipped ${skipped})`);
            }
        }

        return this.recordsByJobKey;
    }

    async updateApplicationResult(job, result, runDateIso) {
        if (!this.enabled) {
            return;
        }

        const existingRecord = this.recordsByJobKey.get(job.jobKey);
        if (!existingRecord) {
            return;
        }

        const properties = {
            Status: selectProperty(result.status),
            Notes: richTextProperty(result.note || existingRecord.notes || '')
        };

        if (result.status === 'Applied') {
            properties['Last Applied At'] = dateProperty(runDateIso);
        }

        await this.request(`/pages/${existingRecord.pageId}`, 'PATCH', { properties });
        await sleep(MUTATION_DELAY_MS);

        this.recordsByJobKey.set(job.jobKey, {
            ...existingRecord,
            status: result.status,
            notes: result.note || existingRecord.notes || '',
            lastAppliedAt: result.status === 'Applied' ? runDateIso : existingRecord.lastAppliedAt || ''
        });
    }

    async bulkUpdateApplicationResults(results, runDateIso) {
        if (!this.enabled || !results || results.length === 0) {
            return;
        }

        const CONCURRENCY = 5;
        for (let i = 0; i < results.length; i += CONCURRENCY) {
            const chunk = results.slice(i, i + CONCURRENCY);
            await Promise.all(chunk.map(async ({ job, result }) => {
                try {
                    await this.updateApplicationResult(job, result, runDateIso);
                } catch (error) {
                    console.warn(`⚠️ Failed to update Notion application result for ${job.title}: ${error.message}`);
                }
            }));
        }
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

function createJobTracker({ projectRoot, baseDir, env }) {
    const notionDisabled = ['true', '1', 'yes', 'y'].includes(String(env.JOB_NOTION_DISABLED || '').trim().toLowerCase());
    const legacy = readLegacyNotionSetup(projectRoot);
    const token = notionDisabled ? '' : (env.NOTION_TOKEN || legacy.token);
    const trackerDbIdFilePath = path.join(baseDir, 'job_notion_db_id.txt');
    const trackerDbId = env.JOB_NOTION_DB_ID || readFileIfExists(trackerDbIdFilePath);
    const parentPageId = env.JOB_NOTION_PARENT_PAGE_ID || env.LINKEDIN_NOTION_PARENT_PAGE_ID || '';
    const seedDatabaseId = env.JOB_NOTION_SEED_DATABASE_ID || legacy.seedDatabaseId;

    return new JobTracker({
        projectRoot,
        token,
        trackerDbId,
        trackerDbIdFilePath,
        parentPageId,
        seedDatabaseId
    });
}

module.exports = {
    createJobTracker
};
