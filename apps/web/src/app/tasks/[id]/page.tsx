import { TaskView } from "@/components/task-view";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // key resets the view state when switching between tasks.
  return <TaskView key={id} taskId={id} />;
}
