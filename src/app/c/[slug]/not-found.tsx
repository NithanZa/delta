import { EmptyState, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <EmptyState title="No competitor with that name">
      <div className="mt-3">
        <LinkButton href="/">Back to competitors</LinkButton>
      </div>
    </EmptyState>
  );
}
