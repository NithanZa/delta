import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Company, Competitor, ResearchQuestion } from "@/db/schema";

/** The company-side context every prompt receives. */
export type CompanyContext = {
  company: Company;
  competitor: Competitor;
  questions: ResearchQuestion[];
};

export function loadCompanyContext(db: Db, competitorId: number): CompanyContext {
  const company = db.select().from(schema.company).get();
  if (!company) throw new Error("No company profile. Run `npm run seed` or fill in Settings.");
  const competitor = db.select().from(schema.competitors).where(eq(schema.competitors.id, competitorId)).get();
  if (!competitor) throw new Error(`Competitor ${competitorId} not found`);
  const questions = db.select().from(schema.researchQuestions).where(eq(schema.researchQuestions.competitorId, competitorId)).all();
  return { company, competitor, questions };
}

export function formatCompanyContext(ctx: CompanyContext): string {
  const c = ctx.company;
  const lines: (string | false)[] = [
    `## Our company: ${c.name}`,
    c.description && `Description: ${c.description}`,
    c.product && `Product: ${c.product}`,
    c.targetCustomers && `Target customers: ${c.targetCustomers}`,
    c.positioning && `Positioning: ${c.positioning}`,
    c.priorities && `Priorities: ${c.priorities}`,
    c.constraints && `Constraints: ${c.constraints}`,
    "",
    `## Competitor being researched: ${ctx.competitor.name}`,
    ctx.competitor.website && `Website: ${ctx.competitor.website}`,
    ctx.competitor.description && `Known context: ${ctx.competitor.description}`,
    "",
    "## Research questions",
    ...ctx.questions.map((q, i) => `Q${i + 1}. ${q.text}`),
  ];
  return lines.filter((l): l is string => typeof l === "string").join("\n");
}
