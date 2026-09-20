import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PendingTaskAffordance } from "./PendingTaskAffordance";

const { healthCheck, diagnoseLogTail } = vi.hoisted(() => ({
  healthCheck: vi.fn().mockResolvedValue({ studio_projects: 2, log_file: "/tmp/omni.log" }),
  diagnoseLogTail: vi.fn().mockResolvedValue({ lines: ["INFO task"], errors: [], returned_lines: 1, missing: false }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("@/lib/api", () => ({ api: { healthCheck, diagnoseLogTail } }));

it("reveals recoverable actions, keeps the failure visible, and opens a localized diagnosis dialog", async () => {
  const onCancel = vi.fn().mockRejectedValue(new Error("provider still running"));
  render(<PendingTaskAffordance statusLabel="生成中" revealAfterMs={0} taskId="task-1" onCancel={onCancel} />);

  fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  expect(await screen.findByText("provider still running")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "diagnose" }));
  expect(await screen.findByRole("dialog", { name: "title" })).toBeInTheDocument();
  await waitFor(() => expect(healthCheck).toHaveBeenCalledOnce());
  expect(await screen.findByText(/reachable/)).toBeInTheDocument();
  expect(diagnoseLogTail).toHaveBeenCalledWith(200);
  fireEvent.click(screen.getByRole("button", { name: "close" }));
  expect(screen.queryByRole("dialog", { name: "title" })).not.toBeInTheDocument();
});
