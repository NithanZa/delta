import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { getCompany, listCompetitors, listQuestions } from "@/lib/queries";
import { AddCompetitorForm, CompanyForm, CompetitorDetailsForm, QuestionsForm } from "./forms";

export default function SettingsPage() {
  const company = getCompany();
  const competitors = listCompetitors().map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    website: c.website,
    description: c.description,
    questions: listQuestions(c.id).map((q) => q.text),
  }));

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="grid content-start gap-8">
        <div>
          <SectionTitle>Company profile</SectionTitle>
          <Card>
            <p className="mb-4 text-sm text-muted">Delta uses this to decide which competitor moves matter and which responses are realistic.</p>
            <CompanyForm company={company} />
          </Card>
        </div>
        <div>
          <SectionTitle>Add competitor</SectionTitle>
          <Card>
            <p className="mb-4 text-sm text-muted">
              Creates an empty workspace at <code className="rounded bg-surface-2 px-1">/c/&lt;slug&gt;</code>. Add pages from its Evidence tab, then start a run.
            </p>
            <AddCompetitorForm />
          </Card>
        </div>
      </div>
      <div>
        <SectionTitle>Competitors</SectionTitle>
        <div className="grid gap-4">
          {competitors.length === 0 && <p className="text-sm text-muted">No competitors yet. Add one on the left.</p>}
          {competitors.map((c) => (
            <Card key={c.id}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">{c.name}</h2>
                <Link href={`/c/${c.slug}`} className="text-xs text-accent underline">
                  /c/{c.slug}
                </Link>
              </div>
              <CompetitorDetailsForm competitorId={c.id} website={c.website} description={c.description} />
              <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Research questions</h3>
              <QuestionsForm competitorId={c.id} questions={c.questions} />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
