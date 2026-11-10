import { WorkspaceSettings } from "@/components/workspace-settings";

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkspaceSettings key={id} workspaceId={id} />;
}
