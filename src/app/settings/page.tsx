import { Card, SectionTitle } from "@/components/ui";
import { getCompany, listCompetitors, listQuestions } from "@/lib/queries";
import { CompanyForm, QuestionsForm } from "./forms";

export default function SettingsPage() {
  const company = getCompany();
  const competitors = listCompetitors().map((c) => ({ id: c.id, name: c.name, questions: listQuestions(c.id).map((q) => q.text) }));

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <SectionTitle>Company profile</SectionTitle>
        <Card>
          <p className="mb-4 text-sm text-muted">Delta uses this to decide which competitor moves matter and which responses are realistic.</p>
          <CompanyForm company={company} />
        </Card>
      </div>
      <div>
        <SectionTitle>Research questions</SectionTitle>
        <div className="grid gap-4">
          {competitors.map((c) => (
            <Card key={c.id}>
              <h2 className="mb-2 font-semibold">{c.name}</h2>
              <QuestionsForm competitorId={c.id} questions={c.questions} />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
