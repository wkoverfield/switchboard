import type { UpstreamTool } from "./stdio-upstream.js";

export interface NamespacedTool {
  name: string;
  profileName: string;
  namespace: string;
  upstreamName: string;
  description?: string;
  inputSchema: UpstreamTool["inputSchema"];
  outputSchema?: UpstreamTool["outputSchema"];
  annotations?: UpstreamTool["annotations"];
  title?: string;
  _meta?: Record<string, unknown>;
}

export interface ToolRoute {
  namespacedName: string;
  profileName: string;
  upstreamName: string;
}

export function namespacedToolName(namespace: string, upstreamName: string): string {
  return `${namespace}_${upstreamName}`;
}

export function toNamespacedTool(
  profileName: string,
  namespace: string,
  tool: UpstreamTool
): NamespacedTool {
  const namespacedTool: NamespacedTool = {
    name: namespacedToolName(namespace, tool.name),
    profileName,
    namespace,
    upstreamName: tool.name,
    inputSchema: tool.inputSchema
  };

  if (tool.description) {
    namespacedTool.description = tool.description;
  }
  if (tool.outputSchema) {
    namespacedTool.outputSchema = tool.outputSchema;
  }
  if (tool.annotations) {
    namespacedTool.annotations = tool.annotations;
  }
  if (tool.title) {
    namespacedTool.title = tool.title;
  }
  if (tool._meta) {
    namespacedTool._meta = tool._meta;
  }

  return namespacedTool;
}
