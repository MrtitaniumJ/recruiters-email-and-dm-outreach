const RECRUITER_PATTERNS = [
    /\brecruit(er|ment|ing)?\b/i,
    /\btalent acquisition\b/i,
    /\btalent partner\b/i,
    /\btalent scout\b/i,
    /\btalent sourcer\b/i,
    /\bsourcer\b/i,
    /\bheadhunter\b/i,
    /\bcampus hiring\b/i,
    /\btech hiring\b/i,
    /\bit recruitment\b/i
];

const TA_PATTERNS = [
    /\btalent acquisition\b/i,
    /\btalent partner\b/i,
    /\btalent scout\b/i,
    /\btalent sourcer\b/i,
    /\btalent\s+(lead|specialist|consultant|manager)\b/i
];

const HR_PATTERNS = [
    /\bhuman resources?\b/i,
    /\bhr\b/i,
    /\bpeople (consultant|partner|operations|ops|team)\b/i,
    /\bpeople & culture\b/i,
    /\bpeople and culture\b/i,
    /\bhr\s+(executive|manager|generalist|business partner|bp|lead)\b/i
];

const HIRING_MANAGER_PATTERNS = [
    /\bhiring manager\b/i,
    /\bengineering manager\b/i,
    /\bhead of engineering\b/i,
    /\bvp\s+engineering\b/i,
    /\bvp\s+of\s+engineering\b/i,
    /\bdirector of engineering\b/i,
    /\bcto\b/i,
    /\bchief technology officer\b/i,
    /\btech lead\b/i,
    /\bengineering lead\b/i,
    /\bstaff engineer\b/i,
    /\bprincipal engineer\b/i
];

const ENGINEER_PATTERNS = [
    /\bsoftware (engineer|developer)\b/i,
    /\bswe\b/i,
    /\bsde\b/i,
    /\bfull[-\s]?stack\b/i,
    /\bfront[-\s]?end\b/i,
    /\bback[-\s]?end\b/i,
    /\bdeveloper\b/i,
    /\bweb developer\b/i,
    /\bapplication engineer\b/i,
    /\bplatform engineer\b/i,
    /\bdevops engineer\b/i,
    /\bsite reliability\b/i,
    /\bsre\b/i,
    /\bml engineer\b/i,
    /\bdata engineer\b/i,
    /\bandroid (engineer|developer)\b/i,
    /\bios (engineer|developer)\b/i,
    /\bmobile (engineer|developer)\b/i
];

const MANAGER_PATTERNS = [
    /\bproduct manager\b/i,
    /\bprogram manager\b/i,
    /\bproject manager\b/i,
    /\bdelivery manager\b/i,
    /\bteam lead\b/i,
    /\bmanager\b/i
];

const STRONG_NEGATIVE_PATTERNS = [
    /\bstudent\b/i,
    /\bintern(ship)?\b/i,
    /\btrainee\b/i,
    /\bfresher\b/i
];

// Pre-combine regex arrays to avoid allocating new arrays on every call to computeScore.
const STRONG_PATTERNS = [...RECRUITER_PATTERNS, ...TA_PATTERNS, ...HR_PATTERNS, ...HIRING_MANAGER_PATTERNS];
const SOFT_PATTERNS = [...ENGINEER_PATTERNS, ...MANAGER_PATTERNS];

const COMPANY_TOKEN_CLEANUP = /[•·|,()\[\]]/g;

function textOf(connection) {
    return `${connection.headline || ''} ${connection.additionalDetails || ''}`.replace(/\s+/g, ' ').trim();
}

// ⚡ Bolt: Using standard for loops instead of higher-order array methods (.some, .reduce)
// in hot loops (frequently called during classification) to improve CPU efficiency
// and avoid anonymous function allocation overhead.
function anyMatch(text, patterns) {
    for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].test(text)) {
            return true;
        }
    }
    return false;
}

function countMatches(text, patterns) {
    let count = 0;
    for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].test(text)) {
            count++;
        }
    }
    return count;
}

function classifyContactType(connection) {
    const text = textOf(connection).toLowerCase();

    if (!text) {
        return 'generic';
    }

    if (anyMatch(text, STRONG_NEGATIVE_PATTERNS)) {
        return 'generic';
    }

    if (anyMatch(text, TA_PATTERNS)) {
        return 'talent_acquisition';
    }
    if (anyMatch(text, RECRUITER_PATTERNS)) {
        return 'recruiter';
    }
    if (anyMatch(text, HR_PATTERNS)) {
        return 'hr';
    }
    if (anyMatch(text, HIRING_MANAGER_PATTERNS)) {
        return 'hiring_manager';
    }
    if (anyMatch(text, ENGINEER_PATTERNS)) {
        return 'engineer';
    }
    if (anyMatch(text, MANAGER_PATTERNS)) {
        return 'manager';
    }

    return 'generic';
}

const PRIORITY_ORDER = {
    recruiter: 100,
    talent_acquisition: 100,
    hr: 85,
    hiring_manager: 90,
    engineer: 70,
    manager: 55,
    generic: 10
};

function priorityFor(contactType) {
    return PRIORITY_ORDER[contactType] ?? 0;
}

function computeRelevance(contactType) {
    if (['recruiter', 'talent_acquisition', 'hr', 'hiring_manager'].includes(contactType)) {
        return 'Strong Match';
    }
    if (['engineer', 'manager'].includes(contactType)) {
        return 'Possible Match';
    }
    return 'Not Relevant';
}

function computeScore(connection) {
    const text = textOf(connection);
    const strong = countMatches(text, STRONG_PATTERNS);
    const soft = countMatches(text, SOFT_PATTERNS);
    const negative = countMatches(text, STRONG_NEGATIVE_PATTERNS);
    return (strong * 3) + soft - (negative * 2);
}

function annotateClassification(connection) {
    const contactType = classifyContactType(connection);
    const relevanceLabel = computeRelevance(contactType);
    const matchScore = computeScore(connection);
    const priority = priorityFor(contactType);

    return {
        ...connection,
        contactType,
        templateVariant: contactType,
        relevanceLabel,
        matchScore,
        priority
    };
}

function cleanCompanyGuess(value) {
    return String(value || '')
        .replace(COMPANY_TOKEN_CLEANUP, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

module.exports = {
    anyMatch,
    classifyContactType,
    computeRelevance,
    computeScore,
    priorityFor,
    annotateClassification,
    cleanCompanyGuess,
    PRIORITY_ORDER
};
