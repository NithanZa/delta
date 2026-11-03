/** Company profile fields a clarifying question can refine. No imports: client components use this. */
export const COMPANY_FIELDS = ["description", "product", "targetCustomers", "positioning", "priorities", "constraints"] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];
