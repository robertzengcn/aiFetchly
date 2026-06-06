import * as crypto from 'crypto';

// Scoring constants
const SCORE_CONTACT_PATH = 50;
const SCORE_EMAIL_FOUND = 30;
const SCORE_HOMEPAGE = 15;
const SCORE_TITLE_RELEVANT = 15;
const SCORE_PHONE_PATTERN = 10;
const SCORE_ABOUT_SUPPORT_TEAM = 10;
const MIN_CANDIDATE_SCORE = 30;

const CONTACT_PATHS = ['contact', 'about', 'reach-us', 'get-in-touch', 'connect'];
const RELEVANT_PATHS = ['about', 'support', 'team', 'company', 'who-we-are'];
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;

export function isHomepage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '');
    return path === '' || path === '/';
  } catch {
    return false;
  }
}

export function generateContentHash(content: string): string {
  return crypto.createHash('md5').update(content.trim().toLowerCase()).digest('hex');
}

export function scoreCandidate(url: string, content: string, title: string, emails: string[]): number {
  let score = 0;
  const lowerUrl = url.toLowerCase();
  const lowerContent = content.toLowerCase();
  const lowerTitle = title.toLowerCase();

  // Contact path bonus
  if (CONTACT_PATHS.some(p => lowerUrl.includes(p))) {
    score += SCORE_CONTACT_PATH;
  }

  // Relevant path bonus
  if (RELEVANT_PATHS.some(p => lowerUrl.includes(p))) {
    score += SCORE_ABOUT_SUPPORT_TEAM;
  }

  // Email found on page
  if (emails.length > 0) {
    score += SCORE_EMAIL_FOUND;
  }

  // Homepage bonus
  if (isHomepage(url)) {
    score += SCORE_HOMEPAGE;
  }

  // Title relevance
  if (CONTACT_PATHS.some(p => lowerTitle.includes(p)) || RELEVANT_PATHS.some(p => lowerTitle.includes(p))) {
    score += SCORE_TITLE_RELEVANT;
  }

  // Phone number patterns
  const phoneMatches = lowerContent.match(PHONE_REGEX);
  if (phoneMatches && phoneMatches.length > 0) {
    score += SCORE_PHONE_PATTERN;
  }

  return score;
}

export function meetsMinimumScore(score: number): boolean {
  return score >= MIN_CANDIDATE_SCORE;
}
