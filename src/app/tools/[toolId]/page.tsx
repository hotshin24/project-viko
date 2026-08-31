import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlatformHeader } from "../../../components/platform-header";
import { getTool, TOOL_REGISTRY } from "../../../lib/tools/registry";

type ToolPageProps = { params: Promise<{ toolId: string }> };
export function generateStaticParams() {
  return TOOL_REGISTRY.filter((tool) => tool.status === "available").map(
    (tool) => ({ toolId: tool.id }),
  );
}
function availableTool(id: string) {
  const tool = getTool(id);
  if (!tool || tool.status !== "available") notFound();
  return tool;
}
export async function generateMetadata({
  params,
}: ToolPageProps): Promise<Metadata> {
  const tool = availableTool((await params).toolId);
  return {
    title: `${tool.name} · VIKO Localize`,
    description: tool.description,
  };
}
export default async function ToolPage({ params }: ToolPageProps) {
  const tool = availableTool((await params).toolId);
  const Workspace = await tool.loadWorkspace();
  return (
    <>
      <PlatformHeader toolName={tool.name} />
      <Workspace toolName={tool.name} />
    </>
  );
}
