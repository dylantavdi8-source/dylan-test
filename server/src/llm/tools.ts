import { z } from "zod";
import type { ToolDefinition } from "./client.js";
import type { AgentRole } from "../types.js";

// Every tool an agent might be granted, as an Anthropic tool JSON-schema definition
// plus a matching zod schema used to validate/parse the model's tool_use input at
// runtime (models occasionally emit malformed input; we never trust it blindly).

export const TOOL_SCHEMAS: Record<string, ToolDefinition> = {
  create_plan: {
    name: "create_plan",
    description:
      "Break the user's request into a task graph assigned to specialist agents. Only include agents that are actually needed " +
      "for this request -- do not add research/design/testing tasks the request doesn't call for. If the request is trivial " +
      "enough to answer directly with no specialist work (e.g. a simple factual question), leave tasks empty and set direct_answer instead.",
    input_schema: {
      type: "object",
      properties: {
        direct_answer: {
          type: "string",
          description: "A complete answer to give the user immediately, only used when tasks is empty.",
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Short unique slug, e.g. 'research-1'" },
              title: { type: "string" },
              agent_role: {
                type: "string",
                enum: ["research", "coding", "design", "testing", "review"],
              },
              instructions: { type: "string", description: "Precise instructions for the assigned agent." },
              depends_on: {
                type: "array",
                items: { type: "string" },
                description: "IDs of tasks that must complete before this one can start.",
              },
            },
            required: ["id", "title", "agent_role", "instructions", "depends_on"],
          },
        },
      },
      required: ["tasks"],
    },
  },

  write_file: {
    name: "write_file",
    description: "Write (create or overwrite) a file in the shared project workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within the workspace, e.g. 'src/index.js'" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },

  read_file: {
    name: "read_file",
    description: "Read a file from the shared project workspace.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },

  list_files: {
    name: "list_files",
    description: "List all files currently in the shared project workspace.",
    input_schema: { type: "object", properties: {} },
  },

  run_command: {
    name: "run_command",
    description:
      "Actually execute a real command in the workspace (e.g. to run a test suite or a script) and get back its real " +
      "stdout, stderr, and exit code. Only a fixed allow-list of interpreters/test runners is permitted. You MUST use this " +
      "tool to verify anything before claiming it works -- never report a test result you did not actually observe here.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The binary to run, e.g. 'node', 'npm', 'python3', 'pytest'." },
        args: { type: "array", items: { type: "string" } },
      },
      required: ["command", "args"],
    },
  },

  handoff: {
    name: "handoff",
    description:
      "Hand this task's work off to another specialist agent as a new follow-up task (e.g. coding hands off to testing " +
      "once code is written). The target agent will receive your message plus everything produced so far.",
    input_schema: {
      type: "object",
      properties: {
        to_agent: { type: "string", enum: ["research", "coding", "design", "testing", "review"] },
        message: { type: "string", description: "What you want the next agent to do, and any context they need." },
      },
      required: ["to_agent", "message"],
    },
  },

  flag_issue: {
    name: "flag_issue",
    description:
      "Reject/challenge another task's output because it has a problem. This sends that task back for a retry with your " +
      "feedback attached. Use this when reviewing or testing reveals a real defect -- be specific about what is wrong.",
    input_schema: {
      type: "object",
      properties: {
        target_task_id: { type: "string", description: "The id of the task whose output is defective." },
        message: { type: "string", description: "Specific, actionable description of what is wrong." },
        severity: { type: "string", enum: ["minor", "blocking"] },
      },
      required: ["target_task_id", "message", "severity"],
    },
  },

  finish_task: {
    name: "finish_task",
    description: "Mark your current task complete and record its final output for downstream agents / the final result.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two sentence summary of what you did." },
        output: { type: "string", description: "The full output/result of this task (code excerpt references, findings, verdict, etc.)." },
      },
      required: ["summary", "output"],
    },
  },

  finish_run: {
    name: "finish_run",
    description:
      "Only call this once all necessary work is complete and (if code was involved) has been reviewed and actually tested. " +
      "Produces the final polished response returned to the user.",
    input_schema: {
      type: "object",
      properties: {
        final_result: { type: "string", description: "Polished, complete final answer for the user in markdown." },
      },
      required: ["final_result"],
    },
  },
};

export const TOOLS_BY_ROLE: Record<AgentRole, string[]> = {
  manager: ["create_plan", "list_files", "read_file", "flag_issue", "finish_run"],
  research: ["read_file", "list_files", "write_file", "handoff", "finish_task"],
  coding: ["write_file", "read_file", "list_files", "handoff", "finish_task"],
  design: ["write_file", "read_file", "list_files", "handoff", "finish_task"],
  testing: ["run_command", "read_file", "list_files", "flag_issue", "handoff", "finish_task"],
  review: ["read_file", "list_files", "flag_issue", "handoff", "finish_task"],
};

export function toolsForRole(role: AgentRole): ToolDefinition[] {
  return TOOLS_BY_ROLE[role].map((name) => TOOL_SCHEMAS[name]);
}

// --- zod validators for runtime-safe parsing of tool_use input ---

export const PlanTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  agent_role: z.enum(["research", "coding", "design", "testing", "review"]),
  instructions: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
});

export const CreatePlanInput = z.object({
  direct_answer: z.string().optional(),
  tasks: z.array(PlanTaskSchema).default([]),
});

export const WriteFileInput = z.object({ path: z.string().min(1), content: z.string() });
export const ReadFileInput = z.object({ path: z.string().min(1) });
export const ListFilesInput = z.object({}).passthrough();
export const RunCommandInput = z.object({ command: z.string().min(1), args: z.array(z.string()).default([]) });
export const HandoffInput = z.object({
  to_agent: z.enum(["research", "coding", "design", "testing", "review"]),
  message: z.string().min(1),
});
export const FlagIssueInput = z.object({
  target_task_id: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["minor", "blocking"]),
});
export const FinishTaskInput = z.object({ summary: z.string().min(1), output: z.string() });
export const FinishRunInput = z.object({ final_result: z.string().min(1) });
