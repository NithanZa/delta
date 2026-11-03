/** Tunable cut-offs for ranking and the digest content model (phase 12 adjusts these after the rehearsal). */

/** Two active insights on the same hypothesis set with title similarity at or above this are the same topic. */
export const DEDUPE_JACCARD = 0.6;
/** A hypothesis confidence move at or above this counts as news. */
export const HYPOTHESIS_MOVE_MIN = 0.1;
/** Insights below this score stay out of the digest's top list. */
export const TOP_INSIGHT_MIN_SCORE = 0.45;
export const TOP_INSIGHTS_MAX = 3;
/** Change facts at or above this importance keep a period from being quiet. */
export const CHANGE_IMPORTANCE_MIN = 4;
/** Insights written before scoring existed are treated as having this score. */
export const UNSCORED_INSIGHT_SCORE = 0.5;
/** The most each email section shows per competitor, however busy the week was. */
export const EMAIL_INSIGHTS_MAX = 2;
export const EMAIL_MOVES_MAX = 2;
export const EMAIL_CHANGES_MAX = 3;
export const EMAIL_CONFLICTS_MAX = 1;
/** A brand-new hypothesis needs at least this confidence to reach the email. */
export const NEW_HYPOTHESIS_MIN_CONFIDENCE = 0.6;
/**
 * "More in Delta" counts only what clears these. They are deliberately high, so the line is rare.
 * Insight scores skew high (median about 0.8), hence the need for high severity as well as 0.9.
 */
export const INSIGHT_VERY_IMPORTANT_SCORE = 0.9;
export const MOVE_VERY_IMPORTANT = 0.2;
export const NEW_HYPOTHESIS_VERY_CONFIDENT = 0.8;
export const CHANGE_VERY_IMPORTANT = 5;
/** Every Nth digest asks the pilot's one question. */
export const DECISION_QUESTION_EVERY = 4;
