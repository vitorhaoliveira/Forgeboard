import { DecideView } from "@/components/decide-view";

export default async function DecidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DecideView key={id} taskId={id} />;
}
