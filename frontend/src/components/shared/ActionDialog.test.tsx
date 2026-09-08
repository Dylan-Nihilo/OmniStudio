import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/renderWithIntl";
import ActionDialog from "./ActionDialog";

it("retains a rename after failure, blocks duplicate submissions and closes only after success", async () => {
  let finish!: () => void;
  const onConfirm = vi.fn().mockRejectedValueOnce(new Error("保存失败")).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const onClose = vi.fn();
  renderWithIntl(<ActionDialog title="重命名" fieldLabel="标题" initialValue="旧标题" onConfirm={onConfirm} onClose={onClose} />);
  const field = screen.getByRole("textbox", {name:"标题"});
  fireEvent.change(field, {target:{value:" 新标题 "}});
  fireEvent.click(screen.getByRole("button", {name:"确定"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(field).toHaveValue(" 新标题 ");
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"确定"}));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  expect(field).toBeDisabled();
  fireEvent.submit(field.closest("form")!);
  fireEvent.keyDown(screen.getByRole("dialog"), {key:"Escape"});
  expect(onConfirm).toHaveBeenCalledTimes(2);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(onConfirm).toHaveBeenLastCalledWith("新标题");
  expect(onClose).toHaveBeenCalledOnce();
});
