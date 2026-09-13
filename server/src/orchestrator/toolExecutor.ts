import { writeWorkspaceFile, readWorkspaceFile, listWorkspaceFiles } from "../sandbox/workspace.js";
import { runCommand } from "../sandbox/commandRunner.js";
import { WriteFileInput, ReadFileInput, RunCommandInput } from "../llm/tools.js";

// Executes the side-effecting workspace tools for real (file IO, real process execution).
// Control-flow tools (create_plan/finish_task/finish_run/handoff/flag_issue) are handled
// by the orchestrator itself as signals; this just needs to return them a well-formed
// tool_result acknowledgment so the conversation stays valid.
export async function executeWorkspaceTool(workspaceDir: string, name: string, input: unknown): Promise<string> {
  try {
    switch (name) {
      case "write_file": {
        const parsed = WriteFileInput.parse(input);
        const file = writeWorkspaceFile(workspaceDir, parsed.path, parsed.content);
        return JSON.stringify({ ok: true, file });
      }
      case "read_file": {
        const parsed = ReadFileInput.parse(input);
        const content = readWorkspaceFile(workspaceDir, parsed.path);
        return JSON.stringify({ ok: true, path: parsed.path, content });
      }
      case "list_files": {
        const files = await listWorkspaceFiles(workspaceDir);
        return JSON.stringify(files);
      }
      case "run_command": {
        const parsed = RunCommandInput.parse(input);
        const result = await runCommand(workspaceDir, parsed.command, parsed.args);
        return JSON.stringify(result);
      }
      default:
        return JSON.stringify({ ok: true, acknowledged: name });
    }
  } catch (err) {
    return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
