import { WorkspaceDesk } from "@/components/workspace-desk";

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ repo?: string }>;
}) {
  const { id } = await params;
  const { repo } = await searchParams;
  return <WorkspaceDesk key={id} workspaceId={id} repoFilter={repo} />;
}
