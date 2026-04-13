const SHORT_TEMPLATES = {
    recruiter: {
        initial: "Hi {first},\n\nI hope you're doing well. I came across your recruiting work at {company} and wanted to reach out. I'm Jatin, a Full Stack Developer with experience building production applications using React, Next.js, Node.js, TypeScript, and PostgreSQL.\n\nIf there are any software engineering openings on your team, I'd be truly grateful to be considered. Happy to share my resume whenever it helps.\n\nBest,\nJatin",
        follow_up_1: "Hi {first},\n\nJust a gentle follow-up on my earlier note. I wanted to check if {company} currently has any software engineering openings I could be considered for. I'd really appreciate any guidance, and I'm happy to share my resume whenever it helps.\n\nBest,\nJatin",
        follow_up_2: "Hi {first},\n\nOne last gentle nudge from my side. If a referral or role isn't possible at {company} right now, I completely understand — I'd still love to stay connected for any future software engineering opportunities.\n\nThanks so much for your time.\n\nBest,\nJatin"
    },
    talent_acquisition: {
        initial: "Hi {first},\n\nI hope you're doing well. I saw your talent acquisition work at {company} and wanted to get in touch. I'm Jatin, a Full Stack Developer with hands-on experience across React, Next.js, Node.js, TypeScript, and PostgreSQL, and I'm actively exploring new SDE opportunities.\n\nIf your team is hiring for software engineering roles, I'd be grateful for a chance to connect and share my background.\n\nBest,\nJatin",
        follow_up_1: "Hi {first},\n\nFollowing up on my earlier message — I wanted to check if there are any engineering roles open at {company} right now that I could be considered for. I'd really value the chance to share my resume and background.\n\nBest,\nJatin",
        follow_up_2: "Hi {first},\n\nOne final, gentle nudge. If nothing's open at {company} at the moment, no worries at all — I'd still love to stay connected for any future software engineering openings.\n\nThanks for your time.\n\nBest,\nJatin"
    },
    hr: {
        initial: "Hi {first},\n\nI hope you're doing well. I saw that you're part of the HR / people team at {company}. I'm Jatin, a Full Stack Developer with experience building production applications using React, Next.js, Node.js, TypeScript, and PostgreSQL.\n\nIf there are any software engineering openings on your team, I'd be truly grateful to be considered. Happy to share my resume whenever it helps.\n\nBest,\nJatin",
        follow_up_1: "Hi {first},\n\nJust following up on my earlier note. I wanted to check if there are any software engineering openings at {company} I could be considered for. I'd really appreciate any guidance you can share, and I'm happy to send across my resume.\n\nBest,\nJatin",
        follow_up_2: "Hi {first},\n\nOne last gentle nudge. If nothing's open at {company} right now, I completely understand — I'd love to stay connected for any future software engineering roles on your radar.\n\nThank you so much for your time.\n\nBest,\nJatin"
    },
    hiring_manager: {
        initial: "Hi {first},\n\nI hope you're doing well. I came across your profile at {company} and wanted to reach out directly. I'm Jatin, a Full Stack Developer with production experience across React, Next.js, Node.js, TypeScript, and PostgreSQL — including end-to-end features, REST APIs, and performance-sensitive UIs.\n\nIf your team is currently hiring software engineers, I'd truly appreciate the chance to introduce myself and share my work.\n\nBest,\nJatin",
        follow_up_1: "Hi {first},\n\nCircling back on my earlier note. I wanted to check if your team at {company} is currently hiring software engineers. I'd love the chance to share a short overview of my work and see if there's a fit.\n\nBest,\nJatin",
        follow_up_2: "Hi {first},\n\nOne final, gentle nudge. If the timing isn't right at {company}, I completely understand — I'd love to stay on your radar for any future software engineering roles on your team.\n\nThanks so much for your time.\n\nBest,\nJatin"
    },
    engineer: {
        initial: "Hi {first},\n\nI hope you're doing well. I noticed you're part of the engineering team at {company}, and I wanted to reach out. I'm Jatin, a Full Stack Developer with experience building production applications using React, Next.js, Node.js, TypeScript, and PostgreSQL.\n\nIf {company} is currently hiring software engineers and you're open to it, I'd be genuinely grateful for a referral. Happy to share my resume first so you can see if it's a fit.\n\nBest,\nJatin",
        follow_up_1: "Hi {first},\n\nJust a quick follow-up on my earlier note. I wanted to check if {company} is still hiring software engineers, and whether you'd be open to a referral. I'm happy to share my resume first so you can decide if it's a fit.\n\nBest,\nJatin",
        follow_up_2: "Hi {first},\n\nOne last gentle nudge from my side. I completely understand if a referral isn't feasible right now — I'd still love to stay connected for future opportunities at {company}.\n\nThanks so much for your time.\n\nBest,\nJatin"
    },
    manager: {
        initial: "Hi {first},\n\nI hope you're doing well. I came across your role at {company} and wanted to reach out. I'm Jatin, a Full Stack Developer with experience building production applications using React, Next.js, Node.js, TypeScript, and PostgreSQL.\n\nIf your team is hiring software engineers, or if you know a hiring manager I could speak with, I'd be truly grateful for a referral or a quick introduction.\n\nBest,\nJatin",
        follow_up_1: "Hi {first},\n\nFollowing up on my earlier note. I wanted to check if there are any software engineering openings at {company} right now, or anyone on the hiring side you could point me to. I'd really appreciate any guidance.\n\nBest,\nJatin",
        follow_up_2: "Hi {first},\n\nOne final, gentle nudge. If nothing's possible at {company} at the moment, I completely understand — I'd still love to stay connected for any future software engineering roles.\n\nThanks so much for your time.\n\nBest,\nJatin"
    },
    generic: {
        initial: "Hi {first},\n\nI hope you're doing well. I came across your profile at {company} and wanted to connect. I'm Jatin, a Full Stack Developer with experience building production applications using React, Next.js, Node.js, TypeScript, and PostgreSQL, and I'm currently exploring new software engineering opportunities.\n\nIf there are any relevant openings on your team, or someone you'd recommend I speak with, I'd be truly grateful.\n\nBest,\nJatin",
        follow_up_1: "Hi {first},\n\nJust a gentle follow-up on my earlier note. I wanted to check if there are any software engineering openings at {company} I could be considered for, or anyone on your team I should reach out to.\n\nBest,\nJatin",
        follow_up_2: "Hi {first},\n\nOne last gentle nudge. If nothing's open at {company} right now, no worries at all — I'd still love to stay connected for any future software engineering roles.\n\nThanks so much for your time.\n\nBest,\nJatin"
    }
};

const PLACEHOLDER_COMPANY = 'your company';

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function resolveTemplate(contactType, stage, overrides = {}) {
    const stageKey = stage === 0 ? 'initial' : stage === 1 ? 'follow_up_1' : 'follow_up_2';
    const override = overrides?.[contactType]?.[stageKey];
    if (typeof override === 'string' && override.trim()) {
        return override;
    }

    return SHORT_TEMPLATES[contactType]?.[stageKey] || SHORT_TEMPLATES.generic[stageKey];
}

function buildMessage({ connection, stage = 0, overrides }) {
    const template = resolveTemplate(connection.contactType || 'generic', stage, overrides);
    const first = cleanText(connection.firstName) || cleanText(connection.fullName).split(' ')[0] || 'there';
    const company = cleanText(connection.companyName) || PLACEHOLDER_COMPANY;

    return template
        .replace(/\\n/g, '\n')
        .replace(/{first}/g, first)
        .replace(/{name}/g, first)
        .replace(/{company}/g, company)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

module.exports = {
    SHORT_TEMPLATES,
    buildMessage,
    resolveTemplate
};
