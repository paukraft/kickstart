import type {
  ProjectRuntimeState,
  TerminalSessionSnapshot,
} from "@kickstart/contracts";

type ProjectRuntimeSession = Pick<
  TerminalSessionSnapshot,
  "hasActiveProcess" | "status"
>;

export function resolveProjectRuntimeState(args: {
  sessions: readonly ProjectRuntimeSession[];
  startupCommandCount: number;
}): ProjectRuntimeState {
  const { sessions, startupCommandCount } = args;
  const runningCommandCount = sessions.filter((session) => session.hasActiveProcess).length;
  const hasStartingCommand = sessions.some((session) => session.status === "starting");
  const hasStoppingCommand = sessions.some((session) => session.status === "stopping");

  if (hasStartingCommand) {
    return "starting";
  }
  if (hasStoppingCommand) {
    return "stopping";
  }
  if (runningCommandCount === 0) {
    return "not-running";
  }
  if (runningCommandCount === startupCommandCount) {
    return "running";
  }
  return "partially-running";
}
